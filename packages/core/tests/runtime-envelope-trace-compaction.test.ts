import { makeEnv } from '../src/ir/semantics/index.js';
import {
  runInternalEffectMachineAsync,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import { registerAllContracts } from '../src/ir/semantics/register-all.js';
import {
  executeInternalRuntimeEnvelopeAsync,
  executeInternalRuntimeEnvelopeSync,
} from '../src/runtime-envelope/execute.js';
import { executeInternalRuntimeEnvelopeCompatSync } from '../src/runtime-envelope/execute-compat.js';
import {
  runInternalRuntimeEngineAsync,
  runInternalRuntimeEngineSync,
} from '../src/runtime-envelope/internal-engine.js';
import type { InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import type { IRNode } from '../src/types.js';

const ITERATIONS = 16_384;
const limits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 100_000,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 8,
  maxStringBytes: 4_096,
};
const enabled = { enabled: true, limits } as const;
const assignmentLoop: IRNode[] = [
  { type: 'let', props: { name: 'total', value: '0' } },
  {
    type: 'for',
    props: { from: '0', name: 'index', to: String(ITERATIONS) },
    children: [{ type: 'assign', props: { target: 'total', value: 'total + 1' } }],
  },
  { type: 'return', props: { value: 'total' } },
];

describe('runtime-envelope trace compaction', () => {
  beforeAll(() => registerAllContracts());

  test('direct effect-machine defaults retain the exact full sync and async trace', async () => {
    const sync = runInternalEffectMachineSync(assignmentLoop, makeEnv(), {
      iterationBudget: limits.maxCollectionLength,
    });
    const asyncTrace = await runInternalEffectMachineAsync(assignmentLoop, makeEnv(), {
      iterationBudget: limits.maxCollectionLength,
    });
    expect(sync).toEqual(asyncTrace);
    expect(sync.completion).toEqual({ kind: 'return', value: ITERATIONS });
    expect(sync.events).toHaveLength(1 + 2 * ITERATIONS);
    expect(sync.events.slice(0, 3)).toEqual([
      { op: 'assign', target: 'total', value: 0 },
      { binding: 'index', op: 'iter-next', value: 0 },
      { op: 'assign', target: 'total', value: 1 },
    ]);
    expect(sync.events.at(-1)).toEqual({ op: 'assign', target: 'total', value: ITERATIONS });
  });

  test('private observable engine mode retains zero pre-normalization internal events', async () => {
    const sync = runInternalRuntimeEngineSync(
      assignmentLoop,
      makeEnv(),
      limits.maxCollectionLength,
      undefined,
      limits.maxStringBytes,
      'observable-only',
    );
    const asyncTrace = await runInternalRuntimeEngineAsync(assignmentLoop, makeEnv(), {
      iterationBudget: limits.maxCollectionLength,
      textCodePointCacheMaxStringBytes: limits.maxStringBytes,
      traceRetention: 'observable-only',
    });
    expect(sync).toEqual(asyncTrace);
    expect(sync).toEqual({ completion: { kind: 'return', value: ITERATIONS }, events: [] });
  });

  test('sync, async, and compatibility envelopes preserve result with no hidden trace', async () => {
    const sync = executeInternalRuntimeEnvelopeSync(assignmentLoop, makeEnv(), enabled);
    const asyncEnvelope = await executeInternalRuntimeEnvelopeAsync(assignmentLoop, makeEnv(), enabled);
    const compat = executeInternalRuntimeEnvelopeCompatSync(assignmentLoop, makeEnv(), enabled);
    expect(sync).toEqual(asyncEnvelope);
    expect(sync).toEqual(compat);
    expect(sync).toMatchObject({
      completion: { kind: 'return' },
      events: [],
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: String(ITERATIONS) } },
    });
  });

  test('observable event order and maxEvents enforcement remain unchanged', async () => {
    const printed: IRNode[] = [
      { type: 'print', props: { value: '"first"' } },
      { type: 'let', props: { name: 'internal', value: '1' } },
      { type: 'print', props: { value: '"second"' } },
      { type: 'return', props: { value: 'internal' } },
    ];
    const sync = executeInternalRuntimeEnvelopeSync(printed, makeEnv(), enabled);
    const asyncEnvelope = await executeInternalRuntimeEnvelopeAsync(printed, makeEnv(), enabled);
    expect(sync).toEqual(asyncEnvelope);
    expect(sync.events).toEqual([
      { op: 'stdout', text: 'first' },
      { op: 'stdout', text: 'second' },
    ]);
    const bounded = executeInternalRuntimeEnvelopeSync(printed, makeEnv(), {
      enabled: true,
      limits: { ...limits, maxEvents: 1 },
    });
    expect(bounded).toMatchObject({
      diagnostics: [{ code: 'non-portable-value' }],
      events: [],
      outcome: 'failure',
    });
  });
});
