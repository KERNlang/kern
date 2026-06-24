import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseDocument } from './parser.js';
import {
  canonicalRagEmbedModel,
  defaultDimsForRagEmbedModel,
  RAG_EMBED_MODEL_LOCAL_HASH,
  RAG_EMBED_MODEL_LOCAL_SEMANTIC,
  RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE,
  RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL,
  type RagProviderEmbeddingOptions,
} from './rag-embed-resolver.js';
import {
  type AsyncEmbedder,
  AsyncEmbeddingRagIndex,
  asAsyncEmbedder,
  DeterministicHashEmbedder,
  type Embedder,
  EmbeddingRagIndex,
  LocalSemanticEmbedder,
  OpenAIEmbeddingAdapter,
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

export interface RagRetrieveDocumentOptions {
  readonly sourcePath: string;
  /** Global query fallback used when a ragRetrieve has queryParam but no matching queryParams entry. */
  readonly query?: string;
  /** Named runtime query inputs. Values here take precedence over the global query fallback. */
  readonly queryParams?: Readonly<Record<string, string>>;
  /** Override embedder for local, synchronous retrieval tests and tools. Provider-backed retrieval is future async work. */
  readonly embedder?: Embedder;
}

export interface RagRetrieveAsyncDocumentOptions extends Omit<RagRetrieveDocumentOptions, 'embedder'> {
  /** Optional explicit async embedder override; otherwise resolved from ragIndex embed declarations. */
  readonly embedder?: AsyncEmbedder;
  /** Provider options. Supplying OpenAI here is the only path that can make network calls. */
  readonly providers?: RagProviderEmbeddingOptions;
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
 * The current synchronous path supports memory and local-persistent vector stores
 * over declared local sources. Provider vector stores remain future async work.
 */
export function retrieveRagDocument(source: string, options: RagRetrieveDocumentOptions): RagRetrieveDocumentReport {
  const root = parseDocument(source);
  const diagnostics = validateRagSemantics(root);
  if (diagnostics.length > 0) return { diagnostics, retrievals: [] };

  const facts = collectRagSemanticFacts(root);
  const indexByName = new Map(facts.indexes.map((index) => [index.name, index]));
  const vectorStoreByName = new Map(facts.vectorStores.map((store) => [store.name, store]));
  const preparedRetrievals = facts.runtimeRetrievals.map((retrieval) => {
    const index = indexByName.get(retrieval.indexName);
    if (!index) throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' references missing index.`);
    const vectorStore = vectorStoreByName.get(index.storeName);
    if (!vectorStore) {
      throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' references missing vector store.`);
    }
    const vectorStoreKind = vectorStore.kind ?? 'memory';
    if (vectorStoreKind !== 'memory' && vectorStoreKind !== 'local-persistent') {
      throw new Error(
        `KERN RAG runtime retrieval '${retrieval.name}' references vectorStore '${vectorStore.name}' kind='${vectorStoreKind}', but the synchronous ragRetrieve runner only supports kind=memory and kind=local-persistent.`,
      );
    }
    if (index.chunkingName) {
      throw new Error(
        `KERN RAG runtime retrieval '${retrieval.name}' references index '${index.name}' with chunking='${index.chunkingName}', which is not supported by the synchronous ragRetrieve runner yet.`,
      );
    }
    const query = queryForRuntimeRetrieval(retrieval, options);
    const embedder = options.embedder ?? embedderForIndex(facts, index.embedName);
    return { retrieval, index, query, embedder, vectorStore };
  });
  const corpusNames = Array.from(new Set(preparedRetrievals.map(({ index }) => index.corpusName))).sort();
  if (corpusNames.length === 0) return { diagnostics, retrievals: [] };

  const ingestion = ingestRagDeclaredLocalSources(root, {
    sourcePath: options.sourcePath,
    corpusNames,
  });
  const embeddingIndexByKey = new Map<string, EmbeddingRagIndex>();
  const persistentStoreByKey = new Map<
    string,
    { readonly fingerprint: string; readonly store: LocalPersistentRagVectorStoreAdapter }
  >();
  let retrievals: RagRetrieveDocumentEntry[] = [];
  let retrievalError: unknown;
  let closeError: unknown;
  try {
    retrievals = preparedRetrievals.map(({ retrieval, index, query, embedder, vectorStore }) => {
      const corpusChunks = ingestion.chunks.filter((chunk) => chunk.metadata?.corpusName === index.corpusName);
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
        ensureLocalPersistentStoreIndexed(store, fingerprint, embedder, corpusChunks);
        result = store.search(query, embedder.embed(query), retrieveOptions, fingerprint);
      } else {
        const cacheKey = JSON.stringify([index.corpusName, embedder.id, embedder.dims]);
        let embeddingIndex = embeddingIndexByKey.get(cacheKey);
        if (!embeddingIndex) {
          embeddingIndex = new EmbeddingRagIndex(corpusChunks, { embedder });
          embeddingIndexByKey.set(cacheKey, embeddingIndex);
        }
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
    if (closeError && retrievalError instanceof Error) {
      (retrievalError as Error & { closeError?: unknown }).closeError = closeError;
    }
    throw retrievalError;
  }
  if (closeError) throw closeError;

  return { diagnostics, retrievals, ingestion };
}

export async function retrieveRagDocumentAsync(
  source: string,
  options: RagRetrieveAsyncDocumentOptions,
): Promise<RagRetrieveDocumentReport> {
  const root = parseDocument(source);
  const diagnostics = validateRagSemantics(root);
  if (diagnostics.length > 0) return { diagnostics, retrievals: [] };

  const facts = collectRagSemanticFacts(root);
  const indexByName = new Map(facts.indexes.map((index) => [index.name, index]));
  const vectorStoreByName = new Map(facts.vectorStores.map((store) => [store.name, store]));
  const preparedRetrievals = facts.runtimeRetrievals.map((retrieval) => {
    const index = indexByName.get(retrieval.indexName);
    if (!index) throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' references missing index.`);
    const vectorStore = vectorStoreByName.get(index.storeName);
    if (!vectorStore) {
      throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' references missing vector store.`);
    }
    const vectorStoreKind = vectorStore.kind ?? 'memory';
    if (vectorStoreKind !== 'memory' && vectorStoreKind !== 'local-persistent') {
      throw new Error(
        `KERN RAG runtime retrieval '${retrieval.name}' references vectorStore '${vectorStore.name}' kind='${vectorStoreKind}', but the async ragRetrieve runner only supports kind=memory and kind=local-persistent.`,
      );
    }
    if (index.chunkingName) {
      throw new Error(
        `KERN RAG runtime retrieval '${retrieval.name}' references index '${index.name}' with chunking='${index.chunkingName}', which is not supported by the async ragRetrieve runner yet.`,
      );
    }
    const query = queryForRuntimeRetrieval(retrieval, options);
    const embedder = options.embedder ?? asyncEmbedderForIndex(facts, index.embedName, options);
    return { retrieval, index, query, embedder, vectorStore };
  });
  const corpusNames = Array.from(new Set(preparedRetrievals.map(({ index }) => index.corpusName))).sort();
  if (corpusNames.length === 0) return { diagnostics, retrievals: [] };

  const ingestion = ingestRagDeclaredLocalSources(root, {
    sourcePath: options.sourcePath,
    corpusNames,
  });
  const embeddingIndexByKey = new Map<string, Promise<AsyncEmbeddingRagIndex>>();
  const persistentStoreByKey = new Map<
    string,
    { readonly fingerprint: string; readonly store: LocalPersistentRagVectorStoreAdapter }
  >();
  const retrievals: RagRetrieveDocumentEntry[] = [];
  let retrievalError: unknown;
  let closeError: unknown;
  try {
    for (const { retrieval, index, query, embedder, vectorStore } of preparedRetrievals) {
      const corpusChunks = ingestion.chunks.filter((chunk) => chunk.metadata?.corpusName === index.corpusName);
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
        await ensureLocalPersistentStoreIndexedAsync(store, fingerprint, embedder, corpusChunks);
        result = store.search(query, await embedder.embed(query), retrieveOptions, fingerprint);
      } else {
        const cacheKey = JSON.stringify([index.corpusName, embedder.id, embedder.dims]);
        let embeddingIndex = embeddingIndexByKey.get(cacheKey);
        if (!embeddingIndex) {
          embeddingIndex = AsyncEmbeddingRagIndex.create(corpusChunks, { embedder });
          embeddingIndexByKey.set(cacheKey, embeddingIndex);
        }
        result = await (await embeddingIndex).retrieve(query, retrieveOptions);
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
    if (closeError && retrievalError instanceof Error) {
      (retrievalError as Error & { closeError?: unknown }).closeError = closeError;
    }
    throw retrievalError;
  }
  if (closeError) throw closeError;

  return { diagnostics, retrievals, ingestion };
}

function queryForRuntimeRetrieval(
  retrieval: RagSemanticRuntimeRetrieveFact,
  options: Pick<RagRetrieveDocumentOptions, 'query' | 'queryParams'>,
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

function localPersistentStoreConfig(
  vectorStore: RagSemanticVectorStoreFact,
  index: RagSemanticIndexFact,
  embedder: Pick<Embedder | AsyncEmbedder, 'dims' | 'id'>,
  chunks: readonly RagChunkInput[],
  sourcePath: string,
): {
  readonly physicalKey: string;
  readonly directory: string;
  readonly fileName: string;
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
  const fingerprint = localPersistentFingerprint(vectorStore, index, embedder, chunks);
  return {
    physicalKey: JSON.stringify([confinedDirectory, fileName]),
    directory: confinedDirectory,
    fileName,
    fingerprint,
  };
}

function ensureLocalPersistentStoreIndexed(
  store: LocalPersistentRagVectorStoreAdapter,
  fingerprint: string,
  embedder: Embedder,
  chunks: readonly RagChunkInput[],
): void {
  const snapshot = store.snapshot();
  const actualChunks = snapshot.entries.map((entry) => entry.chunk);
  if (snapshot.entries.length === chunks.length && stableChunkDigest(actualChunks) === stableChunkDigest(chunks)) {
    return;
  }
  store.replaceAll(
    chunks.map((chunk) => ({
      chunk,
      vector: embedder.embed(chunk.text),
      fingerprint,
    })),
  );
}

async function ensureLocalPersistentStoreIndexedAsync(
  store: LocalPersistentRagVectorStoreAdapter,
  fingerprint: string,
  embedder: AsyncEmbedder,
  chunks: readonly RagChunkInput[],
): Promise<void> {
  const snapshot = store.snapshot();
  const actualChunks = snapshot.entries.map((entry) => entry.chunk);
  if (snapshot.entries.length === chunks.length && stableChunkDigest(actualChunks) === stableChunkDigest(chunks)) {
    return;
  }
  const vectors = await embedManyForRetrieve(
    embedder,
    chunks.map((chunk) => chunk.text),
  );
  if (vectors.length !== chunks.length) {
    throw new Error(`KERN async embedder returned ${vectors.length} vectors for ${chunks.length} retrieval chunks.`);
  }
  store.replaceAll(
    chunks.map((chunk, index) => ({
      chunk,
      vector: vectors[index],
      fingerprint,
    })),
  );
}

async function embedManyForRetrieve(
  embedder: AsyncEmbedder,
  texts: readonly string[],
): Promise<readonly Float64Array[]> {
  return embedder.embedMany ? embedder.embedMany(texts) : Promise.all(texts.map((text) => embedder.embed(text)));
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

function localPersistentFingerprint(
  vectorStore: RagSemanticVectorStoreFact,
  index: RagSemanticIndexFact,
  embedder: Pick<Embedder | AsyncEmbedder, 'dims' | 'id'>,
  chunks: readonly RagChunkInput[],
): string {
  return sha256(
    JSON.stringify({
      version: 'kern-rag-local-persistent-retrieve-v1',
      corpusName: index.corpusName,
      indexName: index.name,
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
      .sort()
      .join('\n'),
  );
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

function asyncEmbedderForIndex(
  facts: RagSemanticFacts,
  embedName: string | undefined,
  options: Pick<RagRetrieveAsyncDocumentOptions, 'providers'>,
): AsyncEmbedder {
  const embed = embedName
    ? facts.corpora.flatMap((corpus) => corpus.embeds).find((entry) => entry.name === embedName)
    : undefined;
  if (embedName && !embed) throw new Error(`KERN RAG embed '${embedName}' not found.`);
  const model = canonicalRagEmbedModel(embed?.model);
  const dims = embed?.dims ?? defaultDimsForRagEmbedModel(model);
  if (model === RAG_EMBED_MODEL_LOCAL_HASH) return asAsyncEmbedder(new DeterministicHashEmbedder({ dims }));
  if (model === RAG_EMBED_MODEL_LOCAL_SEMANTIC) return asAsyncEmbedder(new LocalSemanticEmbedder());
  if (
    model === RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL ||
    model === RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE
  ) {
    const openai = options.providers?.openai;
    if (!openai?.apiKey?.trim()) throw new Error(`RAG embed model '${model}' requires OpenAI provider options.`);
    return new OpenAIEmbeddingAdapter({
      ...openai,
      apiKey: openai.apiKey,
      model: model.replace(/^openai:/u, ''),
      dims,
    });
  }
  throw new Error(`Unhandled RAG embed model '${model}'.`);
}

export function ragRetrieveCorpusSourceSummary(report: RagRetrieveDocumentReport): string {
  const ingestion = report.ingestion;
  if (!ingestion) return '0 chunks';
  return `${ingestion.chunks.length} chunks, sha256=${ingestion.corpusSha256}`;
}
