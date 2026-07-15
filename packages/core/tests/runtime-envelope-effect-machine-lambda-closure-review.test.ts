import {
  InternalEffectMachineError,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import { assertLambdaPreflight } from '../src/ir/semantics/lambda-preflight.js';
import { registerAllContracts } from '../src/ir/semantics/register-all.js';
import { makeEnv } from '../src/ir/semantics/semantic-env.js';

describe('M3.23 lambda closure review regressions', () => {
  beforeAll(() => registerAllContracts());

  test('rejects recursion retained through a reassigned closure alias before effects', () => {
    let calls = 0;
    const nodes = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      {
        type: 'lambda',
        props: { expr: 'recurse()' },
        children: [
          { type: 'let', props: { name: 'alias', value: '() => recurse()' } },
          { type: 'let', props: { name: 'recurse', value: '() => 1' } },
          { type: 'assign', props: { target: 'recurse', value: 'alias' } },
          { type: 'assign', props: { target: 'alias', value: '() => 1' } },
        ],
      },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(() => runInternalEffectMachineSync(nodes, env)).toThrow(InternalEffectMachineError);
    expect(calls).toBe(0);
  });

  test('does not reject a non-recursive unused setup closure', () => {
    const ir = {
      type: 'lambda',
      props: { expr: '1' },
      children: [{ type: 'let', props: { name: 'unused', value: '() => 2' } }],
    };

    expect(runInternalEffectMachineSync([ir], makeEnv()).events).toEqual([{ op: 'stdout', text: '1' }]);
  });

  test('does not mistake a shared closure dependency for recursion', () => {
    const ir = {
      type: 'lambda',
      props: { expr: 'left() + right()' },
      children: [
        { type: 'let', props: { name: 'shared', value: '() => 1' } },
        { type: 'let', props: { name: 'left', value: '() => shared()' } },
        { type: 'let', props: { name: 'right', value: '() => shared()' } },
      ],
    };

    expect(runInternalEffectMachineSync([ir], makeEnv()).events).toEqual([{ op: 'stdout', text: '2' }]);
  });

  test('does not invoke object coercion hooks in deferred unary arithmetic', () => {
    let coercionCalls = 0;
    const nodes = [
      { type: 'capability', props: { namespace: 'poisoner', operation: 'infect' } },
      { type: 'lambda', props: { expr: '-value' } },
    ];
    const originalValueOf = Object.prototype.valueOf;
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

      expect(() => runInternalEffectMachineSync(nodes, env)).toThrow(InternalEffectMachineError);
    } finally {
      Object.prototype.valueOf = originalValueOf;
    }
    expect(coercionCalls).toBe(0);
  });

  test('does not invoke object coercion hooks while preflighting stable arithmetic', () => {
    let coercionCalls = 0;
    const env = makeEnv();
    env.bindings.set('value', {
      valueOf: () => {
        coercionCalls += 1;
        return 7;
      },
    });
    const ir = {
      type: 'lambda',
      props: { expr: 'result' },
      children: [{ type: 'let', props: { name: 'result', value: 'value + 1' } }],
    };

    expect(() => assertLambdaPreflight(ir, env, new Set(), true)).toThrow(
      'lambda: binary operator "+" does not accept non-primitive operands',
    );
    expect(coercionCalls).toBe(0);
  });
});
