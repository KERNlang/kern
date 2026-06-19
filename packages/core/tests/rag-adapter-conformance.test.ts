import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  builtinRagVectorStoreManifest,
  createInMemoryRagVectorStoreForConformance,
  type RagVectorStoreConformanceContext,
  runRagVectorStoreConformance,
} from '../src/index.js';
import { LocalPersistentRagVectorStoreAdapter } from '../src/rag-embedding-node.js';

describe('RAG vector store adapter conformance', () => {
  test('built-in memory adapter passes deterministic conformance with durable case skipped', () => {
    const manifest = builtinRagVectorStoreManifest('memory');
    expect(manifest).toBeDefined();

    const report = runRagVectorStoreConformance({
      manifest: manifest!,
      createStore: createInMemoryRagVectorStoreForConformance,
    });

    expect(report.passed).toBe(true);
    expect(report.summary.failed).toBe(0);
    expect(report.cases.some((entry) => entry.name === 'durable-round-trip' && entry.status === 'skipped')).toBe(true);
  });

  test('built-in local persistent adapter passes durable conformance', () => {
    const manifest = builtinRagVectorStoreManifest('local-persistent');
    expect(manifest).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-conformance-'));
    try {
      const report = runRagVectorStoreConformance({
        manifest: manifest!,
        createStore: (context) =>
          new LocalPersistentRagVectorStoreAdapter({
            directory: dir,
            fileName: `${context.namespace}.json`,
            fingerprint: context.fingerprint,
            dims: context.dims,
          }),
      });

      expect(report.passed).toBe(true);
      expect(report.cases.some((entry) => entry.name === 'durable-round-trip' && entry.status === 'passed')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('repeated local persistent conformance runs isolate backing files by default', () => {
    const manifest = builtinRagVectorStoreManifest('local-persistent');
    expect(manifest).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-conformance-'));
    try {
      const createStore = (context: RagVectorStoreConformanceContext) =>
        new LocalPersistentRagVectorStoreAdapter({
          directory: dir,
          fileName: `${context.namespace}.json`,
          fingerprint: context.fingerprint,
          dims: context.dims,
        });

      const first = runRagVectorStoreConformance({ manifest: manifest!, createStore });
      const second = runRagVectorStoreConformance({ manifest: manifest!, createStore });

      expect(first.passed).toBe(true);
      expect(second.passed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('manifest shape failures are reported instead of thrown', () => {
    const manifest = {
      ...builtinRagVectorStoreManifest('memory')!,
      metrics: [],
    };

    const report = runRagVectorStoreConformance({
      manifest,
      createStore: createInMemoryRagVectorStoreForConformance,
    });

    expect(report.passed).toBe(false);
    expect(report.cases.some((entry) => entry.name === 'manifest-shape' && entry.status === 'failed')).toBe(true);
  });

  test('manifest adapter mismatches are reported instead of thrown', () => {
    const manifest = {
      ...builtinRagVectorStoreManifest('memory')!,
      adapterKind: 'local-persistent' as const,
    };

    const report = runRagVectorStoreConformance({
      manifest,
      createStore: createInMemoryRagVectorStoreForConformance,
    });

    expect(report.passed).toBe(false);
    expect(report.cases.some((entry) => entry.name === 'manifest-matches-adapter' && entry.status === 'failed')).toBe(
      true,
    );
  });

  test('manifest persistence mismatches are reported instead of thrown', () => {
    const manifest = {
      ...builtinRagVectorStoreManifest('memory')!,
      persistence: 'durable' as const,
    };

    const report = runRagVectorStoreConformance({
      manifest,
      createStore: createInMemoryRagVectorStoreForConformance,
    });

    expect(report.passed).toBe(false);
    expect(
      report.cases.some((entry) => entry.name === 'persistence-matches-adapter' && entry.status === 'failed'),
    ).toBe(true);
  });
});
