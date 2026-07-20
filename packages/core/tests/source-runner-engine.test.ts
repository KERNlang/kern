import { makeEnv } from '../src/ir/semantics/semantic-env.js';
import {
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  SourceRunnerEngineError,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';

const simple: readonly IRNode[] = [
  { type: 'let', props: { name: 'value', value: '41' } },
  { type: 'assign', props: { target: 'value', value: 'value + 1' } },
  { type: 'return', props: { value: 'value' } },
];

describe('source runner pre-execution engine selection', () => {
  test('selects and executes the canonical machine for an admitted sync sequence', () => {
    expect(selectSourceRunnerEngine(simple, makeEnv(), {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(simple, makeEnv(), { policy: 'machine-only' })).toEqual({
      completion: { kind: 'return', value: 42 },
      events: [
        { op: 'assign', target: 'value', value: 41 },
        { op: 'assign', target: 'value', value: 42 },
      ],
    });
  });

  test('executes admitted do programs without the legacy engine', () => {
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'items', value: '[]' } },
      { type: 'do', props: { value: 'items.push(7)' } },
      { type: 'return', props: { value: 'items' } },
    ];
    const trace = executeSourceRunnerSync(nodes, makeEnv(), { policy: 'machine-only' });
    expect(trace.completion).toEqual({ kind: 'return', value: [7] });
    expect(trace.events).toEqual([{ op: 'assign', target: 'items', value: [] }]);
  });

  test('rejects invalid machine-claimed structure before any earlier effect instead of falling back', () => {
    let calls = 0;
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'do', props: { value: 'arbitraryEffect()' } },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => ++calls } } });
    expect(() => selectSourceRunnerEngine(nodes, env, {})).toThrow();
    expect(() => executeSourceRunnerSync(nodes, env, { policy: 'compatible' })).toThrow();
    expect(calls).toBe(0);
  });

  test('requires caller-owned iteration budget instead of embedding a loop threshold', () => {
    const nodes: readonly IRNode[] = [
      { type: 'for', props: { from: '0', name: 'i', to: '1' }, children: [{ type: 'print', props: { value: 'i' } }] },
    ];
    expect(selectSourceRunnerEngine(nodes, makeEnv(), {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(selectSourceRunnerEngine(nodes, makeEnv(), { iterationBudget: 1 })).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(() => selectSourceRunnerEngine(nodes, makeEnv(), { iterationBudget: 0 })).toThrow(
      new SourceRunnerEngineError('invalid-iteration-budget'),
    );
  });

  test('moves expression-v1, bounded each, and lambda to the machine while keeping environment blockers', () => {
    const expression: readonly IRNode[] = [{ type: 'expression-v1', props: { expr: '1', name: 'value' } }];
    const lambda: readonly IRNode[] = [{ type: 'lambda', props: { expr: 'List.map(xs, x => x)' } }];
    const pairEach: readonly IRNode[] = [
      {
        type: 'each',
        props: { in: 'pairs', pairKey: 'key', pairValue: 'value' },
        children: [{ type: 'print', props: { value: 'value' } }],
      },
    ];
    const pairEnv = () => makeEnv({ bindings: new Map([['pairs', [['a', 1]]]]) });
    expect(selectSourceRunnerEngine(expression, makeEnv(), {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(expression, makeEnv(), { policy: 'machine-only' })).toEqual({
      completion: { kind: 'normal' },
      events: [{ op: 'assign', target: 'value', value: 1 }],
    });
    expect(selectSourceRunnerEngine(lambda, makeEnv({ bindings: new Map([['xs', [1, 2]]]) }), {})).toBe(
      SOURCE_RUNNER_ENGINE.legacy,
    );
    expect(
      selectSourceRunnerEngine(lambda, makeEnv({ bindings: new Map([['xs', [1, 2]]]) }), { iterationBudget: 2 }),
    ).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(
      executeSourceRunnerSync(lambda, makeEnv({ bindings: new Map([['xs', [1, 2]]]) }), {
        iterationBudget: 2,
        policy: 'machine-only',
      }),
    ).toEqual({ completion: { kind: 'normal' }, events: [{ op: 'stdout', text: '1,2' }] });
    expect(selectSourceRunnerEngine(pairEach, pairEnv(), { iterationBudget: 1 })).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(pairEach, pairEnv(), { iterationBudget: 1, policy: 'machine-only' })).toEqual({
      completion: { kind: 'normal' },
      events: [
        { binding: 'value', op: 'iter-next', value: 1 },
        { op: 'stdout', text: '1' },
      ],
    });
    expect(selectSourceRunnerEngine(simple, makeEnv({ runnerFunctions: new Map([['helper', {}]]) as never }), {})).toBe(
      SOURCE_RUNNER_ENGINE.legacy,
    );
    expect(selectSourceRunnerEngine(simple, makeEnv({ runnerClasses: new Map([['Example', {}]]) as never }), {})).toBe(
      SOURCE_RUNNER_ENGINE.legacy,
    );
  });

  test('runs the immediate async capability lane on the same machine', async () => {
    const nodes: readonly IRNode[] = [
      {
        type: 'capability',
        props: { input: '"hello"', name: 'answer', namespace: 'llm', operation: 'complete' },
      },
      { type: 'return', props: { value: 'answer' } },
    ];
    const trace = await executeSourceRunnerAsync(nodes, makeEnv(), {
      asyncCapabilities: { llm: { complete: async ({ input }) => `reply:${input}` } },
      policy: 'machine-only',
    });
    expect(trace.completion).toEqual({ kind: 'return', value: 'reply:hello' });
    expect(
      trace.events.some(
        (event) =>
          event.op === 'capability' &&
          event.namespace === 'llm' &&
          event.operation === 'complete' &&
          event.input === 'hello' &&
          event.result === 'reply:hello',
      ),
    ).toBe(true);
  });
});
