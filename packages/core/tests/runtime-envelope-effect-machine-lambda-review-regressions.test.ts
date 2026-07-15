import {
  InternalEffectMachineError,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import { copyLambdaOwnedEnumerableProperties } from '../src/ir/semantics/lambda-owned-property.js';
import { assertLambdaPreflight } from '../src/ir/semantics/lambda-preflight.js';
import { evaluateLambdaEffects } from '../src/ir/semantics/lambda-runtime.js';
import { registerAllContracts } from '../src/ir/semantics/register-all.js';
import { makeEnv } from '../src/ir/semantics/semantic-env.js';

describe('M3.23 lambda review regressions', () => {
  beforeAll(() => registerAllContracts());

  test('rejects a stable local non-array before an earlier capability', () => {
    let calls = 0;
    const nodes = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      {
        type: 'lambda',
        props: { expr: 'List.map(xs, x => x)' },
        children: [{ type: 'let', props: { name: 'xs', value: '{}' } }],
      },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(() => runInternalEffectMachineSync(nodes, env, { iterationBudget: 1 })).toThrow(InternalEffectMachineError);
    expect(calls).toBe(0);
  });

  test('rejects a deterministic conditional non-array before an earlier capability', () => {
    let calls = 0;
    const nodes = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'lambda', props: { expr: 'List.map(true ? 1 : [], x => x)' } },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(() => runInternalEffectMachineSync(nodes, env, { iterationBudget: 1 })).toThrow(InternalEffectMachineError);
    expect(calls).toBe(0);
  });

  test('rejects invoking a closure before its captured setup binding exists', () => {
    let calls = 0;
    const nodes = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      {
        type: 'lambda',
        props: { expr: 'value' },
        children: [
          { type: 'let', props: { name: 'readLater', value: '() => later' } },
          { type: 'let', props: { name: 'value', value: 'readLater()' } },
          { type: 'let', props: { name: 'later', value: '2' } },
        ],
      },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(() => runInternalEffectMachineSync(nodes, env)).toThrow(InternalEffectMachineError);
    expect(calls).toBe(0);
  });

  test('keeps private closures returned by private closure factories callable', () => {
    const ir = {
      type: 'lambda',
      props: { expr: 'fn()' },
      children: [
        { type: 'let', props: { name: 'factory', value: '() => () => 7' } },
        { type: 'let', props: { name: 'fn', value: 'factory()' } },
      ],
    };

    expect(runInternalEffectMachineSync([ir], makeEnv()).events).toEqual([{ op: 'stdout', text: '7' }]);
  });

  test('treats __proto__ object entries as own data without changing the literal prototype', () => {
    const ir = {
      type: 'lambda',
      props: { expr: '[value.inherited, value.__proto__.inherited]' },
      children: [
        {
          type: 'let',
          props: { name: 'value', value: '{ __proto__: { inherited: 9 } }' },
        },
      ],
    };

    expect(runInternalEffectMachineSync([ir], makeEnv()).events).toEqual([{ op: 'stdout', text: 'undefined,9' }]);
  });

  test('formats null-prototype object literals without invoking mutable object methods', () => {
    const ir = { type: 'lambda', props: { expr: '{ answer: 42 }' } };

    expect(runInternalEffectMachineSync([ir], makeEnv()).events).toEqual([{ op: 'stdout', text: '[object Object]' }]);
  });

  test.each([
    ['true && [1]', '1'],
    ['false || [1]', '1'],
    ['null ?? [1]', '1'],
  ])('preserves the stable right-hand value for %s', (expr, text) => {
    const ir = { type: 'lambda', props: { expr: `List.map(${expr}, x => x)` } };

    expect(runInternalEffectMachineSync([ir], makeEnv(), { iterationBudget: 1 }).events).toEqual([
      { op: 'stdout', text },
    ]);
  });

  test('proves array shape across both branches of a callback conditional', () => {
    const ir = {
      type: 'lambda',
      props: { expr: 'List.map([true], condition => List.map(condition ? [1] : [2], x => x))' },
    };

    expect(runInternalEffectMachineSync([ir], makeEnv(), { iterationBudget: 2 }).events).toEqual([
      { op: 'stdout', text: '1' },
    ]);
  });

  test('accepts an array source whose elements are private closures', () => {
    const ir = { type: 'lambda', props: { expr: 'List.map([() => 1], fn => fn())' } };

    expect(runInternalEffectMachineSync([ir], makeEnv(), { iterationBudget: 1 }).events).toEqual([
      { op: 'stdout', text: '1' },
    ]);
  });

  test('keeps nested private closure factory results callable', () => {
    const ir = {
      type: 'lambda',
      props: { expr: 'factory()()' },
      children: [{ type: 'let', props: { name: 'factory', value: '() => () => 7' } }],
    };

    expect(runInternalEffectMachineSync([ir], makeEnv()).events).toEqual([{ op: 'stdout', text: '7' }]);
  });

  test('does not expose inherited array properties', () => {
    const ir = { type: 'lambda', props: { expr: '[].constructor' } };

    expect(runInternalEffectMachineSync([ir], makeEnv()).events).toEqual([{ op: 'stdout', text: 'undefined' }]);
  });

  test('does not invoke inherited getters while preflighting stable bindings', () => {
    let getterCalls = 0;
    Object.defineProperty(Object.prototype, 'lambdaReviewGetter', {
      configurable: true,
      get: () => {
        getterCalls += 1;
        return 9;
      },
    });
    try {
      const ir = { type: 'lambda', props: { expr: 'value.lambdaReviewGetter' } };
      const env = makeEnv({ bindings: new Map([['value', { safe: true }]]) });

      expect(runInternalEffectMachineSync([ir], env).events).toEqual([{ op: 'stdout', text: 'undefined' }]);
      expect(getterCalls).toBe(0);
    } finally {
      delete (Object.prototype as Record<string, unknown>).lambdaReviewGetter;
    }
  });

  test('does not invoke inherited getters on deferred capability values', () => {
    let getterCalls = 0;
    Object.defineProperty(Object.prototype, 'lambdaDeferredGetter', {
      configurable: true,
      get: () => {
        getterCalls += 1;
        return 9;
      },
    });
    try {
      const nodes = [
        { type: 'capability', props: { name: 'value', namespace: 'storage', operation: 'get' } },
        { type: 'lambda', props: { expr: 'value.lambdaDeferredGetter' } },
      ];
      const env = makeEnv({ capabilities: { storage: { get: () => ({ safe: true }) } } });

      expect(runInternalEffectMachineSync(nodes, env).events.at(-1)).toEqual({ op: 'stdout', text: 'undefined' });
      expect(getterCalls).toBe(0);
    } finally {
      delete (Object.prototype as Record<string, unknown>).lambdaDeferredGetter;
    }
  });

  test('rejects private closure member access before an earlier capability runs', () => {
    let calls = 0;
    const nodes = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      {
        type: 'lambda',
        props: { expr: 'factory().scope' },
        children: [{ type: 'let', props: { name: 'factory', value: '() => () => 7' } }],
      },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(() => runInternalEffectMachineSync(nodes, env)).toThrow(InternalEffectMachineError);
    expect(calls).toBe(0);
  });

  test('keeps conditional private closure assignments callable', () => {
    const ir = {
      type: 'lambda',
      props: { expr: 'fn()' },
      children: [{ type: 'let', props: { name: 'fn', value: 'true ? () => 1 : () => 2' } }],
    };

    expect(runInternalEffectMachineSync([ir], makeEnv()).events).toEqual([{ op: 'stdout', text: '1' }]);
  });

  test('keeps conditionally produced callback closures callable', () => {
    const ir = {
      type: 'lambda',
      props: { expr: 'List.map(List.map([1, 2], x => x > 0 ? () => x : () => 0), fn => fn())' },
    };

    expect(runInternalEffectMachineSync([ir], makeEnv(), { iterationBudget: 4 }).events).toEqual([
      { op: 'stdout', text: '1,2' },
    ]);
  });

  test('does not invoke object coercion hooks while formatting deferred values', () => {
    let coercionCalls = 0;
    let lastEvent: unknown;
    const originalToString = Object.prototype.toString;
    try {
      const nodes = [
        { type: 'capability', props: { name: 'value', namespace: 'poisoner', operation: 'infect' } },
        { type: 'lambda', props: { expr: 'value' } },
      ];
      const env = makeEnv({
        capabilities: {
          poisoner: {
            infect: () => {
              Object.prototype.toString = () => {
                coercionCalls += 1;
                return 'unsafe';
              };
              return { safe: true };
            },
          },
        },
      });

      lastEvent = runInternalEffectMachineSync(nodes, env).events.at(-1);
    } finally {
      Object.prototype.toString = originalToString;
    }
    expect(lastEvent).toEqual({ op: 'stdout', text: '[object Object]' });
    expect(coercionCalls).toBe(0);
  });

  test('does not invoke object coercion hooks in deferred arithmetic', () => {
    let coercionCalls = 0;
    const nodes = [
      { type: 'capability', props: { namespace: 'poisoner', operation: 'infect' } },
      { type: 'lambda', props: { expr: 'value + 1' } },
    ];
    const originalValueOf = Object.prototype.valueOf;
    let thrown: unknown;
    try {
      const env = makeEnv({
        bindings: new Map([['value', { safe: true }]]),
        capabilities: {
          poisoner: {
            infect: () => {
              Object.prototype.valueOf = () => {
                coercionCalls += 1;
                return 7;
              };
              return 1;
            },
          },
        },
      });
      runInternalEffectMachineSync(nodes, env);
    } catch (error) {
      thrown = error;
    } finally {
      Object.prototype.valueOf = originalValueOf;
    }
    expect(thrown).toBeInstanceOf(InternalEffectMachineError);
    expect(String((thrown as Error & { cause?: unknown }).cause)).toBe(
      'Error: lambda: binary operator "+" does not accept non-primitive operands',
    );
    expect(coercionCalls).toBe(0);
  });

  test('uses captured identifier validation after an earlier capability', () => {
    const originalTest = RegExp.prototype.test;
    try {
      const nodes = [
        { type: 'capability', props: { namespace: 'poisoner', operation: 'infect' } },
        {
          type: 'lambda',
          props: { expr: 'value' },
          children: [{ type: 'assign', props: { target: 'value', value: '7' } }],
        },
      ];
      const env = makeEnv({
        capabilities: {
          poisoner: {
            infect: () => {
              RegExp.prototype.test = () => {
                throw new Error('POISONED');
              };
            },
          },
        },
      });

      expect(runInternalEffectMachineSync(nodes, env).events.at(-1)).toEqual({ op: 'stdout', text: '7' });
    } finally {
      RegExp.prototype.test = originalTest;
    }
  });

  test('preflight rejects accessor-backed object spread without invoking the accessor', () => {
    let getterCalls = 0;
    const source = {};
    Object.defineProperty(source, 'value', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 7;
      },
    });
    const env = makeEnv();
    env.bindings.set('source', source);
    const ir = { type: 'lambda', props: { expr: 'List.map({ ...source }, x => x)' } };

    expect(() => assertLambdaPreflight(ir, env, new Set(), true)).toThrow(
      'lambda: accessor properties are not executable',
    );
    expect(getterCalls).toBe(0);
  });

  test('runtime rejects accessor-backed object spread without invoking the accessor', () => {
    let getterCalls = 0;
    const source = {};
    Object.defineProperty(source, 'value', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 7;
      },
    });
    const env = makeEnv();
    env.bindings.set('source', source);
    const ir = { type: 'lambda', props: { expr: '{ ...source }' } };

    expect(() => evaluateLambdaEffects(ir, env)).toThrow('lambda: accessor properties are not executable');
    expect(getterCalls).toBe(0);
  });

  test('preserves primitive object-spread behavior without host boxing', () => {
    const ir = {
      type: 'lambda',
      props: { expr: '[value[0], value[1], empty.answer]' },
      children: [
        { type: 'let', props: { name: 'value', value: "{ ...'ab' }" } },
        { type: 'let', props: { name: 'empty', value: '{ ...7, answer: 9 }' } },
      ],
    };

    expect(runInternalEffectMachineSync([ir], makeEnv()).events).toEqual([{ op: 'stdout', text: 'a,b,9' }]);
  });

  test('rejects cyclic trace arrays with a bounded lambda error', () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    const env = makeEnv();
    env.bindings.set('cycle', cycle);
    const ir = { type: 'lambda', props: { expr: 'cycle' } };

    expect(() => evaluateLambdaEffects(ir, env)).toThrow('lambda: cyclic trace values are not executable');
  });

  test('keeps null distinct from undefined in lambda expressions', () => {
    const ir = {
      type: 'lambda',
      props: { expr: '[null, undefined, null === undefined, typeof null, null ?? 7, undefined ?? 8]' },
    };

    expect(runInternalEffectMachineSync([ir], makeEnv()).events).toEqual([
      { op: 'stdout', text: 'null,undefined,false,object,7,8' },
    ]);
  });

  test('preflight reasons about null without collapsing it to undefined', () => {
    const ir = { type: 'lambda', props: { expr: 'List.map(null === undefined ? 1 : [1], x => x)' } };

    expect(() => assertLambdaPreflight(ir, makeEnv(), new Set(), true)).not.toThrow();
  });

  test('object spread ignores non-enumerable symbol properties', () => {
    const target = Object.create(null) as Record<string, unknown>;
    const source = { value: 7 };
    Object.defineProperty(source, Symbol('hidden'), { enumerable: false, value: 9 });

    expect(() => copyLambdaOwnedEnumerableProperties(target, source)).not.toThrow();
    expect(target).toEqual({ value: 7 });
  });

  test('callback parameters shadow same-named stable environment bindings during preflight', () => {
    const env = makeEnv({ bindings: new Map([['xs', 1]]) });
    const ir = { type: 'lambda', props: { expr: 'List.map([[1]], xs => List.map(xs, x => x))' } };

    expect(runInternalEffectMachineSync([ir], env, { iterationBudget: 2 }).events).toEqual([
      { op: 'stdout', text: '1' },
    ]);
  });

  test('callback element shape overrides same-named stable environment bindings during preflight', () => {
    const env = makeEnv({ bindings: new Map([['xs', [9]]]) });
    const ir = { type: 'lambda', props: { expr: 'List.map([1], xs => List.map(xs, x => x))' } };

    expect(() => assertLambdaPreflight(ir, env, new Set(), true)).toThrow(
      'lambda preflight: List.map source must be an array',
    );
  });

  test('recognizes named closure factories as producing callable closure lists', () => {
    const ir = {
      type: 'lambda',
      props: { expr: 'List.map(List.map([1, 2], make), fn => fn())' },
      children: [{ type: 'let', props: { name: 'make', value: 'x => () => x' } }],
    };

    expect(runInternalEffectMachineSync([ir], makeEnv(), { iterationBudget: 4 }).events).toEqual([
      { op: 'stdout', text: '1,2' },
    ]);
  });

  test('propagates deferred collection facts through nested callback parameters', () => {
    let calls = 0;
    const nodes = [
      { type: 'capability', props: { name: 'rows', namespace: 'storage', operation: 'get' } },
      { type: 'lambda', props: { expr: 'List.map(rows, row => List.map(row, value => value))' } },
    ];
    const env = makeEnv({
      capabilities: {
        storage: {
          get: () => {
            calls += 1;
            return [[1]];
          },
        },
      },
    });

    expect(runInternalEffectMachineSync(nodes, env, { iterationBudget: 2 }).events.at(-1)).toEqual({
      op: 'stdout',
      text: '1',
    });
    expect(calls).toBe(1);
  });

  test.each([
    'List',
    'null.value',
    'undefined[0]',
  ])('rejects deterministic runtime failure %s before an earlier capability', (expr) => {
    let calls = 0;
    const nodes = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'lambda', props: { expr } },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(() => runInternalEffectMachineSync(nodes, env)).toThrow(InternalEffectMachineError);
    expect(calls).toBe(0);
  });

  test('rejects recursive setup closures before an earlier capability', () => {
    let calls = 0;
    const nodes = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      {
        type: 'lambda',
        props: { expr: 'recurse()' },
        children: [{ type: 'let', props: { name: 'recurse', value: '() => recurse()' } }],
      },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(() => runInternalEffectMachineSync(nodes, env)).toThrow(InternalEffectMachineError);
    expect(calls).toBe(0);
  });
});
