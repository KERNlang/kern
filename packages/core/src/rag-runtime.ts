export interface RagCitation {
  readonly uri?: string;
  readonly locator?: string;
}

export interface RagChunkInput {
  readonly id: string;
  readonly text: string;
  readonly source: string;
  readonly citation?: RagCitation;
  readonly metadata?: Record<string, unknown>;
}

export interface RetrievedChunk {
  readonly id: string;
  readonly text: string;
  readonly score: number;
  readonly source: string;
  readonly citation: RagCitation;
  readonly metadata?: Record<string, unknown>;
}

export interface RetrieveOptions {
  readonly topK?: number;
  readonly minScore?: number;
}

export interface RetrieveResult {
  readonly query: string;
  readonly chunks: RetrievedChunk[];
}

export type InMemoryRagRetriever = (query: string, options?: RetrieveOptions) => RetrieveResult;

export const MAX_IN_MEMORY_RAG_TOP_K = 1000;

interface StoredRagChunk {
  readonly chunk: RagChunkInput;
  readonly terms: ReadonlySet<string>;
}

export class InMemoryRagCorpus {
  private readonly chunks = new Map<string, StoredRagChunk>();

  constructor(chunks: Iterable<RagChunkInput> = []) {
    for (const chunk of chunks) this.add(chunk);
  }

  get size(): number {
    return this.chunks.size;
  }

  add(chunk: RagChunkInput): void {
    if (typeof chunk.id !== 'string' || !chunk.id.trim()) {
      throw new Error('KERN RAG runtime chunk id must be a non-empty string.');
    }
    if (typeof chunk.text !== 'string' || !chunk.text.trim()) {
      throw new Error(`KERN RAG runtime chunk '${chunk.id}' text must be a non-empty string.`);
    }
    if (typeof chunk.source !== 'string' || !chunk.source.trim()) {
      throw new Error(`KERN RAG runtime chunk '${chunk.id}' source must be a non-empty string.`);
    }
    const storedChunk = {
      ...chunk,
      citation: chunk.citation ? { ...chunk.citation } : undefined,
      metadata: chunk.metadata ? cloneMetadata(chunk.metadata) : undefined,
    };
    this.chunks.set(chunk.id, { chunk: storedChunk, terms: tokenizeForRetrieval(storedChunk.text) });
  }

  get(id: string): RagChunkInput | undefined {
    const stored = this.chunks.get(id);
    return stored ? cloneChunkInput(stored.chunk) : undefined;
  }

  all(): RagChunkInput[] {
    return Array.from(this.chunks.values(), (stored) => cloneChunkInput(stored.chunk));
  }

  retrieve(query: string, options: RetrieveOptions = {}): RetrieveResult {
    if (typeof query !== 'string') throw new Error('KERN RAG runtime query must be a string.');
    const { topK, minScore } = normalizeRetrieveOptions(options);
    const queryTerms = tokenizeForRetrieval(query);
    if (queryTerms.size === 0) return { query, chunks: [] };

    const chunks = Array.from(this.chunks.values())
      .map((stored) => ({ chunk: stored.chunk, score: jaccardScore(queryTerms, stored.terms) }))
      .filter((candidate) => candidate.score > 0 && candidate.score >= minScore)
      .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
      .slice(0, topK)
      .map(({ chunk, score }) => retrievedChunk(chunk, score));

    return { query, chunks };
  }
}

export function createInMemoryRetriever(corpus: InMemoryRagCorpus): InMemoryRagRetriever {
  return (query: string, options: RetrieveOptions = {}): RetrieveResult => corpus.retrieve(query, options);
}

export function retrieveFromInMemoryCorpus(
  corpus: InMemoryRagCorpus,
  query: string,
  options: RetrieveOptions = {},
): RetrieveResult {
  return corpus.retrieve(query, options);
}

function normalizeRetrieveOptions(options: RetrieveOptions): Required<RetrieveOptions> {
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

export function tokenizeForRetrieval(value: string): ReadonlySet<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function jaccardScore(queryTerms: ReadonlySet<string>, chunkTerms: ReadonlySet<string>): number {
  if (queryTerms.size === 0 || chunkTerms.size === 0) return 0;
  let intersection = 0;
  for (const term of queryTerms) {
    if (chunkTerms.has(term)) intersection += 1;
  }
  const union = queryTerms.size + chunkTerms.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function retrievedChunk(chunk: RagChunkInput, score: number): RetrievedChunk {
  return {
    id: chunk.id,
    text: chunk.text,
    score,
    source: chunk.source,
    citation: chunk.citation ? { ...chunk.citation } : { uri: chunk.source },
    ...(chunk.metadata ? { metadata: cloneMetadata(chunk.metadata) } : {}),
  };
}

function cloneChunkInput(chunk: RagChunkInput): RagChunkInput {
  return {
    ...chunk,
    citation: chunk.citation ? { ...chunk.citation } : undefined,
    metadata: chunk.metadata ? cloneMetadata(chunk.metadata) : undefined,
  };
}

function cloneMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return cloneMetadataValue(metadata, new WeakMap<object, unknown>()) as Record<string, unknown>;
}

function cloneMetadataValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing) return existing;
    const out: unknown[] = [];
    seen.set(value, out);
    for (const item of value) out.push(cloneMetadataValue(item, seen));
    return out;
  }
  if (isPlainMetadataObject(value)) {
    const existing = seen.get(value);
    if (existing) return existing;
    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      out[key] = cloneMetadataValue(entry, seen);
    }
    return out;
  }
  return value;
}

function isPlainMetadataObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
