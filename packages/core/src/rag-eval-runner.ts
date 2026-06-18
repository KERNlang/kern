/**
 * Document-level RAG eval runner (P1.2).
 *
 * Ties the three already-existing layers together so a `.kern` RAG spec becomes
 * an executable, self-testing artifact:
 *   parse → `collectRagSemanticFacts` → run each `ragEval` against a REAL
 *   {@link EmbeddingRagIndex} retriever via the existing
 *   `evaluateRagEvalContract` seam.
 *
 * This is the dbt-test shape: retrieval + verification run in the KERN toolchain
 * (single implementation, one engine), not in emitted target code — so there is
 * no TS↔Python surface here. The corpus is supplied by the caller; on-disk
 * ingestion (`source uri=…` globs) lands in P1.5.
 */

import { createHash } from 'node:crypto';
import { parseDocument } from './parser.js';
import {
  createEmbeddingRetriever,
  DEFAULT_LOCAL_SEMANTIC_EMBEDDER_ID,
  type Embedder,
  EmbeddingRagIndex,
  LocalSemanticEmbedder,
} from './rag-embedding.js';
import {
  ingestRagDeclaredLocalSources,
  RAG_CHUNK_ID_VERSION,
  RAG_CHUNKER_VERSION,
  type RagIngestResult,
} from './rag-ingest.js';
import {
  evaluateRagEvalContract,
  type RagChunkInput,
  type RagContractRetriever,
  type RagEvalContractOptions,
  type RagEvalContractResult,
} from './rag-runtime.js';
import {
  collectRagSemanticFacts,
  type RagSemanticFacts,
  type RagSemanticPipelineFact,
  type SemanticViolation,
  validateRagSemantics,
} from './semantic-validator.js';

export interface RagEvalDocumentOptions extends RagEvalContractOptions {
  /** Embedder behind the retrieval seam. Defaults to the local semantic embedder. */
  readonly embedder?: Embedder;
  /** Reproducibility metadata for the corpus source feeding this eval. */
  readonly corpusSource?: RagEvalDocumentCorpusSource;
}

export interface RagEvalDeclaredDocumentOptions extends Omit<RagEvalDocumentOptions, 'corpusSource'> {
  /** Path to the .kern file being evaluated; local source globs resolve relative to this file. */
  readonly sourcePath: string;
}

export interface RagEvalDocumentEntry {
  readonly ragName: string;
  readonly evalName?: string;
  readonly result: RagEvalContractResult;
}

export interface RagEvalDocumentReport {
  /** Identity of the embedder used, recorded for reproducibility. */
  readonly embedderId: string;
  /** Corpus source mode and provenance, recorded so eval reports are replayable/comparable. */
  readonly corpusSource: RagEvalDocumentCorpusSource;
  /** RAG semantic violations. Non-empty ⇒ the spec is invalid and no eval ran (fail-closed). */
  readonly diagnostics: readonly SemanticViolation[];
  readonly evals: readonly RagEvalDocumentEntry[];
  /** True only when the spec is valid, at least one eval ran, and every eval passed. */
  readonly passed: boolean;
}

export type RagEvalDocumentCorpusSourceMode = 'explicit-corpus-json' | 'declared-local-sources';

export interface RagEvalDocumentCorpusSource {
  readonly mode: RagEvalDocumentCorpusSourceMode;
  readonly sourcePath?: string;
  readonly rootDir?: string;
  readonly patterns?: readonly string[];
  readonly files?: readonly string[];
  readonly fileCount?: number;
  readonly chunkCount: number;
  readonly corpusSha256: string;
  readonly chunkIdVersion?: string;
  readonly chunkerVersion?: string;
}

/**
 * Parse `source`, build a cosine retriever over `chunks`, and execute every
 * `ragEval` contract declared in the document against it.
 *
 * Fails closed: if the RAG graph is semantically invalid (unresolved/duplicate
 * declarations, out-of-range params, …) no eval runs and `passed` is false —
 * running a contract against a broken spec would report a meaningless verdict.
 */
export function evaluateRagEvalDocument(
  source: string,
  chunks: Iterable<RagChunkInput>,
  options: RagEvalDocumentOptions = {},
): RagEvalDocumentReport {
  const root = parseDocument(source);
  const diagnostics = validateRagSemantics(root);
  if (diagnostics.length > 0) {
    return {
      embedderId: options.embedder?.id ?? DEFAULT_LOCAL_SEMANTIC_EMBEDDER_ID,
      corpusSource: options.corpusSource ?? emptyExplicitCorpusSource(),
      diagnostics,
      evals: [],
      passed: false,
    };
  }

  const chunkArray = Array.from(chunks);
  const facts = collectRagSemanticFacts(root);
  const embedder = defaultEvalEmbedder(options);
  const index = new EmbeddingRagIndex(chunkArray, { embedder });
  const retriever = createEmbeddingRetriever(index);

  const evals = evaluatePipelineFacts(facts, () => retriever, options);

  return {
    embedderId: index.embedderId,
    corpusSource: options.corpusSource ?? explicitCorpusSource(chunkArray),
    diagnostics,
    evals,
    passed: evals.length > 0 && evals.every((entry) => entry.result.passed),
  };
}

export function evaluateRagEvalDocumentFromDeclaredSources(
  source: string,
  options: RagEvalDeclaredDocumentOptions,
): RagEvalDocumentReport {
  const root = parseDocument(source);
  const diagnostics = validateRagSemantics(root);
  if (diagnostics.length > 0) {
    return {
      embedderId: options.embedder?.id ?? DEFAULT_LOCAL_SEMANTIC_EMBEDDER_ID,
      corpusSource: {
        mode: 'declared-local-sources',
        sourcePath: options.sourcePath,
        chunkCount: 0,
        corpusSha256: '',
        chunkIdVersion: RAG_CHUNK_ID_VERSION,
        chunkerVersion: RAG_CHUNKER_VERSION,
      },
      diagnostics,
      evals: [],
      passed: false,
    };
  }

  const facts = collectRagSemanticFacts(root);
  const evaluatedCorpusNames = corpusNamesForEvaluatedPipelines(facts);
  if (evaluatedCorpusNames.length === 0) {
    return {
      embedderId: options.embedder?.id ?? DEFAULT_LOCAL_SEMANTIC_EMBEDDER_ID,
      corpusSource: emptyDeclaredCorpusSource(options.sourcePath),
      diagnostics,
      evals: [],
      passed: false,
    };
  }

  const ingestion = ingestRagDeclaredLocalSources(root, {
    sourcePath: options.sourcePath,
    corpusNames: evaluatedCorpusNames,
  });
  const retrieverByCorpus = new Map<string, RagContractRetriever>();
  const embedder = defaultEvalEmbedder(options);
  const getRetriever = (pipeline: RagSemanticPipelineFact): RagContractRetriever => {
    const corpusName = corpusNameForPipeline(facts, pipeline);
    let retriever = retrieverByCorpus.get(corpusName);
    if (retriever === undefined) {
      const corpusChunks = ingestion.chunks.filter((chunk) => chunkCorpusName(chunk) === corpusName);
      retriever = createEmbeddingRetriever(new EmbeddingRagIndex(corpusChunks, { embedder }));
      retrieverByCorpus.set(corpusName, retriever);
    }
    return retriever;
  };
  const evals = evaluatePipelineFacts(facts, getRetriever, options);
  return {
    embedderId: embedder.id,
    corpusSource: declaredCorpusSource(options.sourcePath, ingestion),
    diagnostics,
    evals,
    passed: evals.length > 0 && evals.every((entry) => entry.result.passed),
  };
}

function explicitCorpusSource(chunks: readonly RagChunkInput[]): RagEvalDocumentCorpusSource {
  return {
    mode: 'explicit-corpus-json',
    chunkCount: chunks.length,
    corpusSha256: chunksSha256(chunks),
  };
}

function emptyExplicitCorpusSource(): RagEvalDocumentCorpusSource {
  return {
    mode: 'explicit-corpus-json',
    chunkCount: 0,
    corpusSha256: '',
  };
}

function emptyDeclaredCorpusSource(sourcePath: string): RagEvalDocumentCorpusSource {
  return {
    mode: 'declared-local-sources',
    sourcePath,
    chunkCount: 0,
    corpusSha256: '',
    chunkIdVersion: RAG_CHUNK_ID_VERSION,
    chunkerVersion: RAG_CHUNKER_VERSION,
  };
}

function declaredCorpusSource(sourcePath: string, ingestion: RagIngestResult): RagEvalDocumentCorpusSource {
  const files = Array.from(new Set(ingestion.sources.flatMap((source) => source.files))).sort();
  return {
    mode: 'declared-local-sources',
    sourcePath,
    rootDir: ingestion.sources[0]?.rootDir,
    patterns: ingestion.sources.map((source) => source.uri),
    files,
    fileCount: files.length,
    chunkCount: ingestion.chunks.length,
    corpusSha256: ingestion.corpusSha256,
    chunkIdVersion: RAG_CHUNK_ID_VERSION,
    chunkerVersion: RAG_CHUNKER_VERSION,
  };
}

function chunksSha256(chunks: readonly RagChunkInput[]): string {
  const stable = chunks
    .map((chunk) => `${chunk.id}\0${chunk.source}\0${chunk.text}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(stable).digest('hex');
}

function evaluatePipelineFacts(
  facts: RagSemanticFacts,
  getRetriever: (pipeline: RagSemanticPipelineFact) => RagContractRetriever,
  options: RagEvalContractOptions,
): RagEvalDocumentEntry[] {
  return facts.pipelines.flatMap((pipeline) =>
    pipeline.evals.map((evaluation) => ({
      ragName: pipeline.name,
      ...(evaluation.name !== undefined ? { evalName: evaluation.name } : {}),
      result: evaluateRagEvalContract(evaluation, getRetriever(pipeline), options),
    })),
  );
}

function corpusNamesForEvaluatedPipelines(facts: RagSemanticFacts): string[] {
  const names = facts.pipelines
    .filter((pipeline) => pipeline.evals.length > 0)
    .map((pipeline) => corpusNameForPipeline(facts, pipeline));
  return Array.from(new Set(names)).sort();
}

function corpusNameForPipeline(facts: RagSemanticFacts, pipeline: RagSemanticPipelineFact): string {
  const retriever = facts.retrievers.find((entry) => entry.name === pipeline.retrieverName);
  if (retriever === undefined) {
    throw new Error(`KERN RAG pipeline '${pipeline.name}' references missing retriever '${pipeline.retrieverName}'.`);
  }
  return retriever.corpusName;
}

function chunkCorpusName(chunk: RagChunkInput): string | undefined {
  const corpusName = chunk.metadata?.corpusName;
  return typeof corpusName === 'string' ? corpusName : undefined;
}

function defaultEvalEmbedder(options: RagEvalDocumentOptions): Embedder {
  return options.embedder ?? new LocalSemanticEmbedder();
}
