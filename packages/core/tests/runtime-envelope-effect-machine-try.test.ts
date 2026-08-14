import { makeEnv } from '../src/ir/semantics/index.js';
import {
  INTERNAL_EFFECT_MACHINE_DISPOSITION,
  INTERNAL_EFFECT_MACHINE_FORMAT,
  runInternalEffectMachineAsync,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import { registerAllContracts } from '../src/ir/semantics/register-all.js';
import { tracesEqual } from '../src/ir/semantics/trace.js';
import { UNAVAILABLE_CAUGHT_ERROR } from '../src/ir/semantics/try-runtime.js';
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

  test('joins a host-argument-limit-sized try trace without variadic exhaustion', () => {
    const iterations = 130_000;
    const nodes: IRNode[] = [
      {
        type: 'try',
        children: [
          {
            type: 'for',
            props: { from: '0', name: 'index', to: String(iterations) },
            children: [{ type: 'print', props: { value: 'index' } }],
          },
          { type: 'finally', children: [{ type: 'print', props: { value: '"done"' } }] },
        ],
      },
    ];

    const trace = runInternalEffectMachineSync(nodes, makeEnv(), { iterationBudget: iterations });
    expect(trace.completion).toEqual({ kind: 'normal' });
    expect(trace.events).toHaveLength(2 * iterations + 1);
    expect(trace.events.slice(0, 2)).toEqual([
      { binding: 'index', op: 'iter-next', value: 0 },
      { op: 'stdout', text: '0' },
    ]);
    expect(trace.events.at(-1)).toEqual({ op: 'stdout', text: 'done' });
  });

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

  test('finally observes a body binding created before return', () => {
    const nodes: IRNode[] = [
      {
        type: 'try',
        children: [
          { type: 'let', props: { name: 'answer', value: '7' } },
          { type: 'return', props: { value: 'answer' } },
          { type: 'finally', children: [{ type: 'print', props: { value: 'answer' } }] },
        ],
      },
    ];

    expect(executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), { enabled: true, limits })).toMatchObject({
      completion: { kind: 'return' },
      events: [{ op: 'stdout', text: '7' }],
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: '7' } },
    });
  });

  test('catch and finally observe bindings guaranteed before their entry', () => {
    const nodes: IRNode[] = [
      {
        type: 'try',
        children: [
          { type: 'let', props: { name: 'bodyValue', value: '7' } },
          canonicalThrow(),
          {
            type: 'catch',
            props: { name: 'error' },
            children: [
              { type: 'print', props: { value: 'bodyValue' } },
              { type: 'let', props: { name: 'caughtValue', value: '9' } },
            ],
          },
          { type: 'finally', children: [{ type: 'print', props: { value: 'caughtValue' } }] },
        ],
      },
    ];

    expect(executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), { enabled: true, limits })).toMatchObject({
      events: [
        { op: 'stdout', text: '7' },
        { op: 'stdout', text: '9' },
      ],
      outcome: 'success',
    });
  });

  test('admits caught-error message as a capability input while keeping the raw object closed', () => {
    const inputs: unknown[] = [];
    const nodes: IRNode[] = [
      {
        type: 'try',
        children: [
          canonicalThrow(),
          {
            type: 'catch',
            props: { name: 'error' },
            children: [
              {
                type: 'capability',
                props: { input: 'error.message', name: 'answer', namespace: 'storage', operation: 'echo' },
              },
            ],
          },
        ],
      },
      { type: 'return', props: { value: 'answer' } },
    ];
    const env = makeEnv({
      capabilities: {
        storage: {
          echo: ({ input }) => {
            inputs.push(input);
            return input;
          },
        },
      },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, { enabled: true, limits })).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'text', value: 'boom' } },
    });
    expect(inputs).toEqual(['boom']);
  });

  test('normal catch completion preserves the frozen same-env tombstone contract', () => {
    const env = makeEnv({ bindings: new Map([['error', 'outer']]) });
    const nodes: IRNode[] = [
      {
        type: 'try',
        children: [canonicalThrow(), { type: 'catch', props: { name: 'error' }, children: [] }],
      },
    ];

    expect(runInternalEffectMachineSync(nodes, env)).toMatchObject({ completion: { kind: 'normal' } });
    expect(env.bindings.get('error')).toBe(UNAVAILABLE_CAUGHT_ERROR);
  });

  test('rejects a finally read declared only after return before an earlier provider runs', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'try',
        children: [
          { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
          { type: 'return', props: { value: '1' } },
          { type: 'let', props: { name: 'late', value: '2' } },
          { type: 'finally', children: [{ type: 'print', props: { value: 'late' } }] },
        ],
      },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, { enabled: true, limits })).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('preserves an outer same-name binding when the catch path is unreachable', () => {
    const nodes: IRNode[] = [
      {
        type: 'try',
        children: [
          { type: 'print', props: { value: '"body"' } },
          { type: 'catch', props: { name: 'error' }, children: [] },
        ],
      },
      { type: 'print', props: { value: 'error' } },
      { type: 'return', props: { value: 'error' } },
    ];

    expect(
      executeInternalRuntimeEnvelopeSync(nodes, makeEnv({ bindings: new Map([['error', 42]]) }), {
        enabled: true,
        limits,
      }),
    ).toMatchObject({
      events: [
        { op: 'stdout', text: 'body' },
        { op: 'stdout', text: '42' },
      ],
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: '42' } },
    });
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
