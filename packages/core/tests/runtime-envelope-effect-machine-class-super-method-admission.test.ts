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
  readonly baseMethods?: RunnerClassBinding['methods'];
  readonly derivedMethods?: RunnerClassBinding['methods'];
  readonly helper?: boolean;
  readonly unknownBase?: boolean;
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
      methods: options.baseMethods ?? new Map(),
      module: scope,
      name: 'Base',
    },
    {
      constructor: undefined,
      extendsName: options.unknownBase ? 'Missing' : 'Base',
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

function program(methodName = 'read', args = ''): readonly IRNode[] {
  return [
    { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
    { type: 'let', props: { name: 'item', value: 'new Derived()' } },
    { type: 'return', props: { value: `item.${methodName}(${args})` } },
  ];
}

describe('M3.31b2a super-method fail-closed admission', () => {
  test.each([
    [
      'missing base method',
      {
        derivedMethods: new Map([['read', method('Derived', 'read', [], 'super.missing()')]]),
      },
      'read',
      '',
    ],
    [
      'wrong base method arity',
      {
        baseMethods: new Map([['read', method('Base', 'read', ['input'], 'input')]]),
        derivedMethods: new Map([['read', method('Derived', 'read', ['input'], 'super.read()')]]),
      },
      'read',
      '1',
    ],
    [
      'optional super call',
      {
        baseMethods: new Map([['read', method('Base', 'read', [], '1')]]),
        derivedMethods: new Map([['read', method('Derived', 'read', [], 'super?.read()')]]),
      },
      'read',
      '',
    ],
    [
      'super getter property read',
      {
        baseGetters: new Map([['label', method('Base', 'label', [], "'base'")]]),
        derivedMethods: new Map([['read', method('Derived', 'read', [], 'super.label')]]),
      },
      'read',
      '',
    ],
    [
      'unsupported super argument',
      {
        baseMethods: new Map([['read', method('Base', 'read', ['input'], 'input')]]),
        derivedMethods: new Map([['read', method('Derived', 'read', ['input'], 'super.read(load())')]]),
      },
      'read',
      '1',
    ],
    [
      'helper-bearing base target',
      {
        baseMethods: new Map([['read', method('Base', 'read', [], 'helper()')]]),
        derivedMethods: new Map([['read', method('Derived', 'read', [], 'super.read()')]]),
        helper: true,
      },
      'read',
      '',
    ],
    [
      'super call in a collection-do slot',
      {
        baseMethods: new Map([['base', method('Base', 'base', [], '1')]]),
        derivedMethods: new Map([
          [
            'read',
            methodBody(
              'Derived',
              'read',
              [],
              [
                { type: 'do', props: { value: 'super.base()' } },
                { type: 'return', props: { value: '1' } },
              ],
            ),
          ],
        ]),
      },
      'read',
      '',
    ],
    [
      'super call in a control slot',
      {
        baseMethods: new Map([['ready', method('Base', 'ready', [], 'true')]]),
        derivedMethods: new Map([
          [
            'read',
            methodBody(
              'Derived',
              'read',
              [],
              [
                { type: 'if', props: { cond: 'super.ready()' }, children: [] },
                { type: 'return', props: { value: '1' } },
              ],
            ),
          ],
        ]),
      },
      'read',
      '',
    ],
    [
      'super call in a capability input slot',
      {
        baseMethods: new Map([['payload', method('Base', 'payload', [], '1')]]),
        derivedMethods: new Map([
          [
            'read',
            methodBody(
              'Derived',
              'read',
              [],
              [
                { type: 'capability', props: { input: 'super.payload()', namespace: 'storage', operation: 'get' } },
                { type: 'return', props: { value: '1' } },
              ],
            ),
          ],
        ]),
      },
      'read',
      '',
    ],
    [
      'unknown base class',
      {
        derivedMethods: new Map([['read', method('Derived', 'read', [], 'super.read()')]]),
        unknownBase: true,
      },
      'read',
      '',
    ],
  ] as const)('routes %s to compatibility before provider dispatch', (_label, options, name, args) => {
    expect(selectSourceRunnerEngine(program(name, args), admissionEnv(options), {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });

  test('rejects a forged entry runnerSuperClass before provider dispatch', () => {
    const env = admissionEnv({
      baseMethods: new Map([['read', method('Base', 'read', [], '1')]]),
      derivedMethods: new Map([['read', method('Derived', 'read', [], 'super.read()')]]),
    });
    env.runnerSuperClass = 'Base';

    expect(selectSourceRunnerEngine(program(), env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });
});
