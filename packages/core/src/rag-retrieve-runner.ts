import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseDocument } from './parser.js';
import {
  canonicalRagEmbedModel,
  defaultDimsForRagEmbedModel,
  type RagProviderEmbeddingOptions,
  resolveAsyncRagEmbedderForModel,
  resolveSyncRagEmbedderForModel,
} from './rag-embed-resolver.js';
import {
  type AsyncEmbedder,
  AsyncEmbeddingRagIndex,
  type Embedder,
  EmbeddingRagIndex,
} from './rag-embedding.js';
import { LocalPersistentRagVectorStoreAdapter } from './rag-embedding-node.js';
import { ingestRagDeclaredLocalSources, type RagIngestResult } from './rag-ingest.js';
import type { RagChunkInput, RetrieveOptions, RetrieveResult } from './rag-runtime.js';
import {
  collectRagSemanticFacts,
  type RagSemanticFacts,
  type RagSemanticIndexFact,
  type RagSemanticRuntimeRetrieveFact,
  type RagSemanticVectorStoreFact,
  type SemanticViolation,
  validateRagSemantics,
} from './semantic-validator.js';
import { cloneRagMetadataFilter } from './rag-metadata-filter.js';
import { renderRagQueryTemplate, type RagQueryTemplateParamValue } from './rag-query-template.js';

export interface RagRetrieveDocumentOptions {
  readonly sourcePath: string;
  /** Global query fallback used when a ragRetrieve has queryParam but no matching queryParams entry. */
  readonly query?: string;
  /** Named runtime query inputs. Values here take precedence over the global query fallback. */
  readonly queryParams?: Readonly<Record<string, string | undefined>>;
  /** Typed named runtime values used by queryTemplate=. Falls back to queryParams when omitted. */
  readonly templateParams?: Readonly<Record<string, RagQueryTemplateParamValue | undefined>>;
  /** Optional internal filter for callers that synthesize a single runtime retrieval. */
  readonly runtimeRetrievalNames?: readonly string[];
  /** Override embedder for local, synchronous retrieval tests and tools. Provider-backed retrieval is future async work. */
  readonly embedder?: Embedder;
}

export interface RagRetrieveAsyncDocumentOptions extends Omit<RagRetrieveDocumentOptions, 'embedder'> {
  /** Override embedder for async provider-backed retrieval tests and tools. */
  readonly embedder?: AsyncEmbedder | Embedder;
  /** Provider options. Supplying OpenAI here is the only path that can make network calls. */
  readonly providers?: RagProviderEmbeddingOptions;
}

export type RagRetrieveIndexLifecycleStatus = 'indexed' | 'reused' | 'rebuilt';

export interface RagRetrieveIndexLifecycle {
  readonly indexName: string;
  readonly corpusName: string;
  readonly storeName: string;
  readonly storeKind: 'memory' | 'local-persistent';
  readonly chunkingName?: string;
  readonly status: RagRetrieveIndexLifecycleStatus;
  readonly chunkCount: number;
  readonly fingerprint?: string;
  readonly snapshotPath?: string;
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
  readonly indexes: readonly RagRetrieveIndexLifecycle[];
  readonly retrievals: readonly RagRetrieveDocumentEntry[];
  readonly ingestion?: RagIngestResult;
}

interface PreparedRagRetrieval<TEmbedder extends Pick<Embedder, 'dims' | 'id'>> {
  readonly retrieval: RagSemanticRuntimeRetrieveFact;
  readonly index: RagSemanticIndexFact;
  readonly query: string;
  readonly embedder: TEmbedder;
  readonly vectorStore: RagSemanticVectorStoreFact;
}

interface RetrievalIngestions {
  readonly byIndexKey: ReadonlyMap<string, RagIngestResult>;
  readonly combined: RagIngestResult;
}

/**
 * Execute runtime ragRetrieve declarations over declared local sources.
 * The current synchronous path supports memory and local-persistent vector stores
 * over declared local sources. Provider vector stores remain future async work.
 */
export function retrieveRagDocument(source: string, options: RagRetrieveDocumentOptions): RagRetrieveDocumentReport {
  const root = parseDocument(source);
  const diagnostics = validateRagSemantics(root);
  if (diagnostics.length > 0) return { diagnostics, indexes: [], retrievals: [] };

  const facts = collectRagSemanticFacts(root);
  const preparedRetrievals = prepareRuntimeRetrievals(
    facts,
    options,
    (index) => options.embedder ?? embedderForIndex(facts, index),
  );
  if (preparedRetrievals.length === 0) return { diagnostics, indexes: [], retrievals: [] };

  const { byIndexKey, combined: ingestion } = ingestForPreparedRetrievals(root, preparedRetrievals, options.sourcePath);
  const embeddingIndexByKey = new Map<string, EmbeddingRagIndex>();
  const persistentStoreByKey = new Map<
    string,
    { readonly fingerprint: string; readonly store: LocalPersistentRagVectorStoreAdapter }
  >();
  const indexLifecycleByName = new Map<string, RagRetrieveIndexLifecycle>();
  let retrievals: RagRetrieveDocumentEntry[] = [];
  let retrievalError: unknown;
  let closeError: unknown;
  try {
    retrievals = preparedRetrievals.map(({ retrieval, index, query, embedder, vectorStore }) => {
      const corpusChunks = chunksForIndex(byIndexKey, index);
      const retrieveOptions = retrieveOptionsForFact(retrieval);
      let result: RetrieveResult;
      if ((vectorStore.kind ?? 'memory') === 'local-persistent') {
        const config = localPersistentStoreConfig(vectorStore, index, embedder, corpusChunks, options.sourcePath);
        let entry = persistentStoreByKey.get(config.physicalKey);
        if (entry && entry.fingerprint !== config.fingerprint) {
          throw new Error(
            `KERN RAG vectorStore '${vectorStore.name}' resolves to local snapshot '${config.fileName}' with multiple incompatible fingerprints. Use distinct namespace or path values for each local-persistent index.`,
          );
        }
        if (!entry) {
          entry = {
            fingerprint: config.fingerprint,
            store: new LocalPersistentRagVectorStoreAdapter({
              directory: config.directory,
              fileName: config.fileName,
              fingerprint: config.fingerprint,
              dims: embedder.dims,
              rebuildOnFingerprintMismatch: true,
            }),
          };
          persistentStoreByKey.set(config.physicalKey, entry);
        }
        const { fingerprint, store } = entry;
        const status = ensureLocalPersistentStoreIndexed(
          store,
          fingerprint,
          embedder,
          corpusChunks,
          config.snapshotExists,
        );
        indexLifecycleByName.set(index.name, indexLifecycleEntry(index, vectorStore, corpusChunks, status, config));
        result = store.search(query, embedder.embed(query), retrieveOptions, fingerprint);
      } else {
        const cacheKey = JSON.stringify([index.corpusName, index.chunkingName ?? '', embedder.id, embedder.dims]);
        let embeddingIndex = embeddingIndexByKey.get(cacheKey);
        let status: RagRetrieveIndexLifecycleStatus = 'reused';
        if (!embeddingIndex) {
          embeddingIndex = new EmbeddingRagIndex(corpusChunks, { embedder });
          embeddingIndexByKey.set(cacheKey, embeddingIndex);
          status = 'indexed';
        }
        indexLifecycleByName.set(index.name, indexLifecycleEntry(index, vectorStore, corpusChunks, status));
        result = embeddingIndex.retrieve(query, retrieveOptions);
      }
      return {
        name: retrieval.name,
        indexName: retrieval.indexName,
        ...(retrieval.ragName ? { ragName: retrieval.ragName } : {}),
        query,
        retrieveOptions,
        result,
      };
    });
  } catch (error) {
    retrievalError = error;
  } finally {
    closeError = closeLocalPersistentStores(persistentStoreByKey.values());
  }
  if (retrievalError) {
    throw errorWithCloseError(retrievalError, closeError);
  }
  if (closeError) throw closeError;

  return { diagnostics, indexes: Array.from(indexLifecycleByName.values()), retrievals, ingestion };
}

export async function retrieveRagDocumentAsync(
  source: string,
  options: RagRetrieveAsyncDocumentOptions,
): Promise<RagRetrieveDocumentReport> {
  const root = parseDocument(source);
  const diagnostics = validateRagSemantics(root);
  if (diagnostics.length > 0) return { diagnostics, indexes: [], retrievals: [] };

  const facts = collectRagSemanticFacts(root);
  const preparedRetrievals = prepareRuntimeRetrievals(facts, options, (index) =>
    options.embedder ? ensureAsyncEmbedder(options.embedder) : safeAsyncEmbedderForIndex(facts, index, options),
  );
  if (preparedRetrievals.length === 0) return { diagnostics, indexes: [], retrievals: [] };

  const { byIndexKey, combined: ingestion } = ingestForPreparedRetrievals(root, preparedRetrievals, options.sourcePath);
  const embeddingIndexByKey = new Map<string, AsyncEmbeddingRagIndex>();
  const persistentStoreByKey = new Map<
    string,
    { readonly fingerprint: string; readonly store: LocalPersistentRagVectorStoreAdapter }
  >();
  const indexLifecycleByName = new Map<string, RagRetrieveIndexLifecycle>();
  const retrievals: RagRetrieveDocumentEntry[] = [];
  let retrievalError: unknown;
  let closeError: unknown;
  try {
    for (const { retrieval, index, query, embedder, vectorStore } of preparedRetrievals) {
      const corpusChunks = chunksForIndex(byIndexKey, index);
      const retrieveOptions = retrieveOptionsForFact(retrieval);
      let result: RetrieveResult;
      if ((vectorStore.kind ?? 'memory') === 'local-persistent') {
        const config = localPersistentStoreConfig(vectorStore, index, embedder, corpusChunks, options.sourcePath);
        let entry = persistentStoreByKey.get(config.physicalKey);
        if (entry && entry.fingerprint !== config.fingerprint) {
          throw new Error(
            `KERN RAG vectorStore '${vectorStore.name}' resolves to local snapshot '${config.fileName}' with multiple incompatible fingerprints. Use distinct namespace or path values for each local-persistent index.`,
          );
        }
        if (!entry) {
          entry = {
            fingerprint: config.fingerprint,
            store: new LocalPersistentRagVectorStoreAdapter({
              directory: config.directory,
              fileName: config.fileName,
              fingerprint: config.fingerprint,
              dims: embedder.dims,
              rebuildOnFingerprintMismatch: true,
            }),
          };
          persistentStoreByKey.set(config.physicalKey, entry);
        }
        const { fingerprint, store } = entry;
        let queryVector: Float64Array;
        let status: RagRetrieveIndexLifecycleStatus;
        try {
          status = await ensureLocalPersistentStoreIndexedAsync(
            store,
            fingerprint,
            embedder,
            corpusChunks,
            config.snapshotExists,
          );
          queryVector = await embedder.embed(query);
        } catch (error) {
          throw providerError(error, index, embedder);
        }
        indexLifecycleByName.set(index.name, indexLifecycleEntry(index, vectorStore, corpusChunks, status, config));
        result = store.search(query, queryVector, retrieveOptions, fingerprint);
      } else {
        const cacheKey = JSON.stringify([index.corpusName, index.chunkingName ?? '', embedder.id, embedder.dims]);
        let embeddingIndex = embeddingIndexByKey.get(cacheKey);
        let status: RagRetrieveIndexLifecycleStatus = 'reused';
        try {
          if (!embeddingIndex) {
            embeddingIndex = await AsyncEmbeddingRagIndex.create(corpusChunks, { embedder });
            embeddingIndexByKey.set(cacheKey, embeddingIndex);
            status = 'indexed';
          }
          result = await embeddingIndex.retrieve(query, retrieveOptions);
        } catch (error) {
          throw providerError(error, index, embedder);
        }
        indexLifecycleByName.set(index.name, indexLifecycleEntry(index, vectorStore, corpusChunks, status));
      }
      retrievals.push({
        name: retrieval.name,
        indexName: retrieval.indexName,
        ...(retrieval.ragName ? { ragName: retrieval.ragName } : {}),
        query,
        retrieveOptions,
        result,
      });
    }
  } catch (error) {
    retrievalError = error;
  } finally {
    closeError = closeLocalPersistentStores(persistentStoreByKey.values());
  }
  if (retrievalError) {
    throw errorWithCloseError(retrievalError, closeError);
  }
  if (closeError) throw closeError;

  return { diagnostics, indexes: Array.from(indexLifecycleByName.values()), retrievals, ingestion };
}

function prepareRuntimeRetrievals<TEmbedder extends Pick<Embedder, 'dims' | 'id'>>(
  facts: RagSemanticFacts,
  options: Pick<RagRetrieveDocumentOptions, 'query' | 'queryParams' | 'runtimeRetrievalNames'>,
  embedderFor: (index: RagSemanticIndexFact) => TEmbedder,
): PreparedRagRetrieval<TEmbedder>[] {
  const indexByName = new Map(facts.indexes.map((index) => [index.name, index]));
  const vectorStoreByName = new Map(facts.vectorStores.map((store) => [store.name, store]));
  const runtimeRetrievalNames =
    options.runtimeRetrievalNames === undefined ? undefined : new Set(options.runtimeRetrievalNames);
  return facts.runtimeRetrievals
    .filter((retrieval) => runtimeRetrievalNames?.has(retrieval.name) ?? true)
    .map((retrieval) => {
      const index = indexByName.get(retrieval.indexName);
      if (!index) throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' references missing index.`);
      const vectorStore = vectorStoreByName.get(index.storeName);
      if (!vectorStore) {
        throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' references missing vector store.`);
      }
      const vectorStoreKind = vectorStore.kind ?? 'memory';
      if (vectorStoreKind !== 'memory' && vectorStoreKind !== 'local-persistent') {
        throw new Error(
          `KERN RAG runtime retrieval '${retrieval.name}' references vectorStore '${vectorStore.name}' kind='${vectorStoreKind}', but the ragRetrieve runner only supports kind=memory and kind=local-persistent.`,
        );
      }
      const query = queryForRuntimeRetrieval(retrieval, options);
      return { retrieval, index, query, embedder: embedderFor(index), vectorStore };
    });
}

function ingestForPreparedRetrievals(
  root: ReturnType<typeof parseDocument>,
  preparedRetrievals: readonly PreparedRagRetrieval<Pick<Embedder, 'dims' | 'id'>>[],
  sourcePath: string,
): RetrievalIngestions {
  const byIndexKey = new Map<string, RagIngestResult>();
  for (const { index } of preparedRetrievals) {
    const key = indexIngestionKey(index);
    if (byIndexKey.has(key)) continue;
    byIndexKey.set(
      key,
      ingestRagDeclaredLocalSources(root, {
        sourcePath,
        corpusNames: [index.corpusName],
        chunkingNameByCorpus: {
          [index.corpusName]: index.chunkingName,
        },
      }),
    );
  }
  const chunks = Array.from(byIndexKey.values())
    .flatMap((ingestion) => ingestion.chunks)
    .sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  const sources = Array.from(byIndexKey.values())
    .flatMap((ingestion) => ingestion.sources)
    .sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  return {
    byIndexKey,
    combined: {
      chunks,
      sources,
      corpusSha256: sha256(stableCorpusHashInput(chunks)),
    },
  };
}

function chunksForIndex(
  byIndexKey: ReadonlyMap<string, RagIngestResult>,
  index: RagSemanticIndexFact,
): readonly RagChunkInput[] {
  const ingestion = byIndexKey.get(indexIngestionKey(index));
  if (!ingestion) {
    throw new Error(
      `KERN RAG runtime retrieval index '${index.name}' could not prepare corpus '${index.corpusName}'` +
        `${index.chunkingName ? ` with chunking '${index.chunkingName}'` : ''}.`,
    );
  }
  return ingestion.chunks.filter((chunk) => chunk.metadata?.corpusName === index.corpusName);
}

function indexIngestionKey(index: RagSemanticIndexFact): string {
  return JSON.stringify([index.corpusName, index.chunkingName ?? '']);
}

function indexLifecycleEntry(
  index: RagSemanticIndexFact,
  vectorStore: RagSemanticVectorStoreFact,
  chunks: readonly RagChunkInput[],
  status: RagRetrieveIndexLifecycleStatus,
  config?: ReturnType<typeof localPersistentStoreConfig>,
): RagRetrieveIndexLifecycle {
  return {
    indexName: index.name,
    corpusName: index.corpusName,
    storeName: vectorStore.name,
    storeKind: (vectorStore.kind ?? 'memory') as 'memory' | 'local-persistent',
    ...(index.chunkingName ? { chunkingName: index.chunkingName } : {}),
    status,
    chunkCount: chunks.length,
    ...(config
      ? { fingerprint: config.fingerprint, snapshotPath: localPersistentDisplayPath(vectorStore, config) }
      : {}),
  };
}

function localPersistentDisplayPath(
  vectorStore: RagSemanticVectorStoreFact,
  config: ReturnType<typeof localPersistentStoreConfig>,
): string {
  const base = vectorStore.path?.replace(/\\/gu, '/').replace(/\/+$/u, '') ?? '.';
  return `${base}/${config.fileName}`.replace(/^\.\//u, '');
}

function queryForRuntimeRetrieval(
  retrieval: RagSemanticRuntimeRetrieveFact,
  options: Pick<RagRetrieveDocumentOptions, 'query' | 'queryParams' | 'templateParams'>,
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
    if (options.queryParams && Object.hasOwn(options.queryParams, retrieval.queryParam)) {
      const value = options.queryParams[retrieval.queryParam];
      if (value !== undefined) {
        if (typeof value === 'string') return value;
        throw new Error(
          `KERN RAG runtime retrieval '${retrieval.name}' requires queryParam '${retrieval.queryParam}' to be a string.`,
        );
      }
    }
    if (options.query !== undefined) return options.query;
    throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' requires queryParam '${retrieval.queryParam}'.`);
  }
  if (retrieval.queryTemplate) {
    return renderRagQueryTemplate(
      retrieval.queryTemplate,
      runtimeTemplateParams(options),
      `KERN RAG runtime retrieval '${retrieval.name}' queryTemplate`,
    );
  }
  throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' has no query source.`);
}

function runtimeTemplateParams(
  options: Pick<RagRetrieveDocumentOptions, 'queryParams' | 'templateParams'>,
): Readonly<Record<string, RagQueryTemplateParamValue | undefined>> | undefined {
  if (!options.queryParams) return options.templateParams;
  if (!options.templateParams) return options.queryParams;
  const merged: Record<string, RagQueryTemplateParamValue | undefined> = { ...options.queryParams };
  for (const [key, value] of Object.entries(options.templateParams)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function retrieveOptionsForFact(retrieval: RagSemanticRuntimeRetrieveFact): RetrieveOptions {
  const metadataFilter = cloneRagMetadataFilter(retrieval.metadataFilter);
  return {
    ...(retrieval.topK !== undefined ? { topK: retrieval.topK } : {}),
    ...(retrieval.minScore !== undefined ? { minScore: retrieval.minScore } : {}),
    ...(metadataFilter !== undefined ? { metadataFilter } : {}),
  };
}

function localPersistentStoreConfig(
  vectorStore: RagSemanticVectorStoreFact,
  index: RagSemanticIndexFact,
  embedder: Pick<Embedder, 'dims' | 'id'>,
  chunks: readonly RagChunkInput[],
  sourcePath: string,
): {
  readonly physicalKey: string;
  readonly directory: string;
  readonly fileName: string;
  readonly snapshotPath: string;
  readonly snapshotExists: boolean;
  readonly fingerprint: string;
} {
  if (!vectorStore.path?.trim()) {
    throw new Error(
      `KERN RAG vectorStore '${vectorStore.name}' kind=local-persistent requires path=<index directory>.`,
    );
  }
  if (isAbsolute(vectorStore.path)) {
    throw new Error(
      `KERN RAG vectorStore '${vectorStore.name}' kind=local-persistent requires a relative path inside the declaring .kern directory.`,
    );
  }
  const baseDir = dirname(resolve(sourcePath));
  const directory = resolve(baseDir, vectorStore.path);
  const relativeDirectory = relative(baseDir, directory);
  if (relativeDirectory.startsWith('..') || isAbsolute(relativeDirectory)) {
    throw new Error(
      `KERN RAG vectorStore '${vectorStore.name}' kind=local-persistent path must stay inside the declaring .kern directory.`,
    );
  }
  const confinedDirectory = confinedRealDirectory(vectorStore, baseDir, directory);
  const fileName = `${safeLocalStoreFileName(vectorStore.namespace ?? index.name)}.json`;
  const snapshotPath = resolve(confinedDirectory, fileName);
  const fingerprint = localPersistentFingerprint(vectorStore, index, embedder, chunks);
  return {
    physicalKey: JSON.stringify([confinedDirectory, fileName]),
    directory: confinedDirectory,
    fileName,
    snapshotPath,
    snapshotExists: existsSync(snapshotPath),
    fingerprint,
  };
}

function ensureLocalPersistentStoreIndexed(
  store: LocalPersistentRagVectorStoreAdapter,
  fingerprint: string,
  embedder: Embedder,
  chunks: readonly RagChunkInput[],
  snapshotExists: boolean,
): RagRetrieveIndexLifecycleStatus {
  const snapshot = store.snapshot();
  const actualChunks = snapshot.entries.map((entry) => entry.chunk);
  if (
    snapshot.fingerprint === fingerprint &&
    snapshot.entries.length === chunks.length &&
    stableChunkDigest(actualChunks) === stableChunkDigest(chunks)
  ) {
    return 'reused';
  }
  store.replaceAll(
    chunks.map((chunk) => ({
      chunk,
      vector: embedder.embed(chunk.text),
      fingerprint,
    })),
  );
  return snapshotExists || snapshot.entries.length > 0 ? 'rebuilt' : 'indexed';
}

async function ensureLocalPersistentStoreIndexedAsync(
  store: LocalPersistentRagVectorStoreAdapter,
  fingerprint: string,
  embedder: AsyncEmbedder,
  chunks: readonly RagChunkInput[],
  snapshotExists: boolean,
): Promise<RagRetrieveIndexLifecycleStatus> {
  const snapshot = store.snapshot();
  const actualChunks = snapshot.entries.map((entry) => entry.chunk);
  if (
    snapshot.fingerprint === fingerprint &&
    snapshot.entries.length === chunks.length &&
    stableChunkDigest(actualChunks) === stableChunkDigest(chunks)
  ) {
    return 'reused';
  }
  const vectors = await embedManyForRetrieve(
    embedder,
    chunks.map((chunk) => chunk.text),
  );
  if (vectors.length !== chunks.length) {
    throw new Error(`KERN async embedder returned ${vectors.length} vectors for ${chunks.length} inputs.`);
  }
  store.replaceAll(
    chunks.map((chunk, index) => ({
      chunk,
      vector: vectors[index],
      fingerprint,
    })),
  );
  return snapshotExists || snapshot.entries.length > 0 ? 'rebuilt' : 'indexed';
}

function closeLocalPersistentStores(
  entries: Iterable<{ readonly store: LocalPersistentRagVectorStoreAdapter }>,
): unknown {
  let firstError: unknown;
  for (const { store } of entries) {
    try {
      store.close();
    } catch (error) {
      firstError ??= error;
    }
  }
  return firstError;
}

function errorWithCloseError(error: unknown, closeError: unknown): unknown {
  if (!closeError) return error;
  const primary = error instanceof Error ? error : new Error(String(error));
  (primary as Error & { closeError?: unknown }).closeError = closeError;
  return primary;
}

function localPersistentFingerprint(
  vectorStore: RagSemanticVectorStoreFact,
  index: RagSemanticIndexFact,
  embedder: Pick<Embedder, 'dims' | 'id'>,
  chunks: readonly RagChunkInput[],
): string {
  return sha256(
    JSON.stringify({
      version: 'kern-rag-local-persistent-retrieve-v1',
      corpusName: index.corpusName,
      indexName: index.name,
      chunkingName: index.chunkingName ?? '',
      storeName: vectorStore.name,
      embedderId: embedder.id,
      dims: embedder.dims,
      chunks: stableChunkDigest(chunks),
    }),
  );
}

function stableChunkDigest(chunks: readonly RagChunkInput[]): string {
  return sha256(
    chunks
      .map((chunk) => stableJson(chunk))
      .sort(compareCodePoint)
      .join('\n'),
  );
}

function stableCorpusHashInput(chunks: readonly RagChunkInput[]): string {
  return chunks
    .map((chunk) => `${chunk.id}\0${chunk.source}\0${chunk.text}`)
    .sort(compareCodePoint)
    .join('\n');
}

function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function confinedRealDirectory(vectorStore: RagSemanticVectorStoreFact, baseDir: string, directory: string): string {
  const baseReal = realpathSync(baseDir);
  const existingAncestor = nearestExistingPath(directory);
  let ancestorReal: string;
  try {
    ancestorReal = realpathSync(existingAncestor);
  } catch {
    throw new Error(
      `KERN RAG vectorStore '${vectorStore.name}' kind=local-persistent path must stay inside the declaring .kern directory.`,
    );
  }
  const targetReal = resolve(ancestorReal, relative(existingAncestor, directory));
  if (!isPathInside(targetReal, baseReal)) {
    throw new Error(
      `KERN RAG vectorStore '${vectorStore.name}' kind=local-persistent path must stay inside the declaring .kern directory.`,
    );
  }
  return targetReal;
}

function nearestExistingPath(path: string): string {
  let current = path;
  while (!pathExistsOrSymlink(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function pathExistsOrSymlink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isPathInside(path: string, base: string): boolean {
  const rel = relative(base, path);
  const [firstSegment] = rel.split(/[\\/]/u);
  return rel === '' || (firstSegment !== '..' && !isAbsolute(rel));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function safeLocalStoreFileName(name: string): string {
  return name.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'index';
}

function embedderForIndex(facts: RagSemanticFacts, index: RagSemanticIndexFact): Embedder {
  const embed = embedFactForIndex(facts, index);
  const model = canonicalRagEmbedModel(embed?.model);
  const dims = embed?.dims ?? defaultDimsForRagEmbedModel(model);
  return resolveSyncRagEmbedderForModel(model, dims);
}

function asyncEmbedderForIndex(
  facts: RagSemanticFacts,
  index: RagSemanticIndexFact,
  options: Pick<RagRetrieveAsyncDocumentOptions, 'providers'>,
): AsyncEmbedder {
  const embed = embedFactForIndex(facts, index);
  const model = canonicalRagEmbedModel(embed?.model);
  const dims = embed?.dims ?? defaultDimsForRagEmbedModel(model);
  return resolveAsyncRagEmbedderForModel(model, dims, options);
}

function safeAsyncEmbedderForIndex(
  facts: RagSemanticFacts,
  index: RagSemanticIndexFact,
  options: Pick<RagRetrieveAsyncDocumentOptions, 'providers'>,
): AsyncEmbedder {
  try {
    return asyncEmbedderForIndex(facts, index, options);
  } catch (error) {
    throw providerError(error, index, { id: index.embedName ?? 'unresolved' });
  }
}

function ensureAsyncEmbedder(embedder: AsyncEmbedder | Embedder): AsyncEmbedder {
  return {
    id: embedder.id,
    dims: embedder.dims,
    embed: async (text: string) => embedder.embed(text),
    embedMany: async (texts: readonly string[]) => {
      const maybeBatch = (embedder as AsyncEmbedder).embedMany;
      if (maybeBatch) return maybeBatch.call(embedder, texts);
      return Promise.all(texts.map((text) => embedder.embed(text)));
    },
  };
}

function embedFactForIndex(facts: RagSemanticFacts, index: RagSemanticIndexFact) {
  const embed = index.embedName
    ? facts.corpora
        .filter((corpus) => corpus.name === index.corpusName)
        .flatMap((corpus) => corpus.embeds)
        .find((entry) => entry.name === index.embedName)
    : undefined;
  if (index.embedName && !embed) throw new Error(`KERN RAG embed '${index.embedName}' not found.`);
  return embed;
}

async function embedManyForRetrieve(
  embedder: AsyncEmbedder,
  texts: readonly string[],
): Promise<readonly Float64Array[]> {
  return embedder.embedMany ? embedder.embedMany(texts) : Promise.all(texts.map((text) => embedder.embed(text)));
}

class KernRagProviderError extends Error {
  readonly code = 'KERN_RAG_PROVIDER_ERROR';

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message);
    if (options && 'cause' in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

function providerError(error: unknown, index: RagSemanticIndexFact, embedder: Pick<AsyncEmbedder, 'id'>): Error {
  if (error instanceof KernRagProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new KernRagProviderError(
    `KERN RAG provider-backed retrieval failed for index '${index.name}' using embedder '${embedder.id}': ${sanitizeProviderMessage(message)}`,
    { cause: error },
  );
}

function sanitizeProviderMessage(message: string): string {
  const redacted = message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer ***')
    .replace(/\b(?:sk|pk|rk|api[_-]?key|token)[-_][A-Za-z0-9._~+/=-]{8,}/giu, (match) => {
      const [prefix] = match.split(/[-_]/u);
      return `${prefix}-***`;
    })
    .replace(/\b[A-Za-z0-9._~+/=-]{40,}\b/gu, '***');
  return redacted.length > 240 ? `${redacted.slice(0, 237)}...` : redacted;
}

export function ragRetrieveCorpusSourceSummary(report: RagRetrieveDocumentReport): string {
  const ingestion = report.ingestion;
  if (!ingestion) return '0 chunks';
  return `${ingestion.chunks.length} chunks, sha256=${ingestion.corpusSha256}`;
}
