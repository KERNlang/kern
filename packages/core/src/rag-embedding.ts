/**
 * Runner-native RAG retrieval seam (P1).
 *
 * KERN doctrine: "own the meaning, borrow the calculator." The RAG *contract*
 * layer (grounding/citation/eval rules) already exists; this module supplies a
 * real, deterministic retrieval *engine* behind the existing seam signature
 * `RagContractRetriever = (query, options?) => RetrieveResult` so that
 * `evaluateRagEvalContract` can run against actual cosine retrieval instead of
 * the lexical-Jaccard reference corpus.
 *
 * Two pieces:
 *   - {@link DeterministicHashEmbedder}: a zero-dependency, byte-reproducible
 *     embedder (feature-hashed token presence, L2-normalised). It is a
 *     *determinism substrate*, NOT a quality model — semantic embedders plug in
 *     behind the same {@link Embedder} seam later (P1.5).
 *   - {@link EmbeddingRagIndex}: cosine ranking over embedded chunks, mirroring
 *     the ordering/filtering/citation-defaulting contract of
 *     `InMemoryRagCorpus` so downstream eval behaviour is unchanged except for
 *     the scoring function.
 *
 * Determinism (so eval is reproducible across runs and, later, across emitted
 * targets): pinned tokenisation (`tokenizeForRetrieval`, NFKC + casefold),
 * FNV-1a-32 feature hashing with a fixed offset basis, left-fold accumulation,
 * and integerised fixed-point score rounding with signed-zero normalisation.
 */

import {
  type AsyncRagContractRetriever,
  MAX_IN_MEMORY_RAG_TOP_K,
  type RagChunkInput,
  type RagContractRetriever,
  type RetrievedChunk,
  type RetrieveOptions,
  type RetrieveResult,
  tokenizeForRetrieval,
} from './rag-runtime.js';

/** Pluggable text→vector embedder. Implementations must be pure + deterministic. */
export interface Embedder {
  /** Stable identity (model + version) recorded for reproducibility, e.g. `local-hash-v1`. */
  readonly id: string;
  /** Vector dimensionality. */
  readonly dims: number;
  /** Embed `text` into a fixed-length vector. Same input → identical output. */
  embed(text: string): Float64Array;
}

/** Async text→vector embedder for provider-backed models. */
export interface AsyncEmbedder {
  /** Stable identity (provider + model + version) recorded for reproducibility. */
  readonly id: string;
  /** Vector dimensionality. */
  readonly dims: number;
  /** Embed `text` into a fixed-length vector. */
  embed(text: string): Promise<Float64Array>;
  /** Embed a batch of texts into fixed-length vectors, preserving input order. */
  embedMany?(texts: readonly string[]): Promise<readonly Float64Array[]>;
}

export interface EmbeddingFingerprintInput {
  readonly provider: string;
  readonly model: string;
  readonly dims: number;
  readonly metric: 'cosine';
}

export const DEFAULT_EMBEDDING_DIMS = 256;
export const DEFAULT_HASH_EMBEDDER_ID = 'local-hash-v1';
export const DEFAULT_LOCAL_SEMANTIC_EMBEDDER_ID = 'local-semantic-v1';
/** Scores are rounded to this many decimals (integerised fixed-point) for stable equality. */
export const EMBEDDING_SCORE_DECIMALS = 6;

const SCORE_SCALE = 1_000_000;
const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const LOCAL_SEMANTIC_DIMS = 64;
const ASYNC_EMBED_BATCH_SIZE = 128;
const ASYNC_QUERY_CACHE_MAX_ENTRIES = 256;

/** Deterministic 32-bit FNV-1a over the UTF-8 bytes of `token`. Never the platform `hash()`. */
export function fnv1a32(token: string): number {
  let hash = FNV_OFFSET_BASIS_32;
  const bytes = new TextEncoder().encode(token);
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Zero-dependency determinism-substrate embedder: feature-hash the pinned token
 * set into `dims` buckets (presence), then L2-normalise. Pure string/integer +
 * float math, so it reproduces byte-identically wherever it is reimplemented.
 */
export class DeterministicHashEmbedder implements Embedder {
  readonly id: string;
  readonly dims: number;

  constructor(options: { readonly dims?: number; readonly id?: string } = {}) {
    const dims = options.dims ?? DEFAULT_EMBEDDING_DIMS;
    if (!Number.isInteger(dims) || dims <= 0) {
      throw new Error('KERN embedder dims must be a positive integer.');
    }
    this.dims = dims;
    this.id = options.id ?? DEFAULT_HASH_EMBEDDER_ID;
  }

  embed(text: string): Float64Array {
    const vector = new Float64Array(this.dims);
    for (const token of tokenizeForRetrieval(text)) {
      vector[fnv1a32(token) % this.dims] += 1;
    }
    const norm = vectorNorm(vector);
    if (norm === 0) return vector;
    for (let i = 0; i < vector.length; i += 1) {
      vector[i] = vector[i] / norm;
    }
    return vector;
  }
}

/**
 * Small zero-network semantic embedder for runner-native eval.
 *
 * This is deliberately versioned separately from `local-hash-v1`: known
 * synonym/domain terms project into shared semantic axes, while unknown words
 * still contribute deterministic hashed lexical features. It is not a neural
 * model, but it is a real semantic lookup embedder with deterministic OOV
 * fallback and a stable upgrade path for a future provider/model embedder.
 */
export class LocalSemanticEmbedder implements Embedder {
  readonly id: string;
  readonly dims: number;

  constructor(options: { readonly id?: string } = {}) {
    this.id = options.id ?? DEFAULT_LOCAL_SEMANTIC_EMBEDDER_ID;
    this.dims = LOCAL_SEMANTIC_DIMS;
  }

  embed(text: string): Float64Array {
    const vector = new Float64Array(this.dims);
    const tokens = Array.from(tokenizeForRetrieval(text));
    for (const token of tokens) {
      const axis = SEMANTIC_AXIS_BY_TOKEN.get(token);
      if (axis !== undefined) {
        vector[axis] += 1;
        addHashedFeature(vector, `semantic:${axis}:${token}`, 0.15);
      } else {
        addHashedFeature(vector, `token:${token}`, 0.35);
      }
      for (const ngram of charNgrams(token)) {
        addHashedFeature(vector, `char:${ngram}`, 0.08);
      }
    }
    const norm = vectorNorm(vector);
    if (norm === 0) return vector;
    for (let i = 0; i < vector.length; i += 1) {
      vector[i] = vector[i] / norm;
    }
    return vector;
  }
}

export function asAsyncEmbedder(embedder: Embedder): AsyncEmbedder {
  return {
    id: embedder.id,
    dims: embedder.dims,
    embed: async (text: string) => embedder.embed(text),
    embedMany: async (texts: readonly string[]) => texts.map((text) => embedder.embed(text)),
  };
}

export interface OpenAIEmbeddingAdapterOptions {
  readonly model: string;
  readonly dims: number;
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
}

export class OpenAIEmbeddingAdapter implements AsyncEmbedder {
  readonly id: string;
  readonly dims: number;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIEmbeddingAdapterOptions) {
    if (!Number.isInteger(options.dims) || options.dims <= 0) {
      throw new Error('KERN OpenAI embedder dims must be a positive integer.');
    }
    this.model = options.model.replace(/^openai:/u, '');
    this.dims = options.dims;
    this.id = `openai:${this.model}:dims=${this.dims}`;
    this.apiKey = options.apiKey?.trim();
    if (!this.apiKey) {
      throw new Error('KERN OpenAI embedder requires an apiKey.');
    }
    if (/[\r\n]/u.test(this.apiKey)) {
      throw new Error('KERN OpenAI embedder apiKey must not contain newlines.');
    }
    this.endpoint = options.endpoint ?? 'https://api.openai.com/v1/embeddings';
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('KERN OpenAI embedder requires a fetch implementation.');
    }
    this.fetchImpl = fetchImpl;
  }

  async embed(text: string): Promise<Float64Array> {
    return (await this.embedMany([text]))[0];
  }

  async embedMany(texts: readonly string[]): Promise<readonly Float64Array[]> {
    if (texts.length === 0) return [];
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: texts.length === 1 ? texts[0] : texts,
          dimensions: this.dims,
        }),
      });
    } catch (error) {
      throw new Error(`KERN OpenAI embedder request failed: ${(error as Error).message}`);
    }
    if (!response.ok) {
      throw new Error(`KERN OpenAI embedder request failed with HTTP ${response.status}.`);
    }
    const body = (await response.json()) as unknown;
    return openAIEmbeddingVectors(body, texts.length, this.model, this.dims).map((vector) => new Float64Array(vector));
  }
}

function openAIEmbeddingVectors(body: unknown, expectedCount: number, model: string, dims: number): number[][] {
  if (!body || typeof body !== 'object') throw new Error('KERN OpenAI embedder returned invalid JSON.');
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) throw new Error('KERN OpenAI embedder returned no embeddings.');
  if (data.length !== expectedCount) {
    throw new Error(`KERN OpenAI embedder returned ${data.length} embeddings, expected ${expectedCount}.`);
  }
  return data.map((entry) => {
    const embedding = (entry as { embedding?: unknown } | undefined)?.embedding;
    if (!Array.isArray(embedding) || embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error('KERN OpenAI embedder returned a malformed embedding vector.');
    }
    if (embedding.length !== dims) {
      throw new Error(`KERN OpenAI embedder returned ${embedding.length} dimensions for '${model}', expected ${dims}.`);
    }
    return embedding as number[];
  });
}

const SEMANTIC_GROUPS: readonly (readonly string[])[] = [
  ['refund', 'refunds', 'return', 'returns', 'exchange', 'reimburse', 'moneyback', 'chargeback'],
  ['shipping', 'ship', 'delivery', 'deliver', 'courier', 'parcel', 'tracking', 'shipment'],
  ['account', 'user', 'profile', 'login', 'auth', 'authentication', 'register', 'signup'],
  ['policy', 'rule', 'contract', 'terms', 'requirement', 'guarantee'],
  ['error', 'failure', 'exception', 'diagnostic', 'violation', 'invalid'],
  ['search', 'retrieval', 'retrieve', 'rank', 'ranking', 'query', 'index'],
  ['chunk', 'chunking', 'segment', 'section', 'paragraph', 'window'],
  ['embed', 'embedding', 'vector', 'semantic', 'similarity', 'cosine'],
  ['car', 'automobile', 'vehicle', 'auto'],
  ['dog', 'puppy', 'canine', 'hound'],
  ['weather', 'forecast', 'rain', 'sunshine', 'temperature'],
] as const;

const SEMANTIC_AXIS_BY_TOKEN = new Map<string, number>(
  SEMANTIC_GROUPS.flatMap((group, index) => group.map((token) => [token, index] as const)),
);

function addHashedFeature(vector: Float64Array, feature: string, weight: number): void {
  const hash = fnv1a32(feature);
  const index = hash % vector.length;
  const sign = (hash & 0x80000000) === 0 ? 1 : -1;
  vector[index] += sign * weight;
}

function charNgrams(token: string): string[] {
  const padded = `^${token}$`;
  const out: string[] = [];
  for (let n = 3; n <= 5; n += 1) {
    if (padded.length < n) continue;
    for (let i = 0; i <= padded.length - n; i += 1) out.push(padded.slice(i, i + n));
  }
  return out;
}

/** L2 norm via left-fold (pinned accumulation order). */
function vectorNorm(vector: Float64Array): number {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i += 1) {
    sumSquares += vector[i] * vector[i];
  }
  return Math.sqrt(sumSquares);
}

/**
 * Cosine similarity of two vectors, rounded to a stable fixed-point score in
 * [0, 1]. For non-negative (feature-hash) vectors cosine is already in [0, 1];
 * the clamp guards float error, and signed zero is normalised to `+0`.
 */
export function embeddingCosine(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length) {
    throw new Error('KERN embedding vectors must share dimensionality.');
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return roundScore(dot / (Math.sqrt(normA) * Math.sqrt(normB)));
}

function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * SCORE_SCALE) / SCORE_SCALE;
  const clamped = rounded < 0 ? 0 : rounded > 1 ? 1 : rounded;
  // Normalise signed zero (`-0 → 0`) so equality/serialisation is stable.
  return clamped === 0 ? 0 : clamped;
}

interface IndexedChunk {
  readonly chunk: RagChunkInput;
  readonly vector: Float64Array;
}

/**
 * Cosine-ranked retrieval index implementing the `RagContractRetriever` seam.
 * Ordering, filtering and citation defaulting mirror `InMemoryRagCorpus`; only
 * the scoring function (cosine over embeddings vs. Jaccard over tokens) differs.
 */
export class EmbeddingRagIndex {
  private readonly embedder: Embedder;
  // Keyed by chunk id so duplicate ids upsert (last-write-wins), matching
  // `InMemoryRagCorpus` rather than returning duplicates that would later trip
  // `validateRetrieveResult`'s duplicate-id guard.
  private readonly entries = new Map<string, IndexedChunk>();

  constructor(chunks: Iterable<RagChunkInput> = [], options: { readonly embedder?: Embedder } = {}) {
    this.embedder = options.embedder ?? new DeterministicHashEmbedder();
    for (const chunk of chunks) this.add(chunk);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Embedder identity, recorded in eval provenance for reproducibility. */
  get embedderId(): string {
    return this.embedder.id;
  }

  add(chunk: RagChunkInput): void {
    assertChunkInput(chunk);
    // Defensive deep copy: post-construction mutation of caller-owned chunks
    // must not leak into retrieval (mirrors InMemoryRagCorpus).
    const stored = structuredClone(chunk);
    this.entries.set(stored.id, { chunk: stored, vector: this.embedder.embed(stored.text) });
  }

  retrieve(query: string, options: RetrieveOptions = {}): RetrieveResult {
    if (typeof query !== 'string') throw new Error('KERN RAG runtime query must be a string.');
    const { topK, minScore } = normalizeEmbeddingRetrieveOptions(options);
    const queryVector = this.embedder.embed(query);
    const chunks = Array.from(this.entries.values())
      .map((entry) => ({ chunk: entry.chunk, score: embeddingCosine(queryVector, entry.vector) }))
      .filter((candidate) => candidate.score > 0 && candidate.score >= minScore)
      .sort((a, b) => b.score - a.score || compareChunkIds(a.chunk.id, b.chunk.id))
      .slice(0, topK)
      .map(({ chunk, score }) => toRetrievedChunk(chunk, score));
    return { query, chunks };
  }
}

export interface StoredVectorChunk {
  readonly chunk: RagChunkInput;
  readonly vector: Float64Array;
  readonly fingerprint: string;
}

export class InMemoryPgVectorRagStore {
  private readonly entries = new Map<string, StoredVectorChunk>();

  constructor(
    readonly fingerprint: string,
    readonly dims: number,
  ) {
    if (!fingerprint.trim()) throw new Error('KERN pgvector store requires an embedding fingerprint.');
    if (!Number.isInteger(dims) || dims <= 0) throw new Error('KERN pgvector store dims must be a positive integer.');
  }

  upsert(chunk: RagChunkInput, vector: Float64Array, fingerprint = this.fingerprint): void {
    assertChunkInput(chunk);
    this.assertCompatible(vector, fingerprint);
    this.entries.set(chunk.id, {
      chunk: structuredClone(chunk),
      vector: new Float64Array(vector),
      fingerprint,
    });
  }

  search(
    query: string,
    queryVector: Float64Array,
    options: RetrieveOptions = {},
    fingerprint = this.fingerprint,
  ): RetrieveResult {
    this.assertCompatible(queryVector, fingerprint);
    const { topK, minScore } = normalizeEmbeddingRetrieveOptions(options);
    const chunks = Array.from(this.entries.values())
      .map((entry) => ({ chunk: entry.chunk, score: embeddingCosine(queryVector, entry.vector) }))
      .filter((candidate) => candidate.score > 0 && candidate.score >= minScore)
      .sort((a, b) => b.score - a.score || compareChunkIds(a.chunk.id, b.chunk.id))
      .slice(0, topK)
      .map(({ chunk, score }) => toRetrievedChunk(chunk, score));
    return { query, chunks };
  }

  private assertCompatible(vector: Float64Array, fingerprint: string): void {
    if (fingerprint !== this.fingerprint) {
      throw new Error('KERN pgvector store embedding fingerprint mismatch.');
    }
    if (vector.length !== this.dims) {
      throw new Error(`KERN pgvector store expected ${this.dims} dimensions, got ${vector.length}.`);
    }
  }
}

export class AsyncEmbeddingRagIndex {
  private readonly queryVectorByText = new Map<string, Promise<Float64Array>>();

  private constructor(
    private readonly embedder: AsyncEmbedder,
    private readonly store: InMemoryPgVectorRagStore,
    private readonly fingerprint: string,
  ) {}

  static async create(
    chunks: Iterable<RagChunkInput> = [],
    options: { readonly embedder: AsyncEmbedder; readonly metric?: 'cosine' },
  ): Promise<AsyncEmbeddingRagIndex> {
    const fingerprint = embedderFingerprint(options.embedder, options.metric ?? 'cosine');
    const store = new InMemoryPgVectorRagStore(fingerprint, options.embedder.dims);
    const index = new AsyncEmbeddingRagIndex(options.embedder, store, fingerprint);
    const chunkArray = Array.from(chunks);
    for (let offset = 0; offset < chunkArray.length; offset += ASYNC_EMBED_BATCH_SIZE) {
      const batch = chunkArray.slice(offset, offset + ASYNC_EMBED_BATCH_SIZE);
      const vectors = await embedMany(
        options.embedder,
        batch.map((chunk) => chunk.text),
      );
      if (vectors.length !== batch.length) {
        throw new Error(`KERN async embedder returned ${vectors.length} vectors for ${batch.length} inputs.`);
      }
      for (let i = 0; i < batch.length; i += 1) index.store.upsert(batch[i], vectors[i], index.fingerprint);
    }
    return index;
  }

  get embedderId(): string {
    return this.embedder.id;
  }

  get embeddingFingerprint(): string {
    return this.fingerprint;
  }

  async add(chunk: RagChunkInput): Promise<void> {
    this.store.upsert(chunk, await this.embedder.embed(chunk.text), this.fingerprint);
  }

  async retrieve(query: string, options: RetrieveOptions = {}): Promise<RetrieveResult> {
    if (typeof query !== 'string') throw new Error('KERN RAG runtime query must be a string.');
    let queryVectorPromise = this.queryVectorByText.get(query);
    if (queryVectorPromise === undefined) {
      queryVectorPromise = this.embedder.embed(query).catch((error: unknown) => {
        this.queryVectorByText.delete(query);
        throw error;
      });
      this.queryVectorByText.set(query, queryVectorPromise);
      if (this.queryVectorByText.size > ASYNC_QUERY_CACHE_MAX_ENTRIES) {
        const oldest = this.queryVectorByText.keys().next().value;
        if (oldest !== undefined) this.queryVectorByText.delete(oldest);
      }
    }
    const queryVector = await queryVectorPromise;
    return this.store.search(query, queryVector, options, this.fingerprint);
  }
}

/** Deterministic, locale-independent id tie-break (code-point order). */
function compareChunkIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Adapt an {@link EmbeddingRagIndex} to the `RagContractRetriever` seam consumed by eval. */
export function createEmbeddingRetriever(index: EmbeddingRagIndex): RagContractRetriever {
  return (query: string, options: RetrieveOptions = {}): RetrieveResult => index.retrieve(query, options);
}

export function createAsyncEmbeddingRetriever(index: AsyncEmbeddingRagIndex): AsyncRagContractRetriever {
  return (query: string, options: RetrieveOptions = {}): Promise<RetrieveResult> => index.retrieve(query, options);
}

async function embedMany(embedder: AsyncEmbedder, texts: readonly string[]): Promise<readonly Float64Array[]> {
  return embedder.embedMany ? embedder.embedMany(texts) : Promise.all(texts.map((text) => embedder.embed(text)));
}

export function embedderFingerprint(embedder: Pick<AsyncEmbedder | Embedder, 'id' | 'dims'>, metric: 'cosine'): string {
  const provider = embedder.id.includes(':') ? embedder.id.slice(0, embedder.id.indexOf(':')) : 'local';
  return embeddingFingerprint({ provider, model: embedder.id, dims: embedder.dims, metric });
}

export function embeddingFingerprint(input: EmbeddingFingerprintInput): string {
  return `fnv1a32:${fnv1a32(`${input.provider}\0${input.model}\0${input.dims}\0${input.metric}`)
    .toString(16)
    .padStart(8, '0')}`;
}

function toRetrievedChunk(chunk: RagChunkInput, score: number): RetrievedChunk {
  return {
    id: chunk.id,
    text: chunk.text,
    score,
    source: chunk.source,
    citation: chunk.citation ? { ...chunk.citation } : { uri: chunk.source },
    ...(chunk.metadata ? { metadata: structuredClone(chunk.metadata) } : {}),
  };
}

function assertChunkInput(chunk: RagChunkInput): void {
  if (typeof chunk.id !== 'string' || !chunk.id.trim()) {
    throw new Error('KERN RAG runtime chunk id must be a non-empty string.');
  }
  if (typeof chunk.text !== 'string' || !chunk.text.trim()) {
    throw new Error(`KERN RAG runtime chunk '${chunk.id}' text must be a non-empty string.`);
  }
  if (typeof chunk.source !== 'string' || !chunk.source.trim()) {
    throw new Error(`KERN RAG runtime chunk '${chunk.id}' source must be a non-empty string.`);
  }
}

function normalizeEmbeddingRetrieveOptions(options: RetrieveOptions): Required<RetrieveOptions> {
  const topK = options.topK ?? 5;
  const minScore = options.minScore ?? 0;
  if (!Number.isInteger(topK) || topK <= 0 || topK > MAX_IN_MEMORY_RAG_TOP_K) {
    throw new Error(`KERN RAG runtime topK must be a positive integer up to ${MAX_IN_MEMORY_RAG_TOP_K}.`);
  }
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
    throw new Error('KERN RAG runtime minScore must be between 0 and 1.');
  }
  return { topK, minScore };
}
