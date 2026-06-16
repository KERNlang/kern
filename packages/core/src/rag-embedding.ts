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

export const DEFAULT_EMBEDDING_DIMS = 256;
export const DEFAULT_HASH_EMBEDDER_ID = 'local-hash-v1';
/** Scores are rounded to this many decimals (integerised fixed-point) for stable equality. */
export const EMBEDDING_SCORE_DECIMALS = 6;

const SCORE_SCALE = 1_000_000;
const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

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

/** Deterministic, locale-independent id tie-break (code-point order). */
function compareChunkIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Adapt an {@link EmbeddingRagIndex} to the `RagContractRetriever` seam consumed by eval. */
export function createEmbeddingRetriever(index: EmbeddingRagIndex): RagContractRetriever {
  return (query: string, options: RetrieveOptions = {}): RetrieveResult => index.retrieve(query, options);
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
