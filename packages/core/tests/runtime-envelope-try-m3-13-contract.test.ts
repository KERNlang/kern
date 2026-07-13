import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeEnv, type SemanticEnv } from '../src/ir/semantics/index.js';
import {
  INTERNAL_EFFECT_MACHINE_FORMAT,
  runInternalEffectMachineAsync,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import { registerAllContracts } from '../src/ir/semantics/register-all.js';
import { tracesEqual } from '../src/ir/semantics/trace.js';
import { UNAVAILABLE_CAUGHT_ERROR } from '../src/ir/semantics/try-runtime.js';
import {
  executeInternalRuntimeEnvelopeAsync,
  executeInternalRuntimeEnvelopeSync,
} from '../src/runtime-envelope/execute.js';
import { selectInternalRuntimeEngine } from '../src/runtime-envelope/internal-engine.js';
import type { InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import { M3_13_ACCEPTANCE_CASES, type M313AcceptanceCase } from './runtime-envelope-try-m3-13-cases.js';

interface TryContractManifestEntry {
  readonly id: string;
  readonly category: string;
  readonly description: string;
}

interface TryContractManifest {
  readonly format: string;
  readonly currentEvidence: 'executable-machine-acceptance';
  readonly cases: readonly TryContractManifestEntry[];
}

const manifestPath = fileURLToPath(new URL('./fixtures/runtime-envelope-try-m3-13-contract.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as TryContractManifest;
const requiredCategories = new Set([
  'abrupt-finally',
  'capability-parity',
  'catch-binding',
  'cleanup-analysis',
  'finally-preservation',
  'loop-control',
  'loop-in-try',
  'nested-try',
  'preflight',
  'provider-cleanup',
  'return-with-catch',
  'try-in-loop',
]);
const forbiddenControlKeys = new Set(['disabled', 'only', 'skip', 'todo']);
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

function runtimeEnv(onProviderCall: () => void): SemanticEnv {
  return makeEnv({
    bindings: new Map<string, unknown>([
      ['error', 'outer'],
      ['items', [1]],
    ]),
    capabilities: {
      llm: {
        complete: () => {
          onProviderCall();
          return 'ok';
        },
      },
      storage: {
        get: () => {
          onProviderCall();
          return 'ok';
        },
      },
    },
  });
}

function stdout(trace: ReturnType<typeof runInternalEffectMachineSync>): string[] {
  return trace.events.filter((event) => event.op === 'stdout').map((event) => event.text);
}

async function runSuccess(acceptance: Extract<M313AcceptanceCase, { kind: 'success' }>): Promise<void> {
  let syncCalls = 0;
  const syncEnv = runtimeEnv(() => {
    syncCalls += 1;
  });
  const syncTrace = runInternalEffectMachineSync(acceptance.nodes, syncEnv, { iterationBudget: 64 });

  let asyncCalls = 0;
  const asyncEnv = runtimeEnv(() => {
    asyncCalls += 1;
  });
  const asyncTrace = await runInternalEffectMachineAsync(acceptance.nodes, asyncEnv, {
    asyncCapabilities: {
      llm: {
        complete: async () => {
          asyncCalls += 1;
          return 'ok';
        },
      },
    },
    iterationBudget: 64,
  });

  expect(tracesEqual(syncTrace, asyncTrace)).toBe(true);
  expect(syncTrace.completion.kind).toBe(acceptance.completion);
  expect(stdout(syncTrace)).toEqual(acceptance.stdout);
  expect(syncCalls).toBe(acceptance.providerCalls);
  expect(asyncCalls).toBe(acceptance.providerCalls);
  if (Object.hasOwn(acceptance, 'value')) expect(syncTrace.completion.value).toEqual(acceptance.value);
  if (acceptance.errorKind) expect(syncTrace.completion.error?.kind).toBe(acceptance.errorKind);
  if (acceptance.tombstone) {
    expect(syncEnv.bindings.get('error')).toBe(UNAVAILABLE_CAUGHT_ERROR);
    expect(asyncEnv.bindings.get('error')).toBe(UNAVAILABLE_CAUGHT_ERROR);
  }
}

function runPreflightFailure(acceptance: Extract<M313AcceptanceCase, { kind: 'preflight-failure' }>): void {
  let calls = 0;
  const envelope = executeInternalRuntimeEnvelopeSync(
    acceptance.nodes,
    runtimeEnv(() => {
      calls += 1;
    }),
    {
      enabled: true,
      limits,
    },
  );
  expect(envelope).toMatchObject({
    diagnostics: [{ code: 'unsupported-runtime-input' }],
    events: [],
    outcome: 'failure',
  });
  expect(calls).toBe(0);
}

async function runProviderFailure(
  acceptance: Extract<M313AcceptanceCase, { kind: 'provider-failure-tombstone' }>,
): Promise<void> {
  const env = makeEnv({ bindings: new Map([['error', 'outer']]) });
  if (acceptance.mode === 'sync') {
    env.capabilities = {
      llm: {
        complete: () => {
          throw new Error('provider failed');
        },
      },
    };
    expect(() => runInternalEffectMachineSync(acceptance.nodes, env)).toThrow(/provider failed/);
  } else if (acceptance.mode === 'async') {
    await expect(
      runInternalEffectMachineAsync(acceptance.nodes, env, {
        asyncCapabilities: {
          llm: {
            complete: async () => {
              throw new Error('provider failed');
            },
          },
        },
      }),
    ).rejects.toThrow(/provider failed/);
  } else {
    const controller = new AbortController();
    let entered: (() => void) | undefined;
    let release: ((value: string) => void) | undefined;
    const providerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const providerWait = new Promise<string>((resolve) => {
      release = resolve;
    });
    const running = executeInternalRuntimeEnvelopeAsync(
      acceptance.nodes,
      env,
      { enabled: true, limits, scheduler: { signal: controller.signal } },
      {
        asyncCapabilities: {
          llm: {
            complete: async () => {
              entered?.();
              return providerWait;
            },
          },
        },
      },
    );
    await providerEntered;
    controller.abort();
    expect(await running).toMatchObject({
      diagnostics: [{ code: 'execution-cancelled' }],
      events: [],
      outcome: 'failure',
    });
    release?.('late');
    await Promise.resolve();
  }
  expect(env.bindings.get('error')).toBe(UNAVAILABLE_CAUGHT_ERROR);
}

async function runAcceptance(acceptance: M313AcceptanceCase): Promise<void> {
  expect(
    selectInternalRuntimeEngine(
      acceptance.nodes,
      runtimeEnv(() => {}),
    ),
  ).toBe(INTERNAL_EFFECT_MACHINE_FORMAT);
  if (acceptance.kind === 'success') return runSuccess(acceptance);
  if (acceptance.kind === 'preflight-failure') return runPreflightFailure(acceptance);
  return runProviderFailure(acceptance);
}

describe('M3.13 portable try contract manifest', () => {
  beforeAll(() => registerAllContracts());

  test('is closed, executable, unique, categorized, and skip-free', () => {
    expect(manifest.format).toBe('kern.runtime.try-m3-13-contract.internal.r1');
    expect(manifest.currentEvidence).toBe('executable-machine-acceptance');
    const ids = manifest.cases.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(manifest.cases.map((entry) => entry.category))).toEqual(requiredCategories);
    expect(Object.keys(M3_13_ACCEPTANCE_CASES).sort()).toEqual([...ids].sort());
    for (const entry of manifest.cases) {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
    const keys = collectKeys(manifest);
    expect([...forbiddenControlKeys].filter((key) => keys.has(key))).toEqual([]);
  });

  for (const entry of manifest.cases) {
    test(entry.id, async () => runAcceptance(M3_13_ACCEPTANCE_CASES[entry.id]));
  }
});
