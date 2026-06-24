import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
  asAsyncEmbedder,
  DeterministicHashEmbedder,
  type Embedder,
  LocalSemanticEmbedder,
  OpenAIEmbeddingAdapter,
  RAG_VECTOR_STORE_SNAPSHOT_VERSION,
} from './rag-embedding.js';
import { LocalPersistentRagVectorStoreAdapter } from './rag-embedding-node.js';
import { ingestRagDeclaredLocalSources, type RagIngestResult } from './rag-ingest.js';
import type { RagChunkInput } from './rag-runtime.js';
import {
  collectRagSemanticFacts,
  type RagSemanticFacts,
  type RagSemanticIndexFact,
  type RagSemanticVectorStoreFact,
  type SemanticViolation,
  validateRagSemantics,
} from './semantic-validator.js';

const RAG_INDEX_MANIFEST_VERSION = 'kern-rag-index-manifest-v1';
const SNAPSHOT_MAX_BYTES = 100 * 1024 * 1024;

export interface RagIndexDocumentOptions {
  readonly sourcePath: string;
  readonly statusOnly?: boolean;
  readonly forceRebuild?: boolean;
  readonly embedder?: AsyncEmbedder | Embedder;
  readonly providers?: RagProviderEmbeddingOptions;
}

export type RagIndexSnapshotStatus = 'fresh' | 'missing' | 'stale' | 'corrupt' | 'incompatible' | 'skipped';
export type RagIndexLifecycleAction = 'indexed' | 'reused' | 'rebuilt' | 'inspected' | 'skipped';

export interface RagIndexDocumentReport {
  readonly diagnostics: readonly SemanticViolation[];
  readonly indexes: readonly RagIndexEntryReport[];
}

export interface RagIndexEntryReport {
  readonly indexName: string;
  readonly corpusName: string;
  readonly storeName: string;
  readonly storeKind: string;
  readonly status: RagIndexSnapshotStatus;
  readonly action: RagIndexLifecycleAction;
  readonly reason: string;
  readonly chunkCount: number;
  readonly fingerprint?: string;
  readonly snapshotPath?: string;
  readonly manifestPath?: string;
  readonly provenance?: RagIndexProvenance;
}

export interface RagIndexProvenance {
  readonly schemaVersion: typeof RAG_INDEX_MANIFEST_VERSION;
  readonly corpus: {
    readonly name: string;
    readonly corpusSha256: string;
    readonly files: readonly { readonly path: string; readonly sha256: string }[];
  };
  readonly chunking: {
    readonly chunkerVersions: readonly string[];
    readonly chunkingNames: readonly string[];
  };
  readonly embed: {
    readonly id: string;
    readonly model: string;
    readonly dims: number;
    readonly metric: string;
  };
  readonly store: {
    readonly name: string;
    readonly kind: 'local-persistent';
    readonly path: string;
    readonly namespace: string;
    readonly fileName: string;
    readonly metric: string;
  };
  readonly chunks: {
    readonly count: number;
    readonly digest: string;
  };
}

interface LocalPersistentIndexConfig {
  readonly physicalKey: string;
  readonly directory: string;
  readonly fileName: string;
  readonly snapshotPath: string;
  readonly manifestPath: string;
  readonly displaySnapshotPath: string;
  readonly displayManifestPath: string;
  readonly snapshotExists: boolean;
  readonly manifestExists: boolean;
  readonly fingerprint: string;
  readonly provenance: RagIndexProvenance;
}

interface Inspection {
  readonly status: RagIndexSnapshotStatus;
  readonly reason: string;
}

export async function indexRagDocumentAsync(
  source: string,
  options: RagIndexDocumentOptions,
): Promise<RagIndexDocumentReport> {
  const root = parseDocument(source);
  const diagnostics = validateRagSemantics(root);
  if (diagnostics.length > 0) return { diagnostics, indexes: [] };

  const facts = collectRagSemanticFacts(root);
  const stores = new Map(facts.vectorStores.map((store) => [store.name, store]));
  const byPhysicalKey = new Map<string, LocalPersistentIndexConfig>();
  const indexes: RagIndexEntryReport[] = [];

  for (const index of facts.indexes) {
    const store = stores.get(index.storeName);
    if (!store) continue;
    const storeKind = store.kind ?? 'memory';
    if (storeKind !== 'local-persistent') {
      indexes.push({
        indexName: index.name,
        corpusName: index.corpusName,
        storeName: store.name,
        storeKind,
        status: 'skipped',
        action: 'skipped',
        reason: `vectorStore kind='${storeKind}' has no reusable local snapshot`,
        chunkCount: 0,
      });
      continue;
    }

    const identity = options.embedder
      ? { id: options.embedder.id, dims: options.embedder.dims }
      : embedderIdentityForIndex(facts, index, options);
    const ingestion = ingestRagDeclaredLocalSources(root, {
      sourcePath: options.sourcePath,
      corpusNames: [index.corpusName],
      chunkingNameByCorpus: { [index.corpusName]: index.chunkingName },
    });
    const chunks = ingestion.chunks.filter((chunk) => chunk.metadata?.corpusName === index.corpusName);
    const config = localPersistentIndexConfig(facts, store, index, identity, chunks, ingestion, options.sourcePath);
    const existing = byPhysicalKey.get(config.physicalKey);
    if (existing && existing.fingerprint !== config.fingerprint) {
      throw new Error(
        `KERN RAG vectorStore '${store.name}' resolves to local snapshot '${config.fileName}' with multiple incompatible fingerprints. Use distinct namespace or path values for each local-persistent index.`,
      );
    }
    byPhysicalKey.set(config.physicalKey, config);

    const inspection = inspectIndex(config, chunks);
    if (options.statusOnly) {
      indexes.push(indexReport(index, store, chunks, config, inspection, 'inspected'));
      continue;
    }
    if (inspection.status === 'fresh' && !options.forceRebuild) {
      indexes.push(indexReport(index, store, chunks, config, inspection, 'reused'));
      continue;
    }

    const embedder = options.embedder
      ? ensureAsyncEmbedder(options.embedder)
      : asyncEmbedderForIndex(facts, index, options);
    const action = config.snapshotExists || config.manifestExists ? 'rebuilt' : 'indexed';
    await rebuildIndex(config, embedder, chunks);
    indexes.push(indexReport(index, store, chunks, config, inspection, action));
  }

  return { diagnostics, indexes };
}

function localPersistentIndexConfig(
  facts: RagSemanticFacts,
  store: RagSemanticVectorStoreFact,
  index: RagSemanticIndexFact,
  embedder: Pick<Embedder, 'dims' | 'id'>,
  chunks: readonly RagChunkInput[],
  ingestion: RagIngestResult,
  sourcePath: string,
): LocalPersistentIndexConfig {
  if (!store.path?.trim()) {
    throw new Error(`KERN RAG vectorStore '${store.name}' kind=local-persistent requires path=<index directory>.`);
  }
  if (isAbsolute(store.path)) {
    throw new Error(
      `KERN RAG vectorStore '${store.name}' kind=local-persistent requires a relative path inside the declaring .kern directory.`,
    );
  }
  const baseDir = dirname(resolve(sourcePath));
  const directory = resolve(baseDir, store.path);
  const relativeDirectory = relative(baseDir, directory);
  if (relativeDirectory.startsWith('..') || isAbsolute(relativeDirectory)) {
    throw new Error(
      `KERN RAG vectorStore '${store.name}' kind=local-persistent path must stay inside the declaring .kern directory.`,
    );
  }

  const confinedDirectory = confinedRealDirectory(store, baseDir, directory);
  const fileName = `${safeLocalStoreFileName(store.namespace ?? index.name)}.json`;
  const manifestName = `${fileName.replace(/\.json$/u, '')}.manifest.json`;
  const snapshotPath = resolve(confinedDirectory, fileName);
  const manifestPath = resolve(confinedDirectory, manifestName);
  const provenance = provenanceForIndex(facts, store, index, embedder, chunks, ingestion, sourcePath, fileName);
  const fingerprint = retrieveCompatibleFingerprint(store, index, embedder, chunks);
  return {
    physicalKey: JSON.stringify([confinedDirectory, fileName]),
    directory: confinedDirectory,
    fileName,
    snapshotPath,
    manifestPath,
    displaySnapshotPath: displayPath(store, fileName),
    displayManifestPath: displayPath(store, manifestName),
    snapshotExists: existsSync(snapshotPath),
    manifestExists: existsSync(manifestPath),
    fingerprint,
    provenance,
  };
}

function inspectIndex(config: LocalPersistentIndexConfig, chunks: readonly RagChunkInput[]): Inspection {
  if (!config.snapshotExists && !config.manifestExists) {
    return { status: 'missing', reason: 'snapshot and manifest are missing' };
  }
  if (!config.manifestExists) return { status: 'missing', reason: 'manifest is missing' };
  const manifest = readJson(config.manifestPath);
  if (manifest.status !== 'ok') return manifest;
  const manifestRecord = manifest.value as { schemaVersion?: unknown; fingerprint?: unknown; snapshotFile?: unknown };
  if (manifestRecord.schemaVersion !== RAG_INDEX_MANIFEST_VERSION) {
    return { status: 'incompatible', reason: 'manifest schema version is not supported' };
  }
  if (manifestRecord.fingerprint !== config.fingerprint) {
    return { status: 'stale', reason: 'manifest fingerprint differs from current corpus/index provenance' };
  }
  if (manifestRecord.snapshotFile !== config.fileName) {
    return { status: 'incompatible', reason: 'manifest references a different snapshot file' };
  }
  if (!config.snapshotExists) return { status: 'missing', reason: 'snapshot is missing' };

  const snapshot = readJson(config.snapshotPath);
  if (snapshot.status !== 'ok') return snapshot;
  const candidate = snapshot.value as {
    readonly version?: unknown;
    readonly fingerprint?: unknown;
    readonly dims?: unknown;
    readonly metric?: unknown;
    readonly entries?: { readonly chunk: RagChunkInput; readonly vector: unknown[]; readonly fingerprint: unknown }[];
  };
  if (candidate.version !== RAG_VECTOR_STORE_SNAPSHOT_VERSION) {
    return { status: 'incompatible', reason: 'snapshot version is not supported' };
  }
  if (candidate.fingerprint !== config.fingerprint) {
    return { status: 'stale', reason: 'snapshot fingerprint differs from current provenance' };
  }
  if (candidate.dims !== config.provenance.embed.dims) {
    return { status: 'incompatible', reason: 'snapshot dimensions differ from current embed model' };
  }
  if (candidate.metric !== config.provenance.store.metric) {
    return { status: 'incompatible', reason: 'snapshot metric differs from current vector store metric' };
  }
  if (!Array.isArray(candidate.entries)) return { status: 'corrupt', reason: 'snapshot entries must be an array' };
  if (candidate.entries.some((entry) => entry.fingerprint !== config.fingerprint)) {
    return { status: 'stale', reason: 'snapshot entry fingerprint differs from current provenance' };
  }
  if (stableRagChunkDigest(candidate.entries.map((entry) => entry.chunk)) !== stableRagChunkDigest(chunks)) {
    return { status: 'stale', reason: 'snapshot chunks differ from current corpus chunks' };
  }
  return { status: 'fresh', reason: 'snapshot and manifest match current provenance' };
}

async function rebuildIndex(
  config: LocalPersistentIndexConfig,
  embedder: AsyncEmbedder,
  chunks: readonly RagChunkInput[],
): Promise<void> {
  const store = new LocalPersistentRagVectorStoreAdapter({
    directory: config.directory,
    fileName: config.fileName,
    fingerprint: config.fingerprint,
    dims: embedder.dims,
    rebuildOnFingerprintMismatch: true,
    rebuildOnSnapshotLoadFailure: true,
  });
  let rebuildError: unknown;
  try {
    let vectors: readonly Float64Array[];
    try {
      vectors = embedder.embedMany
        ? await embedder.embedMany(chunks.map((chunk) => chunk.text))
        : await Promise.all(chunks.map((chunk) => embedder.embed(chunk.text)));
    } catch (error) {
      throw providerError(error, config, embedder);
    }
    if (vectors.length !== chunks.length) {
      throw new Error(`KERN async embedder returned ${vectors.length} vectors for ${chunks.length} inputs.`);
    }
    store.replaceAll(
      chunks.map((chunk, index) => ({ chunk, vector: vectors[index], fingerprint: config.fingerprint })),
    );
    writeManifest(config);
  } catch (error) {
    rebuildError = error;
  }
  let closeError: unknown;
  try {
    store.close();
  } catch (error) {
    closeError = error;
  }
  if (rebuildError) throw errorWithCloseError(rebuildError, closeError);
  if (closeError) {
    const wrapped = new Error(`KERN RAG index '${config.provenance.store.namespace}' rebuilt but failed to close.`);
    (wrapped as Error & { cause?: unknown }).cause = closeError;
    throw wrapped;
  }
}

function writeManifest(config: LocalPersistentIndexConfig): void {
  const payload = {
    schemaVersion: RAG_INDEX_MANIFEST_VERSION,
    fingerprint: config.fingerprint,
    indexName: config.provenance.store.namespace,
    corpusName: config.provenance.corpus.name,
    storeName: config.provenance.store.name,
    snapshotFile: config.fileName,
    builtAt: new Date().toISOString(),
    provenance: config.provenance,
  };
  const tmp = `${config.manifestPath}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    renameSync(tmp, config.manifestPath);
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
}

function indexReport(
  index: RagSemanticIndexFact,
  store: RagSemanticVectorStoreFact,
  chunks: readonly RagChunkInput[],
  config: LocalPersistentIndexConfig,
  inspection: Inspection,
  action: RagIndexLifecycleAction,
): RagIndexEntryReport {
  return {
    indexName: index.name,
    corpusName: index.corpusName,
    storeName: store.name,
    storeKind: 'local-persistent',
    status: inspection.status,
    action,
    reason: inspection.reason,
    chunkCount: chunks.length,
    fingerprint: config.fingerprint,
    snapshotPath: config.displaySnapshotPath,
    manifestPath: config.displayManifestPath,
    provenance: config.provenance,
  };
}

function provenanceForIndex(
  facts: RagSemanticFacts,
  store: RagSemanticVectorStoreFact,
  index: RagSemanticIndexFact,
  embedder: Pick<Embedder, 'dims' | 'id'>,
  chunks: readonly RagChunkInput[],
  ingestion: RagIngestResult,
  sourcePath: string,
  fileName: string,
): RagIndexProvenance {
  const embed = embedFactForIndex(facts, index);
  const model = canonicalRagEmbedModel(embed?.model);
  const baseDir = dirname(resolve(sourcePath));
  const files = Array.from(new Set(ingestion.sources.flatMap((source) => source.files)))
    .map((filePath) => ({ path: normalizePath(relative(baseDir, filePath)), sha256: sha256(readFileSync(filePath)) }))
    .sort((a, b) => compareCodePoint(a.path, b.path));
  const chunkerVersions = sortedStrings(chunks.map((chunk) => String(chunk.metadata?.chunkerVersion ?? 'unknown')));
  const chunkingNames = sortedStrings(
    chunks.map((chunk) =>
      chunk.metadata?.chunkingName === undefined ? '(default)' : String(chunk.metadata.chunkingName),
    ),
  );
  return {
    schemaVersion: RAG_INDEX_MANIFEST_VERSION,
    corpus: { name: index.corpusName, corpusSha256: ingestion.corpusSha256, files },
    chunking: { chunkerVersions, chunkingNames },
    embed: { id: embedder.id, dims: embedder.dims, model, metric: embed?.metric ?? store.metric ?? 'cosine' },
    store: {
      name: store.name,
      kind: 'local-persistent',
      path: store.path ?? '.',
      namespace: store.namespace ?? index.name,
      fileName,
      metric: store.metric ?? 'cosine',
    },
    chunks: { count: chunks.length, digest: stableRagChunkDigest(chunks) },
  };
}

function retrieveCompatibleFingerprint(
  store: RagSemanticVectorStoreFact,
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
      storeName: store.name,
      embedderId: embedder.id,
      dims: embedder.dims,
      chunks: stableRagChunkDigest(chunks),
    }),
  );
}

export function stableRagChunkDigest(chunks: readonly RagChunkInput[]): string {
  return sha256(
    chunks
      .map((chunk) => stableJson(chunk))
      .sort(compareCodePoint)
      .join('\n'),
  );
}

function embedderIdentityForIndex(
  facts: RagSemanticFacts,
  index: RagSemanticIndexFact,
  options: Pick<RagIndexDocumentOptions, 'providers'>,
): Pick<Embedder, 'dims' | 'id'> {
  const embed = embedFactForIndex(facts, index);
  const model = canonicalRagEmbedModel(embed?.model);
  const dims = embed?.dims ?? defaultDimsForRagEmbedModel(model);
  if (model === RAG_EMBED_MODEL_LOCAL_HASH) return { id: new DeterministicHashEmbedder({ dims }).id, dims };
  if (model === RAG_EMBED_MODEL_LOCAL_SEMANTIC) return { id: new LocalSemanticEmbedder().id, dims };
  if (
    model === RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL ||
    model === RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE
  ) {
    return { id: `${openAIBaseId(model, dims)}:provider=${openAIProviderScope(options.providers?.openai)}`, dims };
  }
  throw new Error(`Unhandled RAG embed model '${String(model)}'.`);
}

function asyncEmbedderForIndex(
  facts: RagSemanticFacts,
  index: RagSemanticIndexFact,
  options: Pick<RagIndexDocumentOptions, 'providers'>,
): AsyncEmbedder {
  const embed = embedFactForIndex(facts, index);
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
    const adapter = new OpenAIEmbeddingAdapter({
      ...openai,
      apiKey: openai.apiKey,
      model: model.replace(/^openai:/u, ''),
      dims,
    });
    return {
      id: `${adapter.id}:provider=${openAIProviderScope(openai)}`,
      dims,
      embed: (text) => adapter.embed(text),
      embedMany: (texts) => adapter.embedMany(texts),
    };
  }
  throw new Error(`Unhandled RAG embed model '${String(model)}'.`);
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

function ensureAsyncEmbedder(embedder: AsyncEmbedder | Embedder): AsyncEmbedder {
  return {
    id: embedder.id,
    dims: embedder.dims,
    embed: async (text) => embedder.embed(text),
    embedMany: async (texts) => {
      const maybeBatch = (embedder as AsyncEmbedder).embedMany;
      return maybeBatch ? maybeBatch.call(embedder, texts) : Promise.all(texts.map((text) => embedder.embed(text)));
    },
  };
}

function providerError(error: unknown, config: LocalPersistentIndexConfig, embedder: Pick<AsyncEmbedder, 'id'>): Error {
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = new Error(
    `KERN RAG provider-backed indexing failed for index '${config.provenance.store.namespace}' using embedder '${embedder.id}': ${sanitizeProviderMessage(message)}`,
  );
  (wrapped as Error & { cause?: unknown }).cause = error;
  return wrapped;
}

function sanitizeProviderMessage(message: string): string {
  const redacted = message
    .replace(/\bBearer\s+[^\s,;)]+/giu, 'Bearer ***')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9._~+/=-]{4,}/giu, (match) => `${match.split('-')[0]}-***`)
    .replace(/([?&](?:api[_-]?key|token|access_token)=)[^&\s]+/giu, '$1***');
  return redacted.length > 240 ? `${redacted.slice(0, 237)}...` : redacted;
}

function errorWithCloseError(error: unknown, closeError: unknown): unknown {
  if (!closeError) return error;
  const primary = error instanceof Error ? error : new Error(String(error));
  (primary as Error & { closeError?: unknown }).closeError = closeError;
  return primary;
}

function readJson(path: string): { readonly status: 'ok'; readonly value: unknown } | Inspection {
  try {
    if (statSync(path).size > SNAPSHOT_MAX_BYTES) return { status: 'corrupt', reason: `${path} is too large` };
    return { status: 'ok', value: JSON.parse(readFileSync(path, 'utf-8')) };
  } catch (error) {
    const message =
      error instanceof SyntaxError ? 'is not valid JSON' : `could not be read: ${(error as Error).message}`;
    return { status: error instanceof SyntaxError ? 'corrupt' : 'missing', reason: message };
  }
}

function confinedRealDirectory(store: RagSemanticVectorStoreFact, baseDir: string, directory: string): string {
  const baseReal = realpathSync(baseDir);
  const existingAncestor = nearestExistingPath(directory);
  let ancestorReal: string;
  try {
    ancestorReal = realpathSync(existingAncestor);
  } catch {
    throw new Error(
      `KERN RAG vectorStore '${store.name}' kind=local-persistent path must stay inside the declaring .kern directory.`,
    );
  }
  const targetReal = resolve(ancestorReal, relative(existingAncestor, directory));
  if (!isPathInside(targetReal, baseReal)) {
    throw new Error(
      `KERN RAG vectorStore '${store.name}' kind=local-persistent path must stay inside the declaring .kern directory.`,
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

function displayPath(store: RagSemanticVectorStoreFact, fileName: string): string {
  return `${store.path?.replace(/\\/gu, '/').replace(/\/+$/u, '') ?? '.'}/${fileName}`.replace(/^\.\//u, '');
}

function openAIBaseId(model: string, dims: number): string {
  return `openai:${model.replace(/^openai:/u, '')}:dims=${dims}`;
}

function openAIProviderScope(openai: RagProviderEmbeddingOptions['openai'] | undefined): string {
  return sha256(
    stableJson({
      endpoint: openai?.endpoint ?? 'https://api.openai.com/v1/embeddings',
      fetch: openai?.fetch ? 'custom-fetch' : 'global-fetch',
    }),
  ).slice(0, 12);
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values)).sort(compareCodePoint);
}

function safeLocalStoreFileName(name: string): string {
  return name.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'index';
}

function normalizePath(path: string): string {
  return path.replace(/\\/gu, '/');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareCodePoint)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}
