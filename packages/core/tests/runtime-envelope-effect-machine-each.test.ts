import { iterateEachRuntimeSteps } from '../src/ir/semantics/each.js';
import { makeEnv } from '../src/ir/semantics/index.js';
import {
  INTERNAL_EFFECT_MACHINE_FORMAT,
  isInternalEffectMachineEligible,
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
const enabled = { enabled: true, limits } as const;
const machineOptions = { iterationBudget: limits.maxCollectionLength } as const;

function arrayEnv(name: string, values: unknown[]) {
  return makeEnv({ bindings: new Map([[name, values]]) });
}

describe('private effect-machine array each frames', () => {
  beforeAll(() => registerAllContracts());

  test('claims array and indexed-array shapes but leaves pair and entry shapes legacy', () => {
    const body: IRNode[] = [{ type: 'print', props: { value: 'item' } }];
    const arrayEach: IRNode = { type: 'each', props: { in: 'items', name: 'item' }, children: body };
    const indexedEach: IRNode = {
      type: 'each',
      props: { in: 'items', index: 'index', name: 'item' },
      children: body,
    };
    const pairEach: IRNode = {
      type: 'each',
      props: { in: 'items', pairKey: 'key', pairValue: 'item' },
      children: body,
    };
    const asyncPairEach: IRNode = {
      type: 'each',
      props: { await: true, in: 'items', pairKey: 'key', pairValue: 'item' },
      children: body,
    };
    const entryEach: IRNode = {
      type: 'each',
      props: { entries: true, entryValue: 'item', in: 'items' },
      children: body,
    };
    const env = arrayEnv('items', [1]);

    expect(isInternalEffectMachineEligible([arrayEach], env)).toBe(true);
    expect(isInternalEffectMachineEligible([indexedEach], env)).toBe(true);
    expect(selectInternalRuntimeEngine([arrayEach], env)).toBe(INTERNAL_EFFECT_MACHINE_FORMAT);
    expect(isInternalEffectMachineEligible([pairEach], env)).toBe(false);
    expect(isInternalEffectMachineEligible([asyncPairEach], env)).toBe(false);
    expect(isInternalEffectMachineEligible([entryEach], env)).toBe(false);
  });

  test('rejects a non-array binding with an explicit array-shape diagnostic', () => {
    const node: IRNode = {
      type: 'each',
      props: { in: 'items', name: 'item' },
      children: [{ type: 'print', props: { value: 'item' } }],
    };
    expect(() => Array.from(iterateEachRuntimeSteps(node, makeEnv({ bindings: new Map([['items', 1]]) })))).toThrow(
      /must resolve to an array/u,
    );
  });

  test('repeats indexed capability effects with raw sync/async trace parity', async () => {
    const nodes: IRNode[] = [
      {
        type: 'each',
        props: { in: 'items', index: 'index', name: 'item' },
        children: [
          {
            type: 'capability',
            props: { input: 'item', name: 'answer', namespace: 'llm', operation: 'complete' },
          },
          { type: 'print', props: { value: 'index' } },
          { type: 'print', props: { value: 'answer' } },
        ],
      },
    ];
    const syncInputs: unknown[] = [];
    const asyncInputs: unknown[] = [];
    const syncTrace = runInternalEffectMachineSync(
      nodes,
      makeEnv({
        bindings: new Map([['items', [2, 3]]]),
        capabilities: {
          llm: {
            complete: ({ input }) => {
              syncInputs.push(input);
              return `ack:${input}`;
            },
          },
        },
      }),
      machineOptions,
    );
    const asyncTrace = await runInternalEffectMachineAsync(nodes, arrayEnv('items', [2, 3]), {
      asyncCapabilities: {
        llm: {
          complete: async ({ input }) => {
            asyncInputs.push(input);
            return `ack:${input}`;
          },
        },
      },
      iterationBudget: limits.maxCollectionLength,
    });

    expect(syncInputs).toEqual([2, 3]);
    expect(asyncInputs).toEqual(syncInputs);
    expect(tracesEqual(syncTrace, asyncTrace)).toBe(true);
    expect(syncTrace.events).toEqual([
      { binding: 'item', op: 'iter-next', value: 2 },
      { input: 2, namespace: 'llm', op: 'capability', operation: 'complete', result: 'ack:2' },
      { op: 'assign', target: 'answer', value: 'ack:2' },
      { op: 'stdout', text: '0' },
      { op: 'stdout', text: 'ack:2' },
      { binding: 'item', op: 'iter-next', value: 3 },
      { input: 3, namespace: 'llm', op: 'capability', operation: 'complete', result: 'ack:3' },
      { op: 'assign', target: 'answer', value: 'ack:3' },
      { op: 'stdout', text: '1' },
      { op: 'stdout', text: 'ack:3' },
    ]);
  });

  test('break stops iteration after the reached array element', () => {
    const items = [1, 2];
    const nodes: IRNode[] = [{ type: 'each', props: { in: 'items', name: 'item' }, children: [{ type: 'break' }] }];
    const env = makeEnv();
    env.bindings.set('items', items);
    expect(runInternalEffectMachineSync(nodes, env, machineOptions)).toEqual({
      completion: { kind: 'normal' },
      events: [{ binding: 'item', op: 'iter-next', value: 1 }],
    });
  });

  test('checks the shared budget before starting the next array iteration', () => {
    const items = [1, 2];
    const nodes: IRNode[] = [
      { type: 'each', props: { in: 'items', name: 'item' }, children: [{ type: 'print', props: { value: 'item' } }] },
    ];
    const env = makeEnv();
    env.bindings.set('items', items);

    expect(() => runInternalEffectMachineSync(nodes, env, { iterationBudget: 1 })).toThrow(/budget exhausted/u);
  });

  test('uses fresh iteration bindings while outer assignments write through', () => {
    const nodes: IRNode[] = [
      {
        type: 'each',
        props: { in: 'items', index: 'index', name: 'item' },
        children: [
          { type: 'let', props: { name: 'temporary', value: 'item' } },
          { type: 'assign', props: { op: '+=', target: 'total', value: 'item' } },
          { type: 'print', props: { value: 'index' } },
        ],
      },
      { type: 'return', props: { value: 'total' } },
    ];
    const trace = runInternalEffectMachineSync(
      nodes,
      makeEnv({
        bindings: new Map<string, unknown>([
          ['items', [2, 3]],
          ['total', 0],
        ]),
      }),
      machineOptions,
    );
    expect(trace.completion).toEqual({ kind: 'return', value: 5 });
    expect(trace.events.filter((event) => event.op === 'stdout')).toEqual([
      { op: 'stdout', text: '0' },
      { op: 'stdout', text: '1' },
    ]);
  });

  test('consumes continue and break inside nested if frames', () => {
    const nodes: IRNode[] = [
      {
        type: 'each',
        props: { in: 'items', name: 'item' },
        children: [
          { type: 'if', props: { cond: 'item == 1' }, children: [{ type: 'continue' }] },
          { type: 'if', props: { cond: 'item == 3' }, children: [{ type: 'break' }] },
          { type: 'print', props: { value: 'item' } },
        ],
      },
    ];
    const trace = runInternalEffectMachineSync(nodes, arrayEnv('items', [0, 1, 2, 3, 4]), machineOptions);
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
    const nodes: IRNode[] = [{ type: 'each', props: { in: 'items', name: 'item' }, children: [abrupt] }];
    expect(runInternalEffectMachineSync(nodes, arrayEnv('items', [1]), machineOptions).completion).toEqual(completion);
  });

  test('shares one budget across nested for and each frames', () => {
    const bounded = { ...enabled, limits: { ...limits, maxCollectionLength: 5 } } as const;
    const nodes: IRNode[] = [
      {
        type: 'for',
        props: { from: '0', name: 'outer', to: '2' },
        children: [
          {
            type: 'each',
            props: { in: 'items', name: 'item' },
            children: [{ type: 'print', props: { value: 'item' } }],
          },
        ],
      },
    ];
    expect(executeInternalRuntimeEnvelopeSync(nodes, arrayEnv('items', [1, 2]), bounded)).toMatchObject({
      events: [],
      outcome: 'failure',
    });
  });

  test('requires direct machine callers to provide an iteration budget', () => {
    const nodes: IRNode[] = [
      { type: 'each', props: { in: 'items', name: 'item' }, children: [{ type: 'print', props: { value: 'item' } }] },
    ];
    expect(() => runInternalEffectMachineSync(nodes, arrayEnv('items', [1]))).toThrow(/iteration budget/u);
  });

  test('rejects unsupported descendants before capability dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'each',
        props: { in: 'items', name: 'item' },
        children: [
          { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
          {
            type: 'try',
            children: [{ type: 'finally', children: [{ type: 'expression-v1', props: { name: 'res', expr: '1' } }] }],
          },
        ],
      },
    ];
    expect(
      executeInternalRuntimeEnvelopeSync(
        nodes,
        makeEnv({
          bindings: new Map([['items', [1]]]),
          capabilities: { storage: { get: () => (calls += 1) } },
        }),
        enabled,
      ),
    ).toMatchObject({ diagnostics: [{ code: 'unsupported-runtime-input' }], events: [], outcome: 'failure' });
    expect(calls).toBe(0);
  });
});
