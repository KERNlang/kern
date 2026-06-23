import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

import {
  InMemoryPgVectorRagStore,
  RAG_VECTOR_STORE_SNAPSHOT_VERSION,
  type RagVectorStoreKind,
  type RagVectorStoreSnapshot,
  type RagVectorStoreUpsert,
  type SerializedVectorChunk,
} from './rag-embedding.js';
import type { RagChunkInput, RetrieveOptions, RetrieveResult } from './rag-runtime.js';

const LOCAL_PERSISTENT_VECTOR_STORE_FILE = 'vectors.json';
const MAX_LOCAL_PERSISTENT_VECTOR_STORE_BYTES = 100 * 1024 * 1024;
const OPEN_LOCAL_PERSISTENT_VECTOR_STORE_FILES = new Set<string>();
const LOCAL_VECTOR_STORE_LOCK_VERSION = 'kern-rag-vector-store-lock-v1';

export interface LocalPersistentRagVectorStoreOptions {
  readonly directory: string;
  readonly fingerprint: string;
  readonly dims: number;
  readonly fileName?: string;
}

/**
 * Directory-backed vector store for local runner-native RAG.
 *
 * This adapter is intentionally single-writer within the current process and
 * fails closed on incompatible snapshots. Use `upsertMany` for bulk indexing so
 * persistence flushes once per batch; `upsert` flushes to local disk per call.
 */
export class LocalPersistentRagVectorStoreAdapter extends InMemoryPgVectorRagStore {
  override readonly kind: RagVectorStoreKind = 'local-persistent';
  private readonly filePath: string;
  private readonly lockPath: string;
  private lockFd: number | undefined;
  private closed = false;

  constructor(options: LocalPersistentRagVectorStoreOptions) {
    if (!options.directory.trim()) throw new Error('KERN local vector store requires a directory path.');
    super(options.fingerprint, options.dims);
    this.filePath = resolve(localVectorStoreFilePath(options.directory, options.fileName));
    this.lockPath = `${this.filePath}.lock`;
    mkdirSync(options.directory, { recursive: true });
    this.lockFd = acquireLocalVectorStoreLock(this.lockPath, this.filePath);
    if (OPEN_LOCAL_PERSISTENT_VECTOR_STORE_FILES.has(this.filePath)) {
      releaseLocalVectorStoreLock(this.lockPath, this.lockFd);
      this.lockFd = undefined;
      throw new Error(`KERN local vector store '${this.filePath}' is already open for writing in this process.`);
    }
    OPEN_LOCAL_PERSISTENT_VECTOR_STORE_FILES.add(this.filePath);
    try {
      this.loadFromDisk();
    } catch (error) {
      OPEN_LOCAL_PERSISTENT_VECTOR_STORE_FILES.delete(this.filePath);
      releaseLocalVectorStoreLock(this.lockPath, this.lockFd);
      this.lockFd = undefined;
      throw error;
    }
  }

  override upsert(chunk: RagChunkInput, vector: Float64Array, fingerprint = this.fingerprint): void {
    this.assertOpen();
    const before = this.snapshot();
    super.upsert(chunk, vector, fingerprint);
    try {
      this.flushToDisk();
    } catch (error) {
      this.restoreSnapshot(before);
      throw error;
    }
  }

  override upsertMany(entries: Iterable<RagVectorStoreUpsert>): void {
    this.assertOpen();
    const before = this.snapshot();
    try {
      for (const entry of entries) super.upsert(entry.chunk, entry.vector, entry.fingerprint);
      this.flushToDisk();
    } catch (error) {
      this.restoreSnapshot(before);
      throw error;
    }
  }

  override clear(): void {
    this.assertOpen();
    const before = this.snapshot();
    super.clear();
    try {
      this.flushToDisk();
    } catch (error) {
      this.restoreSnapshot(before);
      throw error;
    }
  }

  override search(
    query: string,
    queryVector: Float64Array,
    options: RetrieveOptions = {},
    fingerprint = this.fingerprint,
  ): RetrieveResult {
    this.assertOpen();
    return super.search(query, queryVector, options, fingerprint);
  }

  override snapshot(): RagVectorStoreSnapshot {
    this.assertOpen();
    return super.snapshot();
  }

  override close(): void {
    if (this.closed) return;
    OPEN_LOCAL_PERSISTENT_VECTOR_STORE_FILES.delete(this.filePath);
    releaseLocalVectorStoreLock(this.lockPath, this.lockFd);
    this.lockFd = undefined;
    this.closed = true;
  }

  private loadFromDisk(): void {
    const tmpPath = `${this.filePath}.tmp`;
    if (!existsSync(this.filePath)) {
      if (!existsSync(tmpPath)) return;
      const snapshot = this.readSnapshotFile(tmpPath);
      renameSync(tmpPath, this.filePath);
      this.restoreSnapshot(snapshot);
      return;
    }

    try {
      const snapshot = this.readSnapshotFile(this.filePath);
      this.restoreSnapshot(snapshot);
    } catch (canonicalError) {
      if (existsSync(tmpPath)) {
        try {
          const snapshot = this.readSnapshotFile(tmpPath);
          renameSync(tmpPath, this.filePath);
          this.restoreSnapshot(snapshot);
          return;
        } catch {
          // Preserve the canonical snapshot error; the temp snapshot was not recoverable either.
        }
      }
      throw canonicalError;
    }

    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // Stale temp-file cleanup is best effort; loading the canonical snapshot still decides correctness.
    }
  }

  private readSnapshotFile(filePath: string): RagVectorStoreSnapshot {
    const { size } = statSync(filePath);
    if (size > MAX_LOCAL_PERSISTENT_VECTOR_STORE_BYTES) {
      throw new Error(`KERN local vector store snapshot exceeds ${MAX_LOCAL_PERSISTENT_VECTOR_STORE_BYTES} bytes.`);
    }
    const raw = readFileSync(filePath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`KERN local vector store snapshot is not valid JSON: ${(error as Error).message}`);
    }
    return parseVectorStoreSnapshot(parsed, this.fingerprint, this.dims);
  }

  private flushToDisk(): void {
    const tmpPath = `${this.filePath}.tmp`;
    try {
      const payload = `${JSON.stringify(this.snapshot(), null, 2)}\n`;
      if (new TextEncoder().encode(payload).byteLength > MAX_LOCAL_PERSISTENT_VECTOR_STORE_BYTES) {
        throw new Error(`KERN local vector store snapshot exceeds ${MAX_LOCAL_PERSISTENT_VECTOR_STORE_BYTES} bytes.`);
      }
      writeFileSync(tmpPath, payload, 'utf-8');
      renameSync(tmpPath, this.filePath);
    } catch (error) {
      try {
        if (existsSync(tmpPath)) unlinkSync(tmpPath);
      } catch {
        // Preserve the original filesystem error; stale tmp cleanup is best effort.
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private restoreSnapshot(snapshot: RagVectorStoreSnapshot): void {
    super.clear();
    for (const entry of snapshot.entries) {
      super.upsert(entry.chunk, new Float64Array(entry.vector), entry.fingerprint);
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('KERN local vector store is closed.');
  }
}

function localVectorStoreFilePath(directory: string, fileName = LOCAL_PERSISTENT_VECTOR_STORE_FILE): string {
  if (
    !fileName.trim() ||
    isAbsolute(fileName) ||
    basename(fileName) !== fileName ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName === '.' ||
    fileName === '..'
  ) {
    throw new Error('KERN local vector store fileName must be a plain file name.');
  }
  return join(directory, fileName);
}

function acquireLocalVectorStoreLock(lockPath: string, filePath: string): number {
  const acquire = (): number => {
    const fd = openSync(lockPath, 'wx');
    writeFileSync(
      fd,
      `${JSON.stringify({ version: LOCAL_VECTOR_STORE_LOCK_VERSION, pid: process.pid, filePath })}\n`,
      'utf-8',
    );
    return fd;
  };
  try {
    return acquire();
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      if (isStaleLocalVectorStoreLock(lockPath)) {
        try {
          unlinkSync(lockPath);
          return acquire();
        } catch {
          // Preserve the fail-closed behavior below if stale-lock cleanup races another writer.
        }
      }
      throw new Error(`KERN local vector store '${filePath}' is already open for writing.`);
    }
    throw error;
  }
}

function releaseLocalVectorStoreLock(lockPath: string, lockFd: number | undefined): void {
  if (lockFd !== undefined) {
    try {
      closeSync(lockFd);
    } catch {
      // Lock cleanup is best effort; unlink still gives a subsequent open a chance to proceed.
    }
  }
  try {
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch {
    // Lock cleanup is best effort; stale locks with dead PID metadata can be recovered on the next open.
  }
}

function isStaleLocalVectorStoreLock(lockPath: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(lockPath, 'utf-8'));
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object') return false;
  const lock = parsed as { version?: unknown; pid?: unknown };
  const pid = lock.pid;
  if (
    lock.version !== LOCAL_VECTOR_STORE_LOCK_VERSION ||
    typeof pid !== 'number' ||
    !Number.isInteger(pid) ||
    pid <= 0
  ) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return isNodeError(error) && error.code === 'ESRCH';
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function parseVectorStoreSnapshot(raw: unknown, fingerprint: string, dims: number): RagVectorStoreSnapshot {
  if (!raw || typeof raw !== 'object') throw new Error('KERN local vector store snapshot must be an object.');
  const snapshot = raw as Partial<RagVectorStoreSnapshot>;
  if (snapshot.version !== RAG_VECTOR_STORE_SNAPSHOT_VERSION) {
    throw new Error(`KERN local vector store snapshot version must be ${RAG_VECTOR_STORE_SNAPSHOT_VERSION}.`);
  }
  if (snapshot.fingerprint !== fingerprint) {
    throw new Error('KERN local vector store embedding fingerprint mismatch.');
  }
  if (snapshot.dims !== dims) {
    throw new Error(`KERN local vector store expected ${dims} dimensions, got ${String(snapshot.dims)}.`);
  }
  if (snapshot.metric !== 'cosine') throw new Error('KERN local vector store metric must be cosine.');
  if (!Array.isArray(snapshot.entries)) throw new Error('KERN local vector store entries must be an array.');
  const entries = snapshot.entries.map((rawEntry) => {
    if (!rawEntry || typeof rawEntry !== 'object') {
      throw new Error('KERN local vector store entry must be an object.');
    }
    const entry = rawEntry as Partial<SerializedVectorChunk>;
    if (!entry.chunk || typeof entry.chunk !== 'object') {
      throw new Error('KERN local vector store entry chunk must be an object.');
    }
    if (typeof entry.fingerprint !== 'string') {
      throw new Error('KERN local vector store entry fingerprint must be a string.');
    }
    assertChunkInput(entry.chunk);
    if (!Array.isArray(entry.vector) || entry.vector.length !== dims) {
      throw new Error(`KERN local vector store entry '${entry.chunk.id}' must have ${dims} vector dimensions.`);
    }
    const vector = entry.vector as readonly unknown[];
    if (vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`KERN local vector store entry '${entry.chunk.id}' has a malformed vector.`);
    }
    if (entry.fingerprint !== fingerprint) {
      throw new Error(`KERN local vector store entry '${entry.chunk.id}' has an embedding fingerprint mismatch.`);
    }
    return {
      chunk: structuredClone(entry.chunk),
      vector: vector as readonly number[],
      fingerprint: entry.fingerprint,
    };
  });
  return {
    version: RAG_VECTOR_STORE_SNAPSHOT_VERSION,
    fingerprint,
    dims,
    metric: 'cosine',
    entries,
  };
}

function assertChunkInput(chunk: unknown): asserts chunk is RagChunkInput {
  if (!chunk || typeof chunk !== 'object') {
    throw new Error('KERN RAG runtime chunk must be an object.');
  }
  const candidate = chunk as Partial<RagChunkInput>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
    throw new Error('KERN RAG runtime chunk id must be a non-empty string.');
  }
  if (typeof candidate.text !== 'string' || !candidate.text.trim()) {
    throw new Error(`KERN RAG runtime chunk '${candidate.id}' text must be a non-empty string.`);
  }
  if (typeof candidate.source !== 'string' || !candidate.source.trim()) {
    throw new Error(`KERN RAG runtime chunk '${candidate.id}' source must be a non-empty string.`);
  }
}
