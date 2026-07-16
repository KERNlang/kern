import { markRunnerMachineClassBinding, markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import {
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassMemberBinding,
  type RunnerModuleScope,
  type SemanticEnv,
} from '../src/ir/semantics/semantic-env.js';
import { SOURCE_RUNNER_ENGINE, selectSourceRunnerEngine } from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';

function method(ownerClass: string, name: string, params: readonly string[], value: string): RunnerClassMemberBinding {
  return { body: [{ type: 'return', props: { value } }], name, ownerClass, params };
}

function methodBody(
  ownerClass: string,
  name: string,
  params: readonly string[],
  body: readonly IRNode[],
): RunnerClassMemberBinding {
  return { body, name, ownerClass, params };
}

interface AdmissionOptions {
  readonly baseGetters?: RunnerClassBinding['getters'];
  readonly baseMethods: RunnerClassBinding['methods'];
  readonly derivedMethods?: RunnerClassBinding['methods'];
  readonly helper?: boolean;
}

function admissionEnv(options: AdmissionOptions): SemanticEnv {
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const scope: RunnerModuleScope = { classes, functions };
  if (options.helper) {
    functions.set('helper', {
      body: [{ type: 'return', props: { value: '1' } }],
      module: scope,
      name: 'helper',
      params: [],
      returns: 'number',
    });
  }
  const bindings: RunnerClassBinding[] = [
    {
      constructor: undefined,
      fields: [],
      getters: options.baseGetters ?? new Map(),
      methods: options.baseMethods,
      module: scope,
      name: 'Base',
    },
    {
      constructor: undefined,
      extendsName: 'Base',
      fields: [],
      getters: new Map(),
      methods: options.derivedMethods ?? new Map(),
      module: scope,
      name: 'Derived',
    },
  ];
  for (const binding of bindings) {
    markRunnerMachineClassBinding(binding);
    classes.set(binding.name, binding);
  }
  markRunnerMachineRootScope(scope);
  return makeEnv({
    capabilities: { storage: { get: () => 1 } },
    runnerCallCache: new Map(),
    runnerCallStack: [],
    runnerClasses: classes,
    runnerFunctions: functions,
  });
}

function program(): readonly IRNode[] {
  return [
    { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
    { type: 'let', props: { name: 'item', value: 'new Derived()' } },
    { type: 'return', props: { value: 'item.render()' } },
  ];
}

describe('M3.31b2b1 virtual this-method fail-closed admission', () => {
  test.each([
    ['missing virtual method', { baseMethods: new Map([['render', method('Base', 'render', [], 'this.missing()')]]) }],
    [
      'derived-only virtual target',
      {
        baseMethods: new Map([['render', method('Base', 'render', [], 'this.step()')]]),
        derivedMethods: new Map([['step', method('Derived', 'step', [], '1')]]),
      },
    ],
    [
      'wrong virtual method arity',
      {
        baseMethods: new Map([
          ['render', method('Base', 'render', [], 'this.step()')],
          ['step', method('Base', 'step', ['input'], 'input')],
        ]),
      },
    ],
    [
      'optional virtual call',
      {
        baseMethods: new Map([
          ['render', method('Base', 'render', [], 'this?.step()')],
          ['step', method('Base', 'step', [], '1')],
        ]),
      },
    ],
    [
      'getter invoked as a method',
      {
        baseGetters: new Map([['step', method('Base', 'step', [], '1')]]),
        baseMethods: new Map([['render', method('Base', 'render', [], 'this.step()')]]),
      },
    ],
    [
      'helper-bearing virtual argument',
      {
        baseMethods: new Map([
          ['render', method('Base', 'render', [], 'this.step(helper())')],
          ['step', method('Base', 'step', ['input'], 'input')],
        ]),
        helper: true,
      },
    ],
    [
      'helper-bearing derived override',
      {
        baseMethods: new Map([
          ['render', method('Base', 'render', [], 'this.step()')],
          ['step', method('Base', 'step', [], '1')],
        ]),
        derivedMethods: new Map([['step', method('Derived', 'step', [], 'helper()')]]),
        helper: true,
      },
    ],
    [
      'virtual call in collection-do slot',
      {
        baseMethods: new Map([
          [
            'render',
            methodBody(
              'Base',
              'render',
              [],
              [
                { type: 'do', props: { value: 'this.step()' } },
                { type: 'return', props: { value: '1' } },
              ],
            ),
          ],
          ['step', method('Base', 'step', [], '1')],
        ]),
      },
    ],
    [
      'virtual call in control slot',
      {
        baseMethods: new Map([
          [
            'render',
            methodBody(
              'Base',
              'render',
              [],
              [
                { type: 'if', props: { cond: 'this.ready()' }, children: [] },
                { type: 'return', props: { value: '1' } },
              ],
            ),
          ],
          ['ready', method('Base', 'ready', [], 'true')],
        ]),
      },
    ],
    [
      'virtual call in capability input slot',
      {
        baseMethods: new Map([
          [
            'render',
            methodBody(
              'Base',
              'render',
              [],
              [
                { type: 'capability', props: { input: 'this.payload()', namespace: 'storage', operation: 'get' } },
                { type: 'return', props: { value: '1' } },
              ],
            ),
          ],
          ['payload', method('Base', 'payload', [], '1')],
        ]),
      },
    ],
  ] as const)('routes %s to compatibility before provider dispatch', (_label, options) => {
    expect(selectSourceRunnerEngine(program(), admissionEnv(options), {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });

  test('rejects a forged entry runnerThis before provider dispatch', () => {
    const env = admissionEnv({
      baseMethods: new Map([
        ['render', method('Base', 'render', [], 'this.step()')],
        ['step', method('Base', 'step', [], '1')],
      ]),
    });
    env.runnerThis = {
      __kernRunnerClassInstance: true,
      className: 'Derived',
      fields: Object.create(null) as Record<string, unknown>,
    };

    expect(selectSourceRunnerEngine(program(), env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });
});
