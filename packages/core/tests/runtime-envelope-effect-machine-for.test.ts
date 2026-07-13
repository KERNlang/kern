import { makeEnv } from '../src/ir/semantics/index.js';
import {
  INTERNAL_EFFECT_MACHINE_FORMAT,
  isInternalEffectMachineEligible,
  runInternalEffectMachineAsync,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import { registerAllContracts } from '../src/ir/semantics/register-all.js';
import { tracesEqual } from '../src/ir/semantics/trace.js';
import {
  executeInternalRuntimeEnvelopeAsync,
  executeInternalRuntimeEnvelopeSync,
} from '../src/runtime-envelope/execute.js';
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
const enabled = { enabled: true, limits } as const;

describe('private effect-machine counted for frames', () => {
  beforeAll(() => registerAllContracts());

  test('repeats capability effects with raw sync/async trace parity', async () => {
    const nodes: IRNode[] = [
      {
        type: 'for',
        props: { from: '0', name: 'i', to: '3' },
        children: [
          {
            type: 'capability',
            props: { input: 'i', name: 'answer', namespace: 'llm', operation: 'complete' },
          },
          { type: 'print', props: { value: 'answer' } },
        ],
      },
    ];
    const syncInputs: unknown[] = [];
    const asyncInputs: unknown[] = [];
    const syncTrace = runInternalEffectMachineSync(
      nodes,
      makeEnv({
        capabilities: {
          llm: {
            complete: ({ input }) => {
              syncInputs.push(input);
              return `ack:${input}`;
            },
          },
        },
      }),
      { iterationBudget: limits.maxCollectionLength },
    );
    const asyncTrace = await runInternalEffectMachineAsync(nodes, makeEnv(), {
      iterationBudget: limits.maxCollectionLength,
      asyncCapabilities: {
        llm: {
          complete: async ({ input }) => {
            asyncInputs.push(input);
            return `ack:${input}`;
          },
        },
      },
    });

    expect(isInternalEffectMachineEligible(nodes, makeEnv())).toBe(true);
    expect(selectInternalRuntimeEngine(nodes, makeEnv())).toBe(INTERNAL_EFFECT_MACHINE_FORMAT);
    expect(syncInputs).toEqual([0, 1, 2]);
    expect(asyncInputs).toEqual(syncInputs);
    expect(tracesEqual(syncTrace, asyncTrace)).toBe(true);
    expect(syncTrace.events.filter((event) => event.op === 'iter-next')).toEqual([
      { binding: 'i', op: 'iter-next', value: 0 },
      { binding: 'i', op: 'iter-next', value: 1 },
      { binding: 'i', op: 'iter-next', value: 2 },
    ]);
  });

  test('evaluates range bounds once before body mutation', () => {
    const nodes: IRNode[] = [
      { type: 'let', props: { kind: 'let', name: 'limit', value: '3' } },
      {
        type: 'for',
        props: { from: '0', name: 'i', to: 'limit' },
        children: [{ type: 'assign', props: { op: '=', target: 'limit', value: '0' } }],
      },
    ];
    const trace = runInternalEffectMachineSync(nodes, makeEnv(), { iterationBudget: limits.maxCollectionLength });
    expect(trace.events.filter((event) => event.op === 'iter-next')).toEqual([
      { binding: 'i', op: 'iter-next', value: 0 },
      { binding: 'i', op: 'iter-next', value: 1 },
      { binding: 'i', op: 'iter-next', value: 2 },
    ]);
  });

  test.each([
    [{ from: '2', name: 'i', step: '-1', to: '-1' }, [2, 1, 0]],
    [{ from: '0', name: 'i', to: '0' }, []],
    [{ from: '0', name: 'i', step: '-1', to: '3' }, []],
  ])('preserves half-open range semantics for %o', (props, values) => {
    const trace = runInternalEffectMachineSync([{ type: 'for', props, children: [] }], makeEnv(), {
      iterationBudget: limits.maxCollectionLength,
    });
    expect(trace.events.filter((event) => event.op === 'iter-next').map((event) => event.value)).toEqual(values);
  });

  test('fresh iteration scopes ignore prior induction mutation and redeclaration', () => {
    const nodes: IRNode[] = [
      {
        type: 'for',
        props: { from: '0', name: 'i', to: '3' },
        children: [
          { type: 'let', props: { name: 'temporary', value: 'i' } },
          { type: 'assign', props: { op: '+=', target: 'i', value: '100' } },
        ],
      },
    ];
    expect(
      runInternalEffectMachineSync(nodes, makeEnv(), { iterationBudget: limits.maxCollectionLength }).events.filter(
        (event) => event.op === 'iter-next',
      ),
    ).toEqual([
      { binding: 'i', op: 'iter-next', value: 0 },
      { binding: 'i', op: 'iter-next', value: 1 },
      { binding: 'i', op: 'iter-next', value: 2 },
    ]);
  });

  test('consumes continue and break inside nested if frames', () => {
    const nodes: IRNode[] = [
      {
        type: 'for',
        props: { from: '0', name: 'i', to: '5' },
        children: [
          { type: 'if', props: { cond: 'i == 1' }, children: [{ type: 'continue' }] },
          { type: 'if', props: { cond: 'i == 3' }, children: [{ type: 'break' }] },
          { type: 'print', props: { value: 'i' } },
        ],
      },
    ];
    const trace = runInternalEffectMachineSync(nodes, makeEnv(), { iterationBudget: limits.maxCollectionLength });
    expect(trace.events.filter((event) => event.op === 'iter-next').map((event) => event.value)).toEqual([0, 1, 2, 3]);
    expect(trace.events.filter((event) => event.op === 'stdout')).toEqual([
      { op: 'stdout', text: '0' },
      { op: 'stdout', text: '2' },
    ]);
    expect(trace.completion).toEqual({ kind: 'normal' });
  });

  test.each([
    [{ type: 'return', props: { value: '9' } } as IRNode, { kind: 'return', value: 9 }],
    [{ type: 'throw', props: { errorKind: 'Error' } } as IRNode, { error: { kind: 'Error' }, kind: 'throw' }],
  ])('propagates %s completion out of the loop', (abrupt, completion) => {
    const nodes: IRNode[] = [{ type: 'for', props: { from: '0', name: 'i', to: '1' }, children: [abrupt] }];
    expect(
      runInternalEffectMachineSync(nodes, makeEnv(), { iterationBudget: limits.maxCollectionLength }).completion,
    ).toEqual(completion);
  });

  test('runs a for frame nested inside an if without legacy fallback', () => {
    const nodes: IRNode[] = [
      {
        type: 'if',
        props: { cond: 'true' },
        children: [{ type: 'for', props: { from: '0', name: 'i', to: '2' }, children: [] }],
      },
    ];
    expect(
      runInternalEffectMachineSync(nodes, makeEnv(), { iterationBudget: limits.maxCollectionLength }).events,
    ).toEqual([
      { binding: 'i', op: 'iter-next', value: 0 },
      { binding: 'i', op: 'iter-next', value: 1 },
    ]);
  });

  test('rejects an unsupported descendant before capability dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'for',
        props: { from: '0', name: 'i', to: '1' },
        children: [
          { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
          { type: 'try', children: [{ type: 'finally', children: [] }] },
        ],
      },
    ];
    expect(
      executeInternalRuntimeEnvelopeSync(
        nodes,
        makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } }),
        enabled,
      ),
    ).toMatchObject({ diagnostics: [{ code: 'unsupported-runtime-input' }], events: [], outcome: 'failure' });
    expect(calls).toBe(0);
  });

  test('rejects a zero step', () => {
    const nodes: IRNode[] = [{ type: 'for', props: { from: '0', name: 'i', step: '0', to: '2' }, children: [] }];
    expect(executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      outcome: 'failure',
    });
  });

  test('enforces the caller-configured iteration budget before raw trace growth', () => {
    const bounded = { ...enabled, limits: { ...limits, maxCollectionLength: 2 } } as const;
    const nodes: IRNode[] = [{ type: 'for', props: { from: '0', name: 'i', to: '3' }, children: [] }];
    expect(executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), bounded)).toMatchObject({
      events: [],
      outcome: 'failure',
    });
  });

  test('enforces the same caller-configured iteration budget in the async envelope', async () => {
    const bounded = { ...enabled, limits: { ...limits, maxCollectionLength: 2 } } as const;
    const nodes: IRNode[] = [{ type: 'for', props: { from: '0', name: 'i', to: '3' }, children: [] }];
    const result = await executeInternalRuntimeEnvelopeAsync(nodes, makeEnv(), bounded);
    expect(result).toMatchObject({
      events: [],
      outcome: 'failure',
    });
  });

  test('requires direct machine callers to provide an iteration budget', () => {
    const nodes: IRNode[] = [{ type: 'for', props: { from: '0', name: 'i', to: '1' }, children: [] }];
    expect(() => runInternalEffectMachineSync(nodes, makeEnv())).toThrow(/iteration budget/u);
  });

  test('shares one iteration budget across nested loop frames', () => {
    const bounded = { ...enabled, limits: { ...limits, maxCollectionLength: 4 } } as const;
    const nodes: IRNode[] = [
      {
        type: 'for',
        props: { from: '0', name: 'outer', to: '2' },
        children: [{ type: 'for', props: { from: '0', name: 'inner', to: '2' }, children: [] }],
      },
    ];
    expect(executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), bounded)).toMatchObject({
      events: [],
      outcome: 'failure',
    });
  });
});
