import {
  runInternalEffectMachineAsync,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import { childEnv, makeEnv } from '../src/ir/semantics/semantic-env.js';
import { tracesEqual } from '../src/ir/semantics/trace.js';
import type { IRNode } from '../src/types.js';

function expression(name: string, expr: unknown): IRNode {
  return { type: 'expression-v1', props: { name, expr } };
}

function run(nodes: readonly IRNode[]) {
  return runInternalEffectMachineSync(nodes, makeEnv());
}

describe('M3.21 effect-machine expression-v1 ownership', () => {
  test('reads owned record and map composites through an authentic parent chain', () => {
    const root = makeEnv({
      bindings: new Map<string, unknown>([
        ['profile', { name: 'Ada' }],
        ['values', new Map([['answer', 42]])],
      ]),
    });
    const trace = runInternalEffectMachineSync(
      [expression('name', 'profile.name'), expression('answer', 'Map.get(values, "answer")')],
      childEnv(root),
    );

    expect(trace.events).toEqual([
      { op: 'assign', target: 'name', value: 'Ada' },
      { op: 'assign', target: 'answer', value: 42 },
    ]);
  });

  test.each([
    ['scalar', '1 + 2', 3],
    ['array', '[1,2]', [1, 2]],
    ['record', '{value: 3}', { value: 3 }],
    ['Decimal value', 'Decimal.add(Decimal.of("0.1"), Decimal.of("0.2"))', '0.3'],
    ['regex test', '/a/.test("cat")', true],
    ['regex global list', '"aba".match(/a/g)', ['a', 'a']],
  ])('executes the existing %s contract with one canonical assign event', (_label, expr, value) => {
    expect(run([expression('result', expr)])).toEqual({
      completion: { kind: 'normal' },
      events: [{ op: 'assign', target: 'result', value }],
    });
  });

  test('preserves ExprObject props and array alias metadata', () => {
    const trace = run([
      expression('xs', { __expr: true, code: '[7,8,9]' }),
      expression('ys', { __expr: true, code: 'xs' }),
      { type: 'return', props: { value: 'ys' } },
    ]);
    expect(trace.completion).toEqual({ kind: 'return', value: [7, 8, 9] });
    expect(trace.events).toEqual([
      { op: 'assign', target: 'xs', value: [7, 8, 9] },
      { op: 'assign', target: 'ys', value: [7, 8, 9] },
    ]);
  });

  test('preserves captured record-array field metadata', () => {
    const trace = run([
      expression('record', '{children: [4,5]}'),
      expression('children', 'record.children'),
      { type: 'return', props: { value: 'children' } },
    ]);
    expect(trace.completion).toEqual({ kind: 'return', value: [4, 5] });
  });

  test('executes deferred loop expressions after whole-tree preflight', () => {
    const trace = runInternalEffectMachineSync(
      [
        { type: 'let', props: { name: 'sum', value: '0' } },
        {
          type: 'for',
          props: { from: '0', name: 'i', to: '2' },
          children: [
            expression('next', 'i + 1'),
            { type: 'assign', props: { op: '+=', target: 'sum', value: 'next' } },
          ],
        },
        { type: 'return', props: { value: 'sum' } },
      ],
      makeEnv(),
      { iterationBudget: 2 },
    );
    expect(trace.completion).toEqual({ kind: 'return', value: 3 });
  });

  test.each([
    expression('missing', undefined),
    expression('bad', 'arbitraryEffect()'),
    { ...expression('body', '1'), children: [{ type: 'print', props: { value: '1' } }] },
  ])('fails closed for malformed or unsupported shape %#', (node) => {
    expect(() => run([node])).toThrow();
  });

  test('rejects redeclaration and shadowed native namespaces', () => {
    expect(() =>
      runInternalEffectMachineSync([expression('value', '1')], makeEnv({ bindings: new Map([['value', 0]]) })),
    ).toThrow();
    expect(() =>
      runInternalEffectMachineSync(
        [expression('value', 'Decimal.of("1")')],
        makeEnv({ bindings: new Map([['Decimal', 'shadow']]) }),
      ),
    ).toThrow();
    expect(() =>
      runInternalEffectMachineSync(
        [expression('value', '/a/.test("a")')],
        makeEnv({ bindings: new Map([['RegExp', 'shadow']]) }),
      ),
    ).toThrow();
  });

  test('rejects a later unsupported expression before an earlier provider effect', () => {
    let calls = 0;
    const env = makeEnv({ capabilities: { storage: { get: () => ++calls } } });
    expect(() =>
      runInternalEffectMachineSync(
        [
          { type: 'capability', props: { input: '"key"', namespace: 'storage', operation: 'get' } },
          expression('value', 'arbitraryEffect()'),
        ],
        env,
      ),
    ).toThrow();
    expect(calls).toBe(0);
  });

  test('sync and immediate-async paths share the same machine trace', async () => {
    const nodes = [expression('value', '"aba".replace(/a/g, "x")')] as const;
    const sync = runInternalEffectMachineSync(nodes, makeEnv());
    const asyncTrace = await runInternalEffectMachineAsync(nodes, makeEnv());
    expect(tracesEqual(sync, asyncTrace)).toBe(true);
    expect(sync.events).toEqual([{ op: 'assign', target: 'value', value: 'xbx' }]);
  });
});
