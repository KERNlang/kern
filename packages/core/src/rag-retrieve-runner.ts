import { parseDocument } from './parser.js';
import {
  canonicalRagEmbedModel,
  defaultDimsForRagEmbedModel,
  RAG_EMBED_MODEL_LOCAL_HASH,
  RAG_EMBED_MODEL_LOCAL_SEMANTIC,
} from './rag-embed-resolver.js';
import { DeterministicHashEmbedder, type Embedder, EmbeddingRagIndex, LocalSemanticEmbedder } from './rag-embedding.js';
import { ingestRagDeclaredLocalSources, type RagIngestResult } from './rag-ingest.js';
import type { RetrieveOptions, RetrieveResult } from './rag-runtime.js';
import {
  collectRagSemanticFacts,
  type RagSemanticFacts,
  type RagSemanticRuntimeRetrieveFact,
  type SemanticViolation,
  validateRagSemantics,
} from './semantic-validator.js';

export interface RagRetrieveDocumentOptions {
  readonly sourcePath: string;
  /** Global query fallback used when a ragRetrieve has queryParam but no matching queryParams entry. */
  readonly query?: string;
  /** Named runtime query inputs. Values here take precedence over the global query fallback. */
  readonly queryParams?: Readonly<Record<string, string>>;
  /** Override embedder for local, synchronous retrieval tests and tools. Provider-backed retrieval is future async work. */
  readonly embedder?: Embedder;
}

export interface RagRetrieveDocumentEntry {
  readonly name: string;
  readonly indexName: string;
  readonly ragName?: string;
  readonly query: string;
  readonly retrieveOptions: RetrieveOptions;
  readonly result: RetrieveResult;
}

export interface RagRetrieveDocumentReport {
  readonly diagnostics: readonly SemanticViolation[];
  readonly retrievals: readonly RagRetrieveDocumentEntry[];
  readonly ingestion?: RagIngestResult;
}

/**
 * Execute runtime ragRetrieve declarations over declared local sources.
 * The current synchronous path rebuilds an in-memory index from source files;
 * querying persistent/provider vector stores is intentionally left to the
 * future async runtime path.
 */
export function retrieveRagDocument(source: string, options: RagRetrieveDocumentOptions): RagRetrieveDocumentReport {
  const root = parseDocument(source);
  const diagnostics = validateRagSemantics(root);
  if (diagnostics.length > 0) return { diagnostics, retrievals: [] };

  const facts = collectRagSemanticFacts(root);
  const indexByName = new Map(facts.indexes.map((index) => [index.name, index]));
  const preparedRetrievals = facts.runtimeRetrievals.map((retrieval) => {
    const index = indexByName.get(retrieval.indexName);
    if (!index) throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' references missing index.`);
    if (index.chunkingName) {
      throw new Error(
        `KERN RAG runtime retrieval '${retrieval.name}' references index '${index.name}' with chunking='${index.chunkingName}', which is not supported by the synchronous ragRetrieve runner yet.`,
      );
    }
    const query = queryForRuntimeRetrieval(retrieval, options);
    const embedder = options.embedder ?? embedderForIndex(facts, index.embedName);
    return { retrieval, index, query, embedder };
  });
  const corpusNames = Array.from(new Set(preparedRetrievals.map(({ index }) => index.corpusName))).sort();
  if (corpusNames.length === 0) return { diagnostics, retrievals: [] };

  const ingestion = ingestRagDeclaredLocalSources(root, {
    sourcePath: options.sourcePath,
    corpusNames,
  });
  const embeddingIndexByKey = new Map<string, EmbeddingRagIndex>();

  const retrievals = preparedRetrievals.map(({ retrieval, index, query, embedder }) => {
    const cacheKey = JSON.stringify([index.corpusName, embedder.id, embedder.dims]);
    let embeddingIndex = embeddingIndexByKey.get(cacheKey);
    if (!embeddingIndex) {
      embeddingIndex = new EmbeddingRagIndex(
        ingestion.chunks.filter((chunk) => chunk.metadata?.corpusName === index.corpusName),
        { embedder },
      );
      embeddingIndexByKey.set(cacheKey, embeddingIndex);
    }
    const retrieveOptions = retrieveOptionsForFact(retrieval);
    return {
      name: retrieval.name,
      indexName: retrieval.indexName,
      ...(retrieval.ragName ? { ragName: retrieval.ragName } : {}),
      query,
      retrieveOptions,
      result: embeddingIndex.retrieve(query, retrieveOptions),
    };
  });

  return { diagnostics, retrievals, ingestion };
}

function queryForRuntimeRetrieval(
  retrieval: RagSemanticRuntimeRetrieveFact,
  options: RagRetrieveDocumentOptions,
): string {
  if (retrieval.query !== undefined) {
    if (retrieval.queryKind === 'expression') {
      throw new Error(
        `KERN RAG runtime retrieval '${retrieval.name}' uses dynamic query=<expr>; use queryParam=<name> for runtime queries.`,
      );
    }
    if (!retrieval.query.trim()) {
      throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' fixed query cannot be empty.`);
    }
    return retrieval.query;
  }
  if (retrieval.queryParam) {
    const value = options.queryParams?.[retrieval.queryParam] ?? options.query;
    if (value !== undefined) return value;
    throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' requires queryParam '${retrieval.queryParam}'.`);
  }
  throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' has no query source.`);
}

function retrieveOptionsForFact(retrieval: RagSemanticRuntimeRetrieveFact): RetrieveOptions {
  return {
    ...(retrieval.topK !== undefined ? { topK: retrieval.topK } : {}),
    ...(retrieval.minScore !== undefined ? { minScore: retrieval.minScore } : {}),
  };
}

function embedderForIndex(facts: RagSemanticFacts, embedName: string | undefined): Embedder {
  const embed = embedName
    ? facts.corpora.flatMap((corpus) => corpus.embeds).find((entry) => entry.name === embedName)
    : undefined;
  if (embedName && !embed) throw new Error(`KERN RAG embed '${embedName}' not found.`);
  const model = canonicalRagEmbedModel(embed?.model);
  const dims = embed?.dims ?? defaultDimsForRagEmbedModel(model);
  if (model === RAG_EMBED_MODEL_LOCAL_HASH) return new DeterministicHashEmbedder({ dims });
  if (model === RAG_EMBED_MODEL_LOCAL_SEMANTIC) return new LocalSemanticEmbedder();
  throw new Error(`RAG embed model '${model}' requires async provider execution.`);
}

export function ragRetrieveCorpusSourceSummary(report: RagRetrieveDocumentReport): string {
  const ingestion = report.ingestion;
  if (!ingestion) return '0 chunks';
  return `${ingestion.chunks.length} chunks, sha256=${ingestion.corpusSha256}`;
}
