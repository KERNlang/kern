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
  type RagProviderEmbeddingOptions,
  resolveAsyncRagEmbedderForPipeline,
  resolveSyncRagEmbedderForPipeline,
} from './rag-embed-resolver.js';
import {
  type AsyncEmbedder,
  AsyncEmbeddingRagIndex,
  createAsyncEmbeddingRetriever,
  createEmbeddingRetriever,
  DEFAULT_LOCAL_SEMANTIC_EMBEDDER_ID,
  type Embedder,
  EmbeddingRagIndex,
} from './rag-embedding.js';
import { ingestRagDeclaredLocalSources, RAG_CHUNK_ID_VERSION, type RagIngestResult } from './rag-ingest.js';
import {
  type RagRetrieveIndexLifecycle,
  retrieveRagDocument,
  retrieveRagDocumentAsync,
} from './rag-retrieve-runner.js';
import {
  type AsyncRagContractRetriever,
  evaluateRagEvalContract,
  evaluateRagEvalContractAsync,
  type RagChunkInput,
  type RagContractRetriever,
  type RagEvalContractOptions,
  type RagEvalContractResult,
  type RetrieveOptions,
} from './rag-runtime.js';
import {
  collectRagSemanticFacts,
  type RagSemanticFacts,
  type RagSemanticPipelineFact,
  type SemanticViolation,
  validateRagSemantics,
} from './semantic-validator.js';

const UNRESOLVED_RAG_EMBEDDER_ID = 'unresolved';

export interface RagEvalDocumentOptions extends RagEvalContractOptions {
  /** Embedder behind the retrieval seam. Defaults to the local semantic embedder. */
  readonly embedder?: Embedder;
  /** Reproducibility metadata for the corpus source feeding this eval. */
  readonly corpusSource?: RagEvalDocumentCorpusSource;
}

export interface RagEvalAsyncDocumentOptions extends Omit<RagEvalDocumentOptions, 'embedder'> {
  /** Optional explicit embedder override; otherwise resolved from retriever embed declarations. */
  readonly embedder?: AsyncEmbedder;
  /** Provider options. Supplying OpenAI here is the only path that can make network calls. */
  readonly providers?: RagProviderEmbeddingOptions;
}

export interface RagEvalDeclaredDocumentOptions extends Omit<RagEvalDocumentOptions, 'corpusSource'> {
  /** Path to the .kern file being evaluated; local source globs resolve relative to this file. */
  readonly sourcePath: string;
}

export interface RagEvalDeclaredAsyncDocumentOptions extends Omit<RagEvalAsyncDocumentOptions, 'corpusSource'> {
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
  /** All embedder identities used by the evaluated pipelines. */
  readonly embedderIds?: readonly string[];
  /** Corpus source mode and provenance, recorded so eval reports are replayable/comparable. */
  readonly corpusSource: RagEvalDocumentCorpusSource;
  /** RAG semantic violations. Non-empty ⇒ the spec is invalid and no eval ran (fail-closed). */
  readonly diagnostics: readonly SemanticViolation[];
  /** Declared runtime indexes used by eval retrieval, including snapshot lifecycle state when available. */
  readonly indexes: readonly RagRetrieveIndexLifecycle[];
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
  readonly chunkerVersions?: readonly string[];
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
      embedderId: unresolvedEmbedderId(options.embedder?.id),
      corpusSource: options.corpusSource ?? emptyExplicitCorpusSource(),
      diagnostics,
      indexes: [],
      evals: [],
      passed: false,
    };
  }

  const chunkArray = Array.from(chunks);
  const facts = collectRagSemanticFacts(root);
  const embedderIds = new Set<string>();
  const retrieverByPipeline = new Map<string, RagContractRetriever>();
  const retrieverByEmbedding = new Map<string, RagContractRetriever>();
  const getRetriever = (pipeline: RagSemanticPipelineFact): RagContractRetriever => {
    let retriever = retrieverByPipeline.get(pipeline.name);
    if (retriever === undefined) {
      const embedder = resolveSyncRagEmbedderForPipeline(facts, pipeline, options);
      embedderIds.add(embedder.id);
      const cacheKey = explicitRetrieverCacheKey(embedder);
      retriever = retrieverByEmbedding.get(cacheKey);
      if (retriever === undefined) {
        retriever = createEmbeddingRetriever(new EmbeddingRagIndex(chunkArray, { embedder }));
        retrieverByEmbedding.set(cacheKey, retriever);
      }
      retrieverByPipeline.set(pipeline.name, retriever);
    }
    return retriever;
  };

  const evals = evaluatePipelineFacts(facts, getRetriever, options);

  return {
    embedderId: reportEmbedderId(embedderIds, options.embedder?.id),
    embedderIds: Array.from(embedderIds).sort(),
    corpusSource: options.corpusSource ?? explicitCorpusSource(chunkArray),
    diagnostics,
    indexes: [],
    evals,
    passed: evals.length > 0 && evals.every((entry) => entry.result.passed),
  };
}

export async function evaluateRagEvalDocumentAsync(
  source: string,
  chunks: Iterable<RagChunkInput>,
  options: RagEvalAsyncDocumentOptions = {},
): Promise<RagEvalDocumentReport> {
  const root = parseDocument(source);
  const diagnostics = validateRagSemantics(root);
  if (diagnostics.length > 0) {
    return {
      embedderId: unresolvedEmbedderId(options.embedder?.id),
      corpusSource: options.corpusSource ?? emptyExplicitCorpusSource(),
      diagnostics,
      indexes: [],
      evals: [],
      passed: false,
    };
  }

  const chunkArray = Array.from(chunks);
  const facts = collectRagSemanticFacts(root);
  const embedderIds = new Set<string>();
  const retrieverByPipeline = new Map<string, AsyncRagContractRetriever>();
  const retrieverByEmbedding = new Map<string, AsyncRagContractRetriever>();
  const getRetriever = async (pipeline: RagSemanticPipelineFact): Promise<AsyncRagContractRetriever> => {
    let retriever = retrieverByPipeline.get(pipeline.name);
    if (retriever === undefined) {
      const embedder = resolveAsyncRagEmbedderForPipeline(facts, pipeline, options);
      embedderIds.add(embedder.id);
      const cacheKey = explicitRetrieverCacheKey(embedder);
      retriever = retrieverByEmbedding.get(cacheKey);
      if (retriever === undefined) {
        const index = await AsyncEmbeddingRagIndex.create(chunkArray, { embedder });
        retriever = createAsyncEmbeddingRetriever(index);
        retrieverByEmbedding.set(cacheKey, retriever);
      }
      retrieverByPipeline.set(pipeline.name, retriever);
    }
    return retriever;
  };

  const evals = await evaluatePipelineFactsAsync(facts, getRetriever, options);
  return {
    embedderId: reportEmbedderId(embedderIds, asyncOptionEmbedderId(options)),
    embedderIds: Array.from(embedderIds).sort(),
    corpusSource: options.corpusSource ?? explicitCorpusSource(chunkArray),
    diagnostics,
    indexes: [],
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
      embedderId: unresolvedEmbedderId(options.embedder?.id),
      corpusSource: {
        mode: 'declared-local-sources',
        sourcePath: options.sourcePath,
        chunkCount: 0,
        corpusSha256: '',
        chunkIdVersion: RAG_CHUNK_ID_VERSION,
      },
      diagnostics,
      indexes: [],
      evals: [],
      passed: false,
    };
  }

  const facts = collectRagSemanticFacts(root);
  const evaluatedCorpusNames = corpusNamesForEvaluatedPipelines(facts);
  if (evaluatedCorpusNames.length === 0) {
    return {
      embedderId: unresolvedEmbedderId(options.embedder?.id),
      corpusSource: emptyDeclaredCorpusSource(options.sourcePath),
      diagnostics,
      indexes: [],
      evals: [],
      passed: false,
    };
  }

  const ingestion = ingestRagDeclaredLocalSources(root, {
    sourcePath: options.sourcePath,
    corpusNames: evaluatedCorpusNames,
  });
  const retrieverByPipeline = new Map<string, RagContractRetriever>();
  const retrieverByEmbedding = new Map<string, RagContractRetriever>();
  const indexLifecycleByName = new Map<string, RagRetrieveIndexLifecycle>();
  const embedderIds = new Set<string>();
  const getRetriever = (pipeline: RagSemanticPipelineFact): RagContractRetriever => {
    let retriever = retrieverByPipeline.get(pipeline.name);
    if (retriever === undefined) {
      const runtimeIndex = runtimeIndexForPipeline(facts, pipeline);
      if (runtimeIndex) {
        const embedder = resolveSyncRagEmbedderForPipeline(facts, pipeline, options);
        embedderIds.add(embedder.id);
        retriever = (query, retrieveOptions) => {
          const retrievalName = runtimeEvalRetrieveName(runtimeIndex.name, query, retrieveOptions ?? {});
          const report = retrieveRagDocument(
            runtimeEvalRetrieveSource(source, retrievalName, runtimeIndex.name, query, retrieveOptions ?? {}),
            {
              sourcePath: options.sourcePath,
              runtimeRetrievalNames: [retrievalName],
              ...(options.embedder ? { embedder: options.embedder } : {}),
            },
          );
          recordIndexLifecycle(indexLifecycleByName, report.indexes);
          const retrieval = report.retrievals.find((entry) => entry.name === retrievalName);
          if (!retrieval) {
            throw new Error(`KERN RAG eval could not execute runtime retrieval for ragIndex '${runtimeIndex.name}'.`);
          }
          return retrieval.result;
        };
        retrieverByPipeline.set(pipeline.name, retriever);
        return retriever;
      }
      const corpusName = corpusNameForPipeline(facts, pipeline);
      const corpusChunks = ingestion.chunks.filter((chunk) => chunkCorpusName(chunk) === corpusName);
      const embedder = resolveSyncRagEmbedderForPipeline(facts, pipeline, options);
      embedderIds.add(embedder.id);
      const cacheKey = declaredRetrieverCacheKey(corpusName, embedder);
      retriever = retrieverByEmbedding.get(cacheKey);
      if (retriever === undefined) {
        retriever = createEmbeddingRetriever(new EmbeddingRagIndex(corpusChunks, { embedder }));
        retrieverByEmbedding.set(cacheKey, retriever);
      }
      retrieverByPipeline.set(pipeline.name, retriever);
    }
    return retriever;
  };
  const evals = evaluatePipelineFacts(facts, getRetriever, options);
  return {
    embedderId: reportEmbedderId(embedderIds, options.embedder?.id),
    embedderIds: Array.from(embedderIds).sort(),
    corpusSource: declaredCorpusSource(options.sourcePath, ingestion),
    diagnostics,
    indexes: sortedIndexLifecycle(indexLifecycleByName),
    evals,
    passed: evals.length > 0 && evals.every((entry) => entry.result.passed),
  };
}

export async function evaluateRagEvalDocumentFromDeclaredSourcesAsync(
  source: string,
  options: RagEvalDeclaredAsyncDocumentOptions,
): Promise<RagEvalDocumentReport> {
  const root = parseDocument(source);
  const diagnostics = validateRagSemantics(root);
  if (diagnostics.length > 0) {
    return {
      embedderId: unresolvedEmbedderId(options.embedder?.id),
      corpusSource: {
        mode: 'declared-local-sources',
        sourcePath: options.sourcePath,
        chunkCount: 0,
        corpusSha256: '',
        chunkIdVersion: RAG_CHUNK_ID_VERSION,
      },
      diagnostics,
      indexes: [],
      evals: [],
      passed: false,
    };
  }

  const facts = collectRagSemanticFacts(root);
  const evaluatedCorpusNames = corpusNamesForEvaluatedPipelines(facts);
  if (evaluatedCorpusNames.length === 0) {
    return {
      embedderId: unresolvedEmbedderId(options.embedder?.id),
      corpusSource: emptyDeclaredCorpusSource(options.sourcePath),
      diagnostics,
      indexes: [],
      evals: [],
      passed: false,
    };
  }

  const ingestion = ingestRagDeclaredLocalSources(root, {
    sourcePath: options.sourcePath,
    corpusNames: evaluatedCorpusNames,
  });
  const retrieverByPipeline = new Map<string, AsyncRagContractRetriever>();
  const retrieverByEmbedding = new Map<string, AsyncRagContractRetriever>();
  const indexLifecycleByName = new Map<string, RagRetrieveIndexLifecycle>();
  const embedderIds = new Set<string>();
  const getRetriever = async (pipeline: RagSemanticPipelineFact): Promise<AsyncRagContractRetriever> => {
    let retriever = retrieverByPipeline.get(pipeline.name);
    if (retriever === undefined) {
      const runtimeIndex = runtimeIndexForPipeline(facts, pipeline);
      if (runtimeIndex) {
        const embedder = resolveAsyncRagEmbedderForPipeline(facts, pipeline, options);
        embedderIds.add(embedder.id);
        retriever = async (query, retrieveOptions) => {
          const retrievalName = runtimeEvalRetrieveName(runtimeIndex.name, query, retrieveOptions ?? {});
          const report = await retrieveRagDocumentAsync(
            runtimeEvalRetrieveSource(source, retrievalName, runtimeIndex.name, query, retrieveOptions ?? {}),
            {
              sourcePath: options.sourcePath,
              runtimeRetrievalNames: [retrievalName],
              ...(options.embedder ? { embedder: options.embedder } : {}),
              ...(options.providers ? { providers: options.providers } : {}),
            },
          );
          recordIndexLifecycle(indexLifecycleByName, report.indexes);
          const retrieval = report.retrievals.find((entry) => entry.name === retrievalName);
          if (!retrieval) {
            throw new Error(`KERN RAG eval could not execute runtime retrieval for ragIndex '${runtimeIndex.name}'.`);
          }
          return retrieval.result;
        };
        retrieverByPipeline.set(pipeline.name, retriever);
        return retriever;
      }
      const corpusName = corpusNameForPipeline(facts, pipeline);
      const corpusChunks = ingestion.chunks.filter((chunk) => chunkCorpusName(chunk) === corpusName);
      const embedder = resolveAsyncRagEmbedderForPipeline(facts, pipeline, options);
      embedderIds.add(embedder.id);
      const cacheKey = declaredRetrieverCacheKey(corpusName, embedder);
      retriever = retrieverByEmbedding.get(cacheKey);
      if (retriever === undefined) {
        const index = await AsyncEmbeddingRagIndex.create(corpusChunks, { embedder });
        retriever = createAsyncEmbeddingRetriever(index);
        retrieverByEmbedding.set(cacheKey, retriever);
      }
      retrieverByPipeline.set(pipeline.name, retriever);
    }
    return retriever;
  };
  const evals = await evaluatePipelineFactsAsync(facts, getRetriever, options);
  return {
    embedderId: reportEmbedderId(embedderIds, asyncOptionEmbedderId(options)),
    embedderIds: Array.from(embedderIds).sort(),
    corpusSource: declaredCorpusSource(options.sourcePath, ingestion),
    diagnostics,
    indexes: sortedIndexLifecycle(indexLifecycleByName),
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
  };
}

function declaredCorpusSource(sourcePath: string, ingestion: RagIngestResult): RagEvalDocumentCorpusSource {
  const files = Array.from(new Set(ingestion.sources.flatMap((source) => source.files))).sort();
  const chunkerVersions = uniqueSortedMetadataValues(ingestion.chunks, 'chunkerVersion');
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
    ...(chunkerVersions.length === 1 ? { chunkerVersion: chunkerVersions[0] } : {}),
    chunkerVersions,
  };
}

function uniqueSortedMetadataValues(chunks: readonly RagChunkInput[], key: string): string[] {
  return Array.from(
    new Set(
      chunks
        .map((chunk) => chunk.metadata?.[key])
        .filter((value): value is string => typeof value === 'string' && value.trim() !== ''),
    ),
  ).sort();
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

async function evaluatePipelineFactsAsync(
  facts: RagSemanticFacts,
  getRetriever: (pipeline: RagSemanticPipelineFact) => Promise<AsyncRagContractRetriever>,
  options: RagEvalContractOptions,
): Promise<RagEvalDocumentEntry[]> {
  const entries: RagEvalDocumentEntry[] = [];
  for (const pipeline of facts.pipelines) {
    if (pipeline.evals.length === 0) continue;
    const retriever = await getRetriever(pipeline);
    for (const evaluation of pipeline.evals) {
      entries.push({
        ragName: pipeline.name,
        ...(evaluation.name !== undefined ? { evalName: evaluation.name } : {}),
        result: await evaluateRagEvalContractAsync(evaluation, retriever, options),
      });
    }
  }
  return entries;
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

function runtimeIndexForPipeline(
  facts: RagSemanticFacts,
  pipeline: RagSemanticPipelineFact,
): RagSemanticFacts['indexes'][number] | undefined {
  const retriever = facts.retrievers.find((entry) => entry.name === pipeline.retrieverName);
  if (!retriever) return undefined;
  const matches = facts.indexes.filter(
    (index) => index.corpusName === retriever.corpusName && (index.embedName ?? '') === (retriever.embedName ?? ''),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function runtimeEvalRetrieveSource(
  source: string,
  retrievalName: string,
  indexName: string,
  query: string,
  retrieveOptions: RetrieveOptions,
): string {
  const fields = [
    `ragRetrieve name=${retrievalName}`,
    `index=${kernString(indexName)}`,
    `query=${kernString(query)}`,
    ...optionalRuntimeRetrieveNumber('topK', retrieveOptions.topK),
    ...optionalRuntimeRetrieveNumber('minScore', retrieveOptions.minScore),
    'output="RetrievedChunk[]"',
  ];
  return `${source.replace(/\s*$/u, '')}\n${fields.join(' ')}\n`;
}

function runtimeEvalRetrieveName(indexName: string, query: string, retrieveOptions: RetrieveOptions): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([indexName, query, retrieveOptions.topK ?? null, retrieveOptions.minScore ?? null]))
    .digest('hex')
    .slice(0, 32);
  return `__KernRagEvalRuntimeRetrieve_${digest}`;
}

function optionalRuntimeRetrieveNumber(name: string, value: number | undefined): string[] {
  return value === undefined ? [] : [`${name}=${String(value)}`];
}

function kernString(value: string): string {
  return JSON.stringify(value);
}

function recordIndexLifecycle(
  out: Map<string, RagRetrieveIndexLifecycle>,
  indexes: readonly RagRetrieveIndexLifecycle[],
): void {
  for (const index of indexes) {
    const current = out.get(index.indexName);
    if (!current || indexLifecyclePriority(index.status) >= indexLifecyclePriority(current.status)) {
      out.set(index.indexName, index);
    }
  }
}

function indexLifecyclePriority(status: RagRetrieveIndexLifecycle['status']): number {
  if (status === 'rebuilt') return 3;
  if (status === 'indexed') return 2;
  return 1;
}

function sortedIndexLifecycle(indexes: ReadonlyMap<string, RagRetrieveIndexLifecycle>): RagRetrieveIndexLifecycle[] {
  return Array.from(indexes.values()).sort((left, right) => left.indexName.localeCompare(right.indexName));
}

function chunkCorpusName(chunk: RagChunkInput): string | undefined {
  const corpusName = chunk.metadata?.corpusName;
  return typeof corpusName === 'string' ? corpusName : undefined;
}

function reportEmbedderId(embedderIds: ReadonlySet<string>, fallback: string | undefined): string {
  if (embedderIds.size === 1) return Array.from(embedderIds)[0];
  if (embedderIds.size > 1) return 'mixed';
  return fallback ?? DEFAULT_LOCAL_SEMANTIC_EMBEDDER_ID;
}

function asyncOptionEmbedderId(options: RagEvalAsyncDocumentOptions): string {
  return options.embedder?.id ?? DEFAULT_LOCAL_SEMANTIC_EMBEDDER_ID;
}

function unresolvedEmbedderId(fallback: string | undefined): string {
  return fallback ?? UNRESOLVED_RAG_EMBEDDER_ID;
}

function explicitRetrieverCacheKey(embedder: Pick<AsyncEmbedder | Embedder, 'id' | 'dims'>): string {
  return JSON.stringify(['explicit', embedder.id, embedder.dims]);
}

function declaredRetrieverCacheKey(
  corpusName: string,
  embedder: Pick<AsyncEmbedder | Embedder, 'id' | 'dims'>,
): string {
  return JSON.stringify(['declared', corpusName, embedder.id, embedder.dims]);
}
