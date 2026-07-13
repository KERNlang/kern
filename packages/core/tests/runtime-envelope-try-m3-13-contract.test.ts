import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeEnv } from '../src/ir/semantics/index.js';
import { INTERNAL_EFFECT_MACHINE_FORMAT } from '../src/ir/semantics/internal-effect-machine.js';
import { registerAllContracts } from '../src/ir/semantics/register-all.js';
import { executeInternalRuntimeEnvelopeSync } from '../src/runtime-envelope/execute.js';
import { selectInternalRuntimeEngine } from '../src/runtime-envelope/internal-engine.js';
import type { InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import type { IRNode } from '../src/types.js';

type CurrentDisposition = 'legacy' | 'machine-preflight-reject';

interface TryContractCase {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  readonly currentDisposition: CurrentDisposition;
  readonly nodes: readonly IRNode[];
  readonly m3_13Acceptance: string;
}

interface TryContractManifest {
  readonly format: string;
  readonly currentEvidence: 'routing-only';
  readonly cases: readonly TryContractCase[];
}

const manifestPath = fileURLToPath(new URL('./fixtures/runtime-envelope-try-m3-13-contract.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as TryContractManifest;
const requiredCategories = new Set([
  'abrupt-finally',
  'capability-parity',
  'catch-binding',
  'finally-preservation',
  'loop-in-try',
  'preflight',
  'try-in-loop',
]);
const forbiddenControlKeys = new Set(['disabled', 'only', 'skip', 'todo']);
const currentDispositions = new Set<CurrentDisposition>(['legacy', 'machine-preflight-reject']);
const limits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxStringBytes: 4_096,
};

function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return out;
  }
  if (typeof value !== 'object' || value === null) return out;
  for (const [key, child] of Object.entries(value)) {
    out.add(key);
    collectKeys(child, out);
  }
  return out;
}

describe('M3.13 portable try contract manifest', () => {
  beforeAll(() => registerAllContracts());

  test('is complete, unique, and contains no disabled test controls', () => {
    expect(manifest.format).toBe('kern.runtime.try-m3-13-contract.internal.r0');
    expect(manifest.currentEvidence).toBe('routing-only');
    expect(manifest.cases.length).toBeGreaterThan(0);

    const ids = manifest.cases.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(manifest.cases.map((entry) => entry.category))).toEqual(requiredCategories);
    expect(manifest.cases.some((entry) => entry.currentDisposition === 'machine-preflight-reject')).toBe(true);
    for (const entry of manifest.cases) {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.nodes.length).toBeGreaterThan(0);
      expect(entry.m3_13Acceptance.length).toBeGreaterThan(0);
      expect(currentDispositions.has(entry.currentDisposition)).toBe(true);
    }

    const keys = collectKeys(manifest);
    expect([...forbiddenControlKeys].filter((key) => keys.has(key))).toEqual([]);
  });

  test('records current routing only for every future acceptance case', () => {
    for (const entry of manifest.cases) {
      const env = makeEnv({ bindings: new Map([['items', [1]]]) });
      const selected = selectInternalRuntimeEngine(entry.nodes, env);
      expect(selected).toBe(entry.currentDisposition === 'legacy' ? 'legacy' : INTERNAL_EFFECT_MACHINE_FORMAT);
    }
  });

  test('machine-preflight cases reject before provider dispatch or trace events', () => {
    for (const entry of manifest.cases.filter(
      (candidate) => candidate.currentDisposition === 'machine-preflight-reject',
    )) {
      let calls = 0;
      const env = makeEnv({
        bindings: new Map([['items', [1]]]),
        capabilities: { storage: { get: () => (calls += 1) } },
      });
      expect(executeInternalRuntimeEnvelopeSync(entry.nodes, env, { enabled: true, limits })).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
      expect(calls).toBe(0);
    }
  });
});
