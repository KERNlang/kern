import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  MAX_IN_MEMORY_RAG_TOP_K,
  RAG_VECTOR_STORE_CONFORMANCE_PROFILE,
  RAG_VECTOR_STORE_SNAPSHOT_VERSION,
  defineRagVectorStoreAdapterContract,
  embeddingCosine,
  runRagVectorStoreConformance,
} from '../../packages/core/dist/index.js';

class ExampleExternalMemoryVectorStore {
  kind = 'memory';
  metric = 'cosine';
  #entries = new Map();

  constructor(context) {
    if (!context || typeof context.fingerprint !== 'string' || !context.fingerprint.trim()) {
      throw new Error('example adapter context.fingerprint must be a non-empty string.');
    }
    if (!Number.isInteger(context.dims) || context.dims <= 0) {
      throw new Error('example adapter context.dims must be a positive integer.');
    }
    if (typeof context.namespace !== 'string' || !context.namespace.trim()) {
      throw new Error('example adapter context.namespace must be a non-empty string.');
    }
    this.fingerprint = context.fingerprint;
    this.dims = context.dims;
    this.namespace = context.namespace;
  }

  upsert(chunk, vector, fingerprint = this.fingerprint) {
    assertChunkInput(chunk);
    this.#assertCompatible(vector, fingerprint);
    this.#entries.set(chunk.id, {
      chunk: structuredClone(chunk),
      vector: new Float64Array(vector),
      fingerprint,
    });
  }

  upsertMany(entries) {
    if (!entries || typeof entries[Symbol.iterator] !== 'function') {
      throw new Error('example adapter upsertMany entries must be iterable.');
    }
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        throw new Error('example adapter upsertMany entry must be an object.');
      }
      if (entry.fingerprint === undefined) {
        this.upsert(entry.chunk, entry.vector);
      } else {
        this.upsert(entry.chunk, entry.vector, entry.fingerprint);
      }
    }
  }

  search(query, queryVector, options = {}, fingerprint = this.fingerprint) {
    if (typeof query !== 'string') throw new Error('KERN RAG runtime query must be a string.');
    this.#assertCompatible(queryVector, fingerprint);
    const { topK, minScore } = normalizeRetrieveOptions(options);
    const chunks = [...this.#entries.values()]
      .map((entry) => ({ chunk: entry.chunk, score: embeddingCosine(queryVector, entry.vector) }))
      .filter((candidate) => candidate.score > 0 && candidate.score >= minScore)
      .sort((left, right) => right.score - left.score || compareIds(left.chunk.id, right.chunk.id))
      .slice(0, topK)
      .map(({ chunk, score }) => ({
        id: chunk.id,
        text: chunk.text,
        source: chunk.source,
        citation: chunk.citation ? structuredClone(chunk.citation) : { uri: chunk.source },
        score,
        ...(chunk.metadata ? { metadata: structuredClone(chunk.metadata) } : {}),
      }));
    return { query, chunks };
  }

  snapshot() {
    return {
      version: RAG_VECTOR_STORE_SNAPSHOT_VERSION,
      fingerprint: this.fingerprint,
      dims: this.dims,
      metric: this.metric,
      entries: [...this.#entries.values()]
        .sort((left, right) => compareIds(left.chunk.id, right.chunk.id))
        .map((entry) => ({
          chunk: structuredClone(entry.chunk),
          vector: [...entry.vector],
          fingerprint: entry.fingerprint,
        })),
    };
  }

  clear() {
    this.#entries.clear();
  }

  close() {
    // External network-backed adapters should release sockets or clients here.
  }

  #assertCompatible(vector, fingerprint) {
    if (fingerprint !== this.fingerprint) {
      throw new Error('example adapter embedding fingerprint mismatch.');
    }
    if (!(vector instanceof Float64Array)) {
      throw new Error('example adapter vector must be a Float64Array.');
    }
    if (vector.length !== this.dims) {
      throw new Error(`example adapter expected ${this.dims} dimensions, got ${vector.length}.`);
    }
  }
}

export const exampleRagVectorStoreContract = defineRagVectorStoreAdapterContract({
  manifest: {
    name: 'example-in-process-memory',
    kind: 'vectorStore',
    adapterKind: 'memory',
    version: '1.0.0',
    transport: 'in-process',
    metrics: ['cosine'],
    maxDimensions: 4096,
    persistence: 'ephemeral',
    capabilities: {
      upsert: true,
      upsertMany: true,
      search: true,
      snapshot: true,
      clear: true,
      namespaces: false,
      filters: [],
      maxDimensions: 4096,
    },
  },
  createStore: (context) => new ExampleExternalMemoryVectorStore(context),
});

export function runExampleConformance() {
  return runRagVectorStoreConformance({
    ...exampleRagVectorStoreContract,
    runId: 'example-in-process-memory',
  });
}

function assertChunkInput(chunk) {
  if (!chunk || typeof chunk.id !== 'string' || !chunk.id.trim()) {
    throw new Error('example adapter chunk id must be a non-empty string.');
  }
  if (typeof chunk.text !== 'string' || !chunk.text.trim()) {
    throw new Error(`example adapter chunk '${chunk.id}' text must be a non-empty string.`);
  }
  if (typeof chunk.source !== 'string' || !chunk.source.trim()) {
    throw new Error(`example adapter chunk '${chunk.id}' source must be a non-empty string.`);
  }
}

function normalizeRetrieveOptions(options) {
  if (options == null || typeof options !== 'object') {
    throw new Error('KERN RAG runtime retrieve options must be an object when provided.');
  }
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

function compareIds(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = runExampleConformance();
    console.log(
      JSON.stringify(
        {
          profile: RAG_VECTOR_STORE_CONFORMANCE_PROFILE.version,
          adapter: report.manifest.name,
          passed: report.passed,
          summary: report.summary,
        },
        null,
        2,
      ),
    );
    process.exit(report.passed ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
