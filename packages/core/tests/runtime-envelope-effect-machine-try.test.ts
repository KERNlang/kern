import { makeEnv } from '../src/ir/semantics/index.js';
import {
  INTERNAL_EFFECT_MACHINE_DISPOSITION,
  INTERNAL_EFFECT_MACHINE_FORMAT,
  runInternalEffectMachineAsync,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import { registerAllContracts } from '../src/ir/semantics/register-all.js';
import { tracesEqual } from '../src/ir/semantics/trace.js';
import { executeInternalRuntimeEnvelopeSync } from '../src/runtime-envelope/execute.js';
import { selectInternalRuntimeEngine } from '../src/runtime-envelope/internal-engine.js';
import type { InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import type { IRNode } from '../src/types.js';

const limits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxStringBytes: 4_096,
};

const capability = (): IRNode => ({
  type: 'capability',
  props: { namespace: 'llm', operation: 'complete' },
});
const canonicalThrow = (): IRNode => ({ type: 'throw', props: { value: 'new Error("boom")' } });
const cleanup = (): IRNode => ({
  type: 'finally',
  children: [capability(), { type: 'print', props: { value: '"cleanup"' } }],
});

describe('private effect-machine try ownership', () => {
  beforeAll(() => registerAllContracts());

  test('claims root try only after complete ownership is available', () => {
    const nodes: IRNode[] = [{ type: 'try', children: [{ type: 'print', props: { value: '"work"' } }, cleanup()] }];
    expect(INTERNAL_EFFECT_MACHINE_DISPOSITION.try).toBe('unified');
    expect(selectInternalRuntimeEngine(nodes, makeEnv())).toBe(INTERNAL_EFFECT_MACHINE_FORMAT);
  });

  test('resumes capabilities in body, catch, and finally with raw sync/async parity', async () => {
    const nodes: IRNode[] = [
      {
        type: 'try',
        children: [
          capability(),
          canonicalThrow(),
          {
            type: 'catch',
            props: { name: 'error' },
            children: [capability(), { type: 'print', props: { value: 'error.message' } }],
          },
          cleanup(),
        ],
      },
    ];
    const sync = runInternalEffectMachineSync(nodes, makeEnv({ capabilities: { llm: { complete: () => 'ok' } } }));
    const asyncTrace = await runInternalEffectMachineAsync(nodes, makeEnv(), {
      asyncCapabilities: { llm: { complete: async () => 'ok' } },
    });
    expect(tracesEqual(sync, asyncTrace)).toBe(true);
    expect(sync.completion).toEqual({ kind: 'normal' });
    expect(sync.events.filter((event) => event.op === 'capability')).toHaveLength(3);
    expect(sync.events.filter((event) => event.op === 'stdout')).toEqual([
      { op: 'stdout', text: 'boom' },
      { op: 'stdout', text: 'cleanup' },
    ]);
  });

  test('preflights every try clause before the protected capability', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'try',
        children: [
          { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
          { type: 'lambda', props: { name: 'unsupported' } },
          { type: 'finally', children: [{ type: 'print', props: { value: '"cleanup"' } }] },
        ],
      },
    ];
    expect(
      executeInternalRuntimeEnvelopeSync(nodes, makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } }), {
        enabled: true,
        limits,
      }),
    ).toMatchObject({ diagnostics: [{ code: 'unsupported-runtime-input' }], events: [], outcome: 'failure' });
    expect(calls).toBe(0);
  });

  test('propagates loop control through normal finally and consumes it in the owning loop', () => {
    const nodes: IRNode[] = [
      {
        type: 'for',
        props: { from: '0', name: 'index', to: '3' },
        children: [
          {
            type: 'try',
            children: [
              { type: 'continue' },
              { type: 'finally', children: [{ type: 'print', props: { value: '"cleanup"' } }] },
            ],
          },
        ],
      },
    ];
    expect(runInternalEffectMachineSync(nodes, makeEnv(), { iterationBudget: 3 })).toEqual({
      completion: { kind: 'normal' },
      events: [
        { binding: 'index', op: 'iter-next', value: 0 },
        { op: 'stdout', text: 'cleanup' },
        { binding: 'index', op: 'iter-next', value: 1 },
        { op: 'stdout', text: 'cleanup' },
        { binding: 'index', op: 'iter-next', value: 2 },
        { op: 'stdout', text: 'cleanup' },
      ],
    });
  });

  test('tombstones the caught name when a sync provider aborts catch execution', () => {
    const env = makeEnv({
      bindings: new Map([['error', 'outer']]),
      capabilities: {
        llm: {
          complete: () => {
            throw new Error('provider failed');
          },
        },
      },
    });
    const nodes: IRNode[] = [
      {
        type: 'try',
        children: [canonicalThrow(), { type: 'catch', props: { name: 'error' }, children: [capability()] }],
      },
    ];
    expect(() => runInternalEffectMachineSync(nodes, env)).toThrow(/provider failed/);
    expect(env.bindings.get('error')).not.toBe('outer');
  });

  test('tombstones the caught name when an async provider aborts catch execution', async () => {
    const env = makeEnv({ bindings: new Map([['error', 'outer']]) });
    const nodes: IRNode[] = [
      {
        type: 'try',
        children: [canonicalThrow(), { type: 'catch', props: { name: 'error' }, children: [capability()] }],
      },
    ];
    await expect(
      runInternalEffectMachineAsync(nodes, env, {
        asyncCapabilities: {
          llm: {
            complete: async () => {
              throw new Error('provider failed');
            },
          },
        },
      }),
    ).rejects.toThrow(/provider failed/);
    expect(env.bindings.get('error')).not.toBe('outer');
  });
});
