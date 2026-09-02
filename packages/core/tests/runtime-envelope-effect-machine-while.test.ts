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
  maxIterations: 64,
  maxStringBytes: 4_096,
};
const enabled = { enabled: true, limits } as const;

describe('private effect-machine while frames', () => {
  beforeAll(() => registerAllContracts());

  test('repeats capability effects with raw sync/async trace parity', async () => {
    const nodes: IRNode[] = [
      { type: 'let', props: { kind: 'let', name: 'n', value: '0' } },
      {
        type: 'while',
        props: { cond: 'n < 3' },
        children: [
          {
            type: 'capability',
            props: { input: 'n', name: 'answer', namespace: 'llm', operation: 'complete' },
          },
          { type: 'print', props: { value: 'answer' } },
          { type: 'assign', props: { op: '+=', target: 'n', value: '1' } },
        ],
      },
      { type: 'return', props: { value: 'n' } },
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
      { iterationBudget: limits.maxIterations },
    );
    const asyncTrace = await runInternalEffectMachineAsync(nodes, makeEnv(), {
      iterationBudget: limits.maxIterations,
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
    expect(syncTrace.completion).toEqual({ kind: 'return', value: 3 });
    expect(syncTrace.events.filter((event) => event.op === 'capability')).toHaveLength(3);
    expect(syncTrace.events.filter((event) => event.op === 'stdout')).toEqual([
      { op: 'stdout', text: 'ack:0' },
      { op: 'stdout', text: 'ack:1' },
      { op: 'stdout', text: 'ack:2' },
    ]);
  });

  test('consumes continue and break inside nested if frames', () => {
    const nodes: IRNode[] = [
      { type: 'let', props: { kind: 'let', name: 'n', value: '0' } },
      {
        type: 'while',
        props: { cond: 'n < 5' },
        children: [
          { type: 'assign', props: { op: '+=', target: 'n', value: '1' } },
          { type: 'if', props: { cond: 'n == 2' }, children: [{ type: 'continue' }] },
          { type: 'if', props: { cond: 'n == 3' }, children: [{ type: 'break' }] },
          { type: 'print', props: { value: 'n' } },
        ],
      },
      { type: 'return', props: { value: 'n' } },
    ];

    expect(runInternalEffectMachineSync(nodes, makeEnv(), { iterationBudget: limits.maxIterations })).toEqual({
      completion: { kind: 'return', value: 3 },
      events: [
        { op: 'assign', target: 'n', value: 0 },
        { op: 'assign', target: 'n', value: 1 },
        { op: 'stdout', text: '1' },
        { op: 'assign', target: 'n', value: 2 },
        { op: 'assign', target: 'n', value: 3 },
      ],
    });
  });

  test('uses a fresh child scope per iteration and writes through outer assignments', () => {
    const nodes: IRNode[] = [
      { type: 'let', props: { kind: 'let', name: 'total', value: '0' } },
      {
        type: 'while',
        props: { cond: 'total < 2' },
        children: [
          { type: 'let', props: { name: 'temporary', value: 'total' } },
          { type: 'assign', props: { op: '+=', target: 'total', value: '1' } },
        ],
      },
      { type: 'return', props: { value: 'total' } },
    ];

    expect(runInternalEffectMachineSync(nodes, makeEnv(), { iterationBudget: limits.maxIterations })).toMatchObject({
      completion: { kind: 'return', value: 2 },
    });
  });

  test('runs a while frame nested inside an if without legacy fallback', () => {
    const nodes: IRNode[] = [
      {
        type: 'if',
        props: { cond: 'true' },
        children: [
          { type: 'let', props: { kind: 'let', name: 'n', value: '0' } },
          {
            type: 'while',
            props: { cond: 'n < 2' },
            children: [{ type: 'assign', props: { op: '+=', target: 'n', value: '1' } }],
          },
          { type: 'return', props: { value: 'n' } },
        ],
      },
    ];

    expect(
      runInternalEffectMachineSync(nodes, makeEnv(), { iterationBudget: limits.maxIterations }).completion,
    ).toEqual({ kind: 'return', value: 2 });
  });

  test.each([
    [{ type: 'return', props: { value: '9' } } as IRNode, { kind: 'return', value: 9 }],
    [{ type: 'throw', props: { errorKind: 'Error' } } as IRNode, { error: { kind: 'Error' }, kind: 'throw' }],
  ])('propagates %s completion out of the loop', (abrupt, completion) => {
    const nodes: IRNode[] = [{ type: 'while', props: { cond: 'true' }, children: [abrupt] }];
    expect(
      runInternalEffectMachineSync(nodes, makeEnv(), { iterationBudget: limits.maxIterations }).completion,
    ).toEqual(completion);
  });

  test('rejects an unsupported descendant before capability dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'while',
        props: { cond: 'true' },
        children: [
          { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
          {
            type: 'try',
            children: [{ type: 'finally', children: [{ type: 'lambda', props: { expr: 'List.map(xs, x => x)' } }] }],
          },
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

  test('does not claim loop control outside a while body', () => {
    expect(isInternalEffectMachineEligible([{ type: 'break' }], makeEnv())).toBe(false);
    expect(isInternalEffectMachineEligible([{ type: 'continue' }], makeEnv())).toBe(false);
  });

  test('a false initial condition performs no body effect', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'while',
        props: { cond: 'false' },
        children: [{ type: 'capability', props: { namespace: 'storage', operation: 'get' } }],
      },
    ];
    expect(
      runInternalEffectMachineSync(nodes, makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } }), {
        iterationBudget: limits.maxIterations,
      }),
    ).toEqual({ completion: { kind: 'normal' }, events: [] });
    expect(calls).toBe(0);
  });
});
