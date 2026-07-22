import {
  runInternalEffectMachineAsync,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import { runInternalMachineDo } from '../src/ir/semantics/internal-effect-machine-do.js';
import { getBinding, makeEnv } from '../src/ir/semantics/semantic-env.js';
import { tracesEqual } from '../src/ir/semantics/trace.js';
import type { IRNode } from '../src/types.js';

function run(nodes: readonly IRNode[]) {
  return runInternalEffectMachineSync(nodes, makeEnv());
}

describe('M3.20 effect-machine do ownership', () => {
  test('empty do is a no-op with no event', () => {
    expect(run([{ type: 'do' }])).toEqual({ completion: { kind: 'normal' }, events: [] });
  });

  test('array push functionally rebinds and emits no synthetic event', () => {
    const trace = run([
      { type: 'let', props: { name: 'items', value: '[1,2]' } },
      { type: 'do', props: { value: 'items.push(3)' } },
      { type: 'return', props: { value: 'items' } },
    ]);
    expect(trace.completion).toEqual({ kind: 'return', value: [1, 2, 3] });
    expect(trace.events).toEqual([{ op: 'assign', target: 'items', value: [1, 2] }]);
  });

  test('push admits the exact nested literal surface and preserves earlier elements', () => {
    expect(
      run([
        { type: 'let', props: { name: 'rows', value: '[]' } },
        { type: 'do', props: { value: 'rows.push([1,2])' } },
        { type: 'return', props: { value: 'rows' } },
      ]).completion,
    ).toEqual({ kind: 'return', value: [[1, 2]] });
  });

  test('Map.set adds and overwrites keys without a synthetic event', () => {
    const trace = run([
      { type: 'let', props: { name: 'values', value: 'new Map()' } },
      { type: 'do', props: { value: 'Map.set(values, "key", 1)' } },
      { type: 'do', props: { value: 'Map.set(values, "key", 2)' } },
      { type: 'return', props: { value: 'Map.get(values, "key")' } },
    ]);
    expect(trace.completion).toEqual({ kind: 'return', value: 2 });
    expect(trace.events).toHaveLength(1);
  });

  test('machine Map.set updates one owned map instead of cloning its growing prefix', () => {
    const env = makeEnv({ bindings: new Map([['values', new Map<string, unknown>()]]) });
    const values = getBinding(env, 'values');

    runInternalMachineDo({ type: 'do', props: { value: 'Map.set(values, "a", 1)' } }, env);
    runInternalMachineDo({ type: 'do', props: { value: 'Map.set(values, "b", 2)' } }, env);

    expect(getBinding(env, 'values')).toBe(values);
    expect(values).toEqual(
      new Map([
        ['a', 1],
        ['b', 2],
      ]),
    );
  });

  test('rejects a Map alias before an in-place write can expose shared identity', () => {
    const env = makeEnv({ bindings: new Map([['values', new Map<string, unknown>()]]) });
    const values = getBinding(env, 'values');

    expect(() =>
      runInternalEffectMachineSync(
        [
          { type: 'let', props: { name: 'alias', value: 'values' } },
          { type: 'do', props: { value: 'Map.set(alias, "key", 1)' } },
        ],
        env,
      ),
    ).toThrow('effect machine rejected let node');
    expect(values).toEqual(new Map());
  });

  test('nested branch and try frames execute do through the same machine', () => {
    const trace = run([
      { type: 'let', props: { name: 'items', value: '[]' } },
      {
        type: 'if',
        props: { cond: 'true' },
        children: [
          {
            type: 'try',
            children: [
              { type: 'do', props: { value: 'items.push(1)' } },
              { type: 'finally', children: [{ type: 'do', props: { value: 'items.push(2)' } }] },
            ],
          },
        ],
      },
      { type: 'return', props: { value: 'items' } },
    ]);
    expect(trace.completion).toEqual({ kind: 'return', value: [1, 2] });
  });

  test('loop-deferred preflight admits a literal nested-array push', () => {
    const trace = runInternalEffectMachineSync(
      [
        { type: 'let', props: { name: 'rows', value: '[]' } },
        {
          type: 'for',
          props: { from: '0', name: 'i', to: '1' },
          children: [{ type: 'do', props: { value: 'rows.push([1,2])' } }],
        },
        { type: 'return', props: { value: 'rows' } },
      ],
      makeEnv(),
      { iterationBudget: 1 },
    );
    expect(trace.completion).toEqual({ kind: 'return', value: [[1, 2]] });
  });

  test('multiple do writes keep a known array target shape in a deferred loop body', () => {
    const trace = runInternalEffectMachineSync(
      [
        { type: 'let', props: { name: 'rows', value: '[]' } },
        {
          type: 'for',
          props: { from: '0', name: 'i', to: '1' },
          children: [
            { type: 'do', props: { value: 'rows.push([1])' } },
            { type: 'do', props: { value: 'rows.push([2])' } },
          ],
        },
        { type: 'return', props: { value: 'rows' } },
      ],
      makeEnv(),
      { iterationBudget: 1 },
    );
    expect(trace.completion).toEqual({ kind: 'return', value: [[1], [2]] });
  });

  test('rejects a deferred Map.set key before an earlier capability effect', () => {
    let calls = 0;
    const env = makeEnv({ capabilities: { storage: { get: () => ++calls } } });
    expect(() =>
      runInternalEffectMachineSync(
        [
          { type: 'let', props: { name: 'values', value: 'new Map()' } },
          { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
          {
            type: 'for',
            props: { from: '0', name: 'i', to: '1' },
            children: [{ type: 'do', props: { value: 'Map.set(values, i, 1)' } }],
          },
        ],
        env,
        { iterationBudget: 1 },
      ),
    ).toThrow();
    expect(calls).toBe(0);
  });

  test('admits syntactically string-proven deferred Map.set keys in a loop', async () => {
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'values', value: 'new Map()' } },
      {
        type: 'for',
        props: { from: '0', name: 'i', to: '2' },
        children: [
          { type: 'do', props: { value: 'Map.set(values, String(i) + ":" + String(i), i)' } },
          {
            type: 'if',
            props: { cond: 'Map.get(values, String(i) + ":" + String(i)) != i' },
            children: [{ type: 'throw', props: { value: 'new Error("map write mismatch")' } }],
          },
        ],
      },
    ];
    const sync = runInternalEffectMachineSync(nodes, makeEnv(), { iterationBudget: 2 });
    const asyncTrace = await runInternalEffectMachineAsync(nodes, makeEnv(), { iterationBudget: 2 });
    expect(sync).toEqual({
      completion: { kind: 'normal' },
      events: [
        { op: 'assign', target: 'values', value: new Map() },
        { binding: 'i', op: 'iter-next', value: 0 },
        { binding: 'i', op: 'iter-next', value: 1 },
      ],
    });
    expect(tracesEqual(sync, asyncTrace)).toBe(true);
  });

  test('rejects unproved deferred Map.set key shapes before an earlier capability effect', () => {
    const keys = ['"row:" + i', '`row:${i}`', 'true ? String(i) : String(i)', 'String(i) as string'];
    for (const key of keys) {
      let calls = 0;
      const env = makeEnv({ capabilities: { storage: { get: () => ++calls } } });
      expect(() =>
        runInternalEffectMachineSync(
          [
            { type: 'let', props: { name: 'values', value: 'new Map()' } },
            { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
            {
              type: 'for',
              props: { from: '0', name: 'i', to: '1' },
              children: [{ type: 'do', props: { value: `Map.set(values, ${key}, 1)` } }],
            },
          ],
          env,
          { iterationBudget: 1 },
        ),
      ).toThrow();
      expect(calls).toBe(0);
    }
  });

  test('rejects a shadowed Map namespace before an earlier capability effect', () => {
    let calls = 0;
    const env = makeEnv({
      bindings: new Map<string, unknown>([
        ['Map', 'shadow'],
        ['values', new Map()],
      ]),
      capabilities: { storage: { get: () => ++calls } },
    });
    expect(() => runInternalMachineDo({ type: 'do', props: { value: 'Map.set(values, "key", 1)' } }, env)).toThrow(
      'portable machine: namespace "Map" is shadowed',
    );
    expect(() =>
      runInternalEffectMachineSync(
        [
          { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
          {
            type: 'for',
            props: { from: '0', name: 'i', to: '1' },
            children: [{ type: 'do', props: { value: 'Map.set(values, "key", i)' } }],
          },
        ],
        env,
        { iterationBudget: 1 },
      ),
    ).toThrow();
    expect(calls).toBe(0);
  });

  test('sync and immediate async traces are byte-equivalent', async () => {
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'items', value: '[]' } },
      { type: 'do', props: { value: 'items.push(9)' } },
      { type: 'return', props: { value: 'items' } },
    ];
    const sync = runInternalEffectMachineSync(nodes, makeEnv());
    const asyncTrace = await runInternalEffectMachineAsync(nodes, makeEnv(), {});
    expect(tracesEqual(sync, asyncTrace)).toBe(true);
  });

  test.each(['items?.push(1)', 'items.push()', 'items.push(1, 2)', 'Map.set(values, "key")', 'arbitraryEffect()'])(
    'fails closed for unsupported discarded expression %s',
    (value) => {
      expect(() =>
        run([
          { type: 'let', props: { name: 'items', value: '[]' } },
          { type: 'let', props: { name: 'values', value: 'new Map()' } },
          { type: 'do', props: { value } },
        ]),
      ).toThrow();
    },
  );

  test('rejects captured-array mutation', () => {
    expect(() =>
      run([
        { type: 'let', props: { name: 'items', value: '[1]' } },
        { type: 'let', props: { name: 'record', value: '{ items: items }' } },
        { type: 'do', props: { value: 'items.push(2)' } },
      ]),
    ).toThrow();
  });

  test('whole-tree preflight rejects invalid do before an earlier capability effect', () => {
    let calls = 0;
    const env = makeEnv({ capabilities: { storage: { get: () => ++calls } } });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { input: '"key"', name: 'value', namespace: 'storage', operation: 'get' } },
      { type: 'do', props: { value: 'arbitraryEffect()' } },
    ];
    expect(() => runInternalEffectMachineSync(nodes, env)).toThrow();
    expect(calls).toBe(0);
  });
});
