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
  type Embedder,
  EmbeddingRagIndex,
} from './rag-embedding.js';
import { ingestRagDeclaredLocalSources, RAG_CHUNK_ID_VERSION, type RagIngestResult } from './rag-ingest.js';
import {
  cloneRagMetadataFilter,
  RAG_METADATA_FILTER_KEY_TO_PROP,
  type RagMetadataFilter,
  type RagMetadataFilterKey,
} from './rag-metadata-filter.js';
import {
  type RagRetrieveIndexLifecycle,
  retrieveRagDocument,
  retrieveRagDocumentAsync,
} from './rag-retrieve-runner.js';
import {
  type AsyncRagContractRetriever,
  createInMemoryRetriever,
  evaluateRagEvalContract,
  evaluateRagEvalContractAsync,
  InMemoryRagCorpus,
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
  /** Optional explicit declared retrieval target for the eval run. */
  readonly target?: RagEvalDocumentTargetOptions;
}

export interface RagEvalDeclaredAsyncDocumentOptions extends Omit<RagEvalAsyncDocumentOptions, 'corpusSource'> {
  /** Path to the .kern file being evaluated; local source globs resolve relative to this file. */
  readonly sourcePath: string;
  /** Optional explicit declared retrieval target for the eval run. */
  readonly target?: RagEvalDocumentTargetOptions;
}

export interface RagEvalDocumentEntry {
  readonly ragName: string;
  readonly evalName?: string;
  readonly target?: RagEvalDocumentEntryTarget;
  readonly result: RagEvalContractResult;
}

export interface RagEvalDocumentTargetOptions {
  readonly retrieverName?: string;
  readonly indexName?: string;
}

export type RagEvalDocumentTargetMode =
  | 'explicit-corpus'
  | 'declared-sources'
  | 'auto-compatible-index'
  | 'explicit-retriever'
  | 'explicit-index'
  | 'explicit-pair'
  | 'mixed';

export type RagEvalDocumentEntryTargetMode =
  | 'explicit-corpus'
  | 'declared-sources'
  | 'auto-compatible-index'
  | 'explicit-index';

export interface RagEvalDocumentEntryTarget {
  readonly retrieverName: string;
  readonly indexName?: string;
  readonly mode: RagEvalDocumentEntryTargetMode;
}

export interface RagEvalDocumentTargetReport {
  readonly requested: RagEvalDocumentTargetOptions;
  readonly mode: RagEvalDocumentTargetMode;
  readonly retrieverNames: readonly string[];
  readonly indexNames: readonly string[];
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
  /** Declared retrieval target provenance for CI reports. */
  readonly target?: RagEvalDocumentTargetReport;
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
      target: targetReport(undefined, [], 'explicit-corpus'),
      evals: [],
      passed: false,
    };
  }

  const chunkArray = Array.from(chunks);
  const facts = collectRagSemanticFacts(root);
  const embedderIds = new Set<string>();
  const retrieverByPipeline = new Map<string, RagContractRetriever>();
  const retrieverByEmbedding = new Map<string, RagContractRetriever>();
  const keywordRetriever = createInMemoryRetriever(new InMemoryRagCorpus(chunkArray));
  const getRetriever = (pipeline: RagSemanticPipelineFact): RagContractRetriever => {
    let retriever = retrieverByPipeline.get(pipeline.name);
    if (retriever === undefined) {
      if (retrieverModeForPipeline(facts, pipeline) === 'keyword') {
        retrieverByPipeline.set(pipeline.name, keywordRetriever);
        return keywordRetriever;
      }
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

  const evals = evaluatePipelineFacts(facts.pipelines, getRetriever, options, (pipeline) => ({
    retrieverName: pipeline.retrieverName,
    mode: 'explicit-corpus',
  }));

  return {
    embedderId: reportEmbedderId(embedderIds, options.embedder?.id),
    embedderIds: Array.from(embedderIds).sort(),
    corpusSource: options.corpusSource ?? explicitCorpusSource(chunkArray),
    diagnostics,
    indexes: [],
    target: targetReport(undefined, evals, 'explicit-corpus'),
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
      target: targetReport(undefined, [], 'explicit-corpus'),
      evals: [],
      passed: false,
    };
  }

  const chunkArray = Array.from(chunks);
  const facts = collectRagSemanticFacts(root);
  const embedderIds = new Set<string>();
  const retrieverByPipeline = new Map<string, AsyncRagContractRetriever>();
  const retrieverByEmbedding = new Map<string, AsyncRagContractRetriever>();
  const keywordRetriever = createAsyncKeywordRetriever(chunkArray);
  const getRetriever = async (pipeline: RagSemanticPipelineFact): Promise<AsyncRagContractRetriever> => {
    let retriever = retrieverByPipeline.get(pipeline.name);
    if (retriever === undefined) {
      if (retrieverModeForPipeline(facts, pipeline) === 'keyword') {
        retrieverByPipeline.set(pipeline.name, keywordRetriever);
        return keywordRetriever;
      }
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

  const evals = await evaluatePipelineFactsAsync(facts.pipelines, getRetriever, options, (pipeline) => ({
    retrieverName: pipeline.retrieverName,
    mode: 'explicit-corpus',
  }));
  return {
    embedderId: reportEmbedderId(embedderIds, options.embedder?.id),
    embedderIds: Array.from(embedderIds).sort(),
    corpusSource: options.corpusSource ?? explicitCorpusSource(chunkArray),
    diagnostics,
    indexes: [],
    target: targetReport(undefined, evals, 'explicit-corpus'),
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
  const pipelines = evaluationPipelinesForTarget(facts, options.target);
  const evaluatedCorpusNames = corpusNamesForPipelines(facts, pipelines);
  if (evaluatedCorpusNames.length === 0) {
    return {
      embedderId: unresolvedEmbedderId(options.embedder?.id),
      corpusSource: emptyDeclaredCorpusSource(options.sourcePath),
      diagnostics,
      indexes: [],
      target: targetReport(options.target, [], 'declared-sources'),
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
  const retrieverByKeywordCorpus = new Map<string, RagContractRetriever>();
  const indexLifecycleByName = new Map<string, RagRetrieveIndexLifecycle>();
  const embedderIds = new Set<string>();
  const targetByPipeline = new Map<string, RagEvalDocumentEntryTarget>();
  const getRetriever = (pipeline: RagSemanticPipelineFact): RagContractRetriever => {
    let retriever = retrieverByPipeline.get(pipeline.name);
    if (retriever === undefined) {
      const runtimeIndex = runtimeIndexForPipeline(facts, pipeline, options.target);
      if (runtimeIndex) {
        const embedder = resolveSyncRagEmbedderForPipeline(facts, pipeline, options);
        embedderIds.add(embedder.id);
        targetByPipeline.set(pipeline.name, {
          retrieverName: pipeline.retrieverName,
          indexName: runtimeIndex.name,
          mode: options.target?.indexName ? 'explicit-index' : 'auto-compatible-index',
        });
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
      if (retrieverModeForPipeline(facts, pipeline) === 'keyword') {
        targetByPipeline.set(pipeline.name, {
          retrieverName: pipeline.retrieverName,
          mode: 'declared-sources',
        });
        retriever = retrieverByKeywordCorpus.get(corpusName);
        if (retriever === undefined) {
          retriever = createInMemoryRetriever(new InMemoryRagCorpus(corpusChunks));
          retrieverByKeywordCorpus.set(corpusName, retriever);
        }
        retrieverByPipeline.set(pipeline.name, retriever);
        return retriever;
      }
      const embedder = resolveSyncRagEmbedderForPipeline(facts, pipeline, options);
      embedderIds.add(embedder.id);
      targetByPipeline.set(pipeline.name, {
        retrieverName: pipeline.retrieverName,
        mode: 'declared-sources',
      });
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
  const evals = evaluatePipelineFacts(pipelines, getRetriever, options, (pipeline) =>
    targetByPipeline.get(pipeline.name),
  );
  return {
    embedderId: reportEmbedderId(embedderIds, options.embedder?.id),
    embedderIds: Array.from(embedderIds).sort(),
    corpusSource: declaredCorpusSource(options.sourcePath, ingestion),
    diagnostics,
    indexes: sortedIndexLifecycle(indexLifecycleByName),
    target: targetReport(options.target, evals, 'declared-sources'),
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
  const pipelines = evaluationPipelinesForTarget(facts, options.target);
  const evaluatedCorpusNames = corpusNamesForPipelines(facts, pipelines);
  if (evaluatedCorpusNames.length === 0) {
    return {
      embedderId: unresolvedEmbedderId(options.embedder?.id),
      corpusSource: emptyDeclaredCorpusSource(options.sourcePath),
      diagnostics,
      indexes: [],
      target: targetReport(options.target, [], 'declared-sources'),
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
  const retrieverByKeywordCorpus = new Map<string, AsyncRagContractRetriever>();
  const indexLifecycleByName = new Map<string, RagRetrieveIndexLifecycle>();
  const embedderIds = new Set<string>();
  const targetByPipeline = new Map<string, RagEvalDocumentEntryTarget>();
  const getRetriever = async (pipeline: RagSemanticPipelineFact): Promise<AsyncRagContractRetriever> => {
    let retriever = retrieverByPipeline.get(pipeline.name);
    if (retriever === undefined) {
      const runtimeIndex = runtimeIndexForPipeline(facts, pipeline, options.target);
      if (runtimeIndex) {
        const embedder = resolveAsyncRagEmbedderForPipeline(facts, pipeline, options);
        embedderIds.add(embedder.id);
        targetByPipeline.set(pipeline.name, {
          retrieverName: pipeline.retrieverName,
          indexName: runtimeIndex.name,
          mode: options.target?.indexName ? 'explicit-index' : 'auto-compatible-index',
        });
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
      if (retrieverModeForPipeline(facts, pipeline) === 'keyword') {
        targetByPipeline.set(pipeline.name, {
          retrieverName: pipeline.retrieverName,
          mode: 'declared-sources',
        });
        retriever = retrieverByKeywordCorpus.get(corpusName);
        if (retriever === undefined) {
          retriever = createAsyncKeywordRetriever(corpusChunks);
          retrieverByKeywordCorpus.set(corpusName, retriever);
        }
        retrieverByPipeline.set(pipeline.name, retriever);
        return retriever;
      }
      const embedder = resolveAsyncRagEmbedderForPipeline(facts, pipeline, options);
      embedderIds.add(embedder.id);
      targetByPipeline.set(pipeline.name, {
        retrieverName: pipeline.retrieverName,
        mode: 'declared-sources',
      });
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
  const evals = await evaluatePipelineFactsAsync(pipelines, getRetriever, options, (pipeline) =>
    targetByPipeline.get(pipeline.name),
  );
  return {
    embedderId: reportEmbedderId(embedderIds, options.embedder?.id),
    embedderIds: Array.from(embedderIds).sort(),
    corpusSource: declaredCorpusSource(options.sourcePath, ingestion),
    diagnostics,
    indexes: sortedIndexLifecycle(indexLifecycleByName),
    target: targetReport(options.target, evals, 'declared-sources'),
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
  pipelines: readonly RagSemanticPipelineFact[],
  getRetriever: (pipeline: RagSemanticPipelineFact) => RagContractRetriever,
  options: RagEvalContractOptions,
  getTarget?: (pipeline: RagSemanticPipelineFact) => RagEvalDocumentEntryTarget | undefined,
): RagEvalDocumentEntry[] {
  return pipelines.flatMap((pipeline) => {
    if (pipeline.evals.length === 0) return [];
    const retriever = getRetriever(pipeline);
    const target = getTarget?.(pipeline);
    return pipeline.evals.map((evaluation) => ({
      ragName: pipeline.name,
      ...(evaluation.name !== undefined ? { evalName: evaluation.name } : {}),
      ...(target !== undefined ? { target } : {}),
      result: evaluateRagEvalContract(evaluation, retriever, options),
    }));
  });
}

async function evaluatePipelineFactsAsync(
  pipelines: readonly RagSemanticPipelineFact[],
  getRetriever: (pipeline: RagSemanticPipelineFact) => Promise<AsyncRagContractRetriever>,
  options: RagEvalContractOptions,
  getTarget?: (pipeline: RagSemanticPipelineFact) => RagEvalDocumentEntryTarget | undefined,
): Promise<RagEvalDocumentEntry[]> {
  const entries: RagEvalDocumentEntry[] = [];
  for (const pipeline of pipelines) {
    if (pipeline.evals.length === 0) continue;
    const retriever = await getRetriever(pipeline);
    const target = getTarget?.(pipeline);
    for (const evaluation of pipeline.evals) {
      entries.push({
        ragName: pipeline.name,
        ...(evaluation.name !== undefined ? { evalName: evaluation.name } : {}),
        ...(target !== undefined ? { target } : {}),
        result: await evaluateRagEvalContractAsync(evaluation, retriever, options),
      });
    }
  }
  return entries;
}

function corpusNamesForPipelines(facts: RagSemanticFacts, pipelines: readonly RagSemanticPipelineFact[]): string[] {
  const names = pipelines.map((pipeline) => corpusNameForPipeline(facts, pipeline));
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
  target: RagEvalDocumentTargetOptions | undefined,
): RagSemanticFacts['indexes'][number] | undefined {
  const retriever = facts.retrievers.find((entry) => entry.name === pipeline.retrieverName);
  if (!retriever) return undefined;
  if (retriever.mode === 'keyword') {
    if (target?.indexName) {
      const index = facts.indexes.find((entry) => entry.name === target.indexName);
      if (!index)
        throw unknownRagEvalTargetError(
          'ragIndex',
          target.indexName,
          facts.indexes.map((entry) => entry.name),
        );
      throw new Error(
        `KERN RAG eval target ragIndex '${index.name}' is incompatible with retriever '${retriever.name}' because mode=keyword is not index-backed.`,
      );
    }
    return undefined;
  }
  if (target?.indexName) {
    const index = facts.indexes.find((entry) => entry.name === target.indexName);
    if (!index)
      throw unknownRagEvalTargetError(
        'ragIndex',
        target.indexName,
        facts.indexes.map((entry) => entry.name),
      );
    if (!isIndexCompatibleWithRetriever(index, retriever)) {
      throw incompatibleRagEvalTargetError(index, retriever);
    }
    return index;
  }
  const matches = facts.indexes.filter((index) => isIndexCompatibleWithRetriever(index, retriever));
  return matches.length === 1 ? matches[0] : undefined;
}

function evaluationPipelinesForTarget(
  facts: RagSemanticFacts,
  target: RagEvalDocumentTargetOptions | undefined,
): RagSemanticPipelineFact[] {
  let pipelines = facts.pipelines.filter((pipeline) => pipeline.evals.length > 0);
  if (!target?.retrieverName && !target?.indexName) return pipelines;

  if (target.retrieverName && !facts.retrievers.some((entry) => entry.name === target.retrieverName)) {
    throw unknownRagEvalTargetError(
      'ragRetriever',
      target.retrieverName,
      facts.retrievers.map((entry) => entry.name),
    );
  }
  const index = target.indexName ? facts.indexes.find((entry) => entry.name === target.indexName) : undefined;
  if (target.indexName && !index) {
    throw unknownRagEvalTargetError(
      'ragIndex',
      target.indexName,
      facts.indexes.map((entry) => entry.name),
    );
  }
  if (target.retrieverName && index) {
    const retriever = facts.retrievers.find((entry) => entry.name === target.retrieverName);
    if (retriever && !isIndexCompatibleWithRetriever(index, retriever)) {
      throw incompatibleRagEvalTargetError(index, retriever);
    }
  }

  if (target.retrieverName) {
    pipelines = pipelines.filter((pipeline) => pipeline.retrieverName === target.retrieverName);
  }
  if (index) {
    pipelines = pipelines.filter((pipeline) => {
      const retriever = facts.retrievers.find((entry) => entry.name === pipeline.retrieverName);
      return retriever !== undefined && isIndexCompatibleWithRetriever(index, retriever);
    });
  }
  if (pipelines.length === 0) {
    throw new Error(
      `KERN RAG eval target did not match any ragEval declarations (retriever=${target.retrieverName ?? '*'} index=${target.indexName ?? '*'}).`,
    );
  }
  return pipelines;
}

function isIndexCompatibleWithRetriever(
  index: RagSemanticFacts['indexes'][number],
  retriever: RagSemanticFacts['retrievers'][number],
): boolean {
  if (retriever.mode === 'keyword') return false;
  return index.corpusName === retriever.corpusName && (index.embedName ?? '') === (retriever.embedName ?? '');
}

function unknownRagEvalTargetError(
  kind: 'ragIndex' | 'ragRetriever',
  name: string,
  available: readonly string[],
): Error {
  const list = available.length > 0 ? available.join(', ') : '(none)';
  return new Error(`KERN RAG eval target ${kind} '${name}' was not declared. Available ${kind}s: ${list}.`);
}

function incompatibleRagEvalTargetError(
  index: RagSemanticFacts['indexes'][number],
  retriever: RagSemanticFacts['retrievers'][number],
): Error {
  return new Error(
    `KERN RAG eval target ragIndex '${index.name}' is incompatible with retriever '${retriever.name}' (index corpus='${index.corpusName}' embed='${index.embedName ?? ''}', retriever corpus='${retriever.corpusName}' embed='${retriever.embedName ?? ''}').`,
  );
}

function targetReport(
  requested: RagEvalDocumentTargetOptions | undefined,
  evals: readonly RagEvalDocumentEntry[],
  emptyMode: RagEvalDocumentTargetMode,
): RagEvalDocumentTargetReport {
  const retrieverNames = Array.from(
    new Set(evals.map((entry) => entry.target?.retrieverName).filter((name): name is string => name !== undefined)),
  ).sort();
  const indexNames = Array.from(
    new Set(evals.map((entry) => entry.target?.indexName).filter((name): name is string => name !== undefined)),
  ).sort();
  return {
    requested: requested ?? {},
    mode: targetMode(requested, evals, emptyMode),
    retrieverNames,
    indexNames,
  };
}

function targetMode(
  requested: RagEvalDocumentTargetOptions | undefined,
  evals: readonly RagEvalDocumentEntry[],
  emptyMode: RagEvalDocumentTargetMode,
): RagEvalDocumentTargetMode {
  if (requested?.retrieverName && requested.indexName) return 'explicit-pair';
  if (requested?.indexName) return 'explicit-index';
  if (requested?.retrieverName) return 'explicit-retriever';
  const modes = Array.from(
    new Set(
      evals
        .map((entry) => entry.target?.mode)
        .filter((mode): mode is RagEvalDocumentEntryTargetMode => mode !== undefined),
    ),
  );
  if (modes.length === 1) return modes[0];
  if (modes.length > 1) return 'mixed';
  return emptyMode;
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
    ...optionalRuntimeRetrieveMetadataFilter(retrieveOptions.metadataFilter),
    'output="RetrievedChunk[]"',
  ];
  return `${source.replace(/\s*$/u, '')}\n${fields.join(' ')}\n`;
}

function runtimeEvalRetrieveName(indexName: string, query: string, retrieveOptions: RetrieveOptions): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([indexName, query, stableJson(retrieveOptions)]))
    .digest('hex')
    .slice(0, 32);
  return `__KernRagEvalRuntimeRetrieve_${digest}`;
}

function stableJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === undefined) return stableJsonTagged('undefined', '');
  if (typeof value === 'bigint') return stableJsonTagged('bigint', value.toString());
  if (typeof value === 'function') return stableJsonTagged('function', value.name);
  if (typeof value === 'symbol') return stableJsonTagged('symbol', String(value));
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? '"__unserializable__"';
  if (seen.has(value)) throw new Error('KERN RAG eval retrieve options cannot contain circular values.');
  seen.add(value);
  try {
    const jsonValue = (value as { readonly toJSON?: unknown }).toJSON;
    if (typeof jsonValue === 'function') return stableJson(jsonValue.call(value), seen);
    if (Array.isArray(value)) {
      return `[${value.map((entry) => stableJson(entry, seen)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key], seen)}`)
      .join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

function stableJsonTagged(kind: string, value: string): string {
  return `{"\\u0000kernStableJson":${JSON.stringify(kind)},"value":${JSON.stringify(value)}}`;
}

function optionalRuntimeRetrieveNumber(name: string, value: number | undefined): string[] {
  return value === undefined ? [] : [`${name}=${String(value)}`];
}

function optionalRuntimeRetrieveMetadataFilter(filter: RagMetadataFilter | undefined): string[] {
  const normalized = cloneRagMetadataFilter(filter);
  if (!normalized) return [];
  return (Object.entries(normalized) as [RagMetadataFilterKey, string][])
    .sort(([left], [right]) => compareCodePoint(left, right))
    .map(([key, value]) => `${RAG_METADATA_FILTER_KEY_TO_PROP[key]}=${kernString(value)}`);
}

function kernString(value: string): string {
  return JSON.stringify(value);
}

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function retrieverModeForPipeline(facts: RagSemanticFacts, pipeline: RagSemanticPipelineFact): string | undefined {
  return facts.retrievers.find((retriever) => retriever.name === pipeline.retrieverName)?.mode;
}

function createAsyncKeywordRetriever(chunks: readonly RagChunkInput[]): AsyncRagContractRetriever {
  const retriever = createInMemoryRetriever(new InMemoryRagCorpus(chunks));
  return async (query, options) => retriever(query, options);
}

function reportEmbedderId(embedderIds: ReadonlySet<string>, fallback: string | undefined): string {
  if (embedderIds.size === 1) return Array.from(embedderIds)[0];
  if (embedderIds.size > 1) return 'mixed';
  return fallback ?? UNRESOLVED_RAG_EMBEDDER_ID;
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
