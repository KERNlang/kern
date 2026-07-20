import { markRunnerMachineClassBinding, markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import {
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassMemberBinding,
  type RunnerModuleScope,
  type SemanticEnv,
} from '../src/ir/semantics/semantic-env.js';
import {
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';

function classConstructor(
  ownerClass: string,
  params: readonly string[],
  body: readonly IRNode[],
): RunnerClassMemberBinding {
  return { body, name: 'constructor', ownerClass, params };
}

function admissionEnv(
  baseConstructor: RunnerClassMemberBinding | undefined,
  derivedConstructor: RunnerClassMemberBinding | undefined,
  middle = false,
): SemanticEnv {
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const scope: RunnerModuleScope = { classes, functions };
  const bindings: RunnerClassBinding[] = [
    {
      constructor: baseConstructor,
      fields: [{ name: 'value' }],
      getters: new Map(),
      methods: new Map(),
      module: scope,
      name: 'Base',
    },
    ...(middle
      ? [
          {
            constructor: undefined,
            extendsName: 'Base',
            fields: [],
            getters: new Map(),
            methods: new Map(),
            module: scope,
            name: 'Middle',
          } satisfies RunnerClassBinding,
        ]
      : []),
    {
      constructor: derivedConstructor,
      extendsName: middle ? 'Middle' : 'Base',
      fields: [],
      getters: new Map(),
      methods: new Map(),
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

const nodes: readonly IRNode[] = [
  { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
  { type: 'let', props: { name: 'item', value: 'new Derived(1)' } },
  { type: 'return', props: { value: 'item.value' } },
];

describe('M3.31b1 constructor-super fail-closed admission', () => {
  test.each([
    [
      'non-leading explicit super',
      classConstructor('Base', ['value'], []),
      classConstructor(
        'Derived',
        ['value'],
        [
          { type: 'assign', props: { target: 'this.value', value: 'value' } },
          { type: 'do', props: { value: 'super(value)' } },
        ],
      ),
      false,
    ],
    [
      'duplicate explicit super',
      classConstructor('Base', ['value'], []),
      classConstructor(
        'Derived',
        ['value'],
        [
          { type: 'do', props: { value: 'super(value)' } },
          { type: 'do', props: { value: 'super(value)' } },
        ],
      ),
      false,
    ],
    [
      'conditional explicit super',
      classConstructor('Base', ['value'], []),
      classConstructor(
        'Derived',
        ['value'],
        [{ type: 'if', props: { cond: 'true' }, children: [{ type: 'do', props: { value: 'super(value)' } }] }],
      ),
      false,
    ],
    [
      'call-bearing super argument',
      classConstructor('Base', ['value'], []),
      classConstructor('Derived', ['value'], [{ type: 'do', props: { value: 'super(load())' } }]),
      false,
    ],
    [
      'unknown super argument binding',
      classConstructor('Base', ['value'], []),
      classConstructor('Derived', ['value'], [{ type: 'do', props: { value: 'super(other)' } }]),
      false,
    ],
    [
      'implicit required base argument',
      classConstructor('Base', ['value'], []),
      classConstructor('Derived', ['value'], []),
      false,
    ],
    [
      'wrong explicit base arity',
      classConstructor('Base', ['value'], []),
      classConstructor('Derived', ['value'], [{ type: 'do', props: { value: 'super()' } }]),
      false,
    ],
    [
      'arguments crossing a constructor-less middle layer',
      classConstructor('Base', ['value'], []),
      classConstructor('Derived', ['value'], [{ type: 'do', props: { value: 'super(value)' } }]),
      true,
    ],
    [
      'super member use after constructor super',
      classConstructor('Base', ['value'], []),
      classConstructor(
        'Derived',
        ['value'],
        [
          { type: 'do', props: { value: 'super(value)' } },
          { type: 'do', props: { value: 'super.read()' } },
        ],
      ),
      false,
    ],
    [
      'lambda-contained super',
      classConstructor('Base', [], []),
      classConstructor('Derived', ['value'], [{ type: 'do', props: { value: '(() => super())' } }]),
      false,
    ],
    [
      'bare super identifier',
      classConstructor('Base', [], []),
      classConstructor('Derived', ['value'], [{ type: 'do', props: { value: 'super' } }]),
      false,
    ],
  ] as const)('routes %s to compatibility before provider dispatch', (_label, base, derived, middle) => {
    const env = admissionEnv(base, derived, middle);

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });

  test('keeps a derived uninitialized field override uninitialized after a base constructor assignment', () => {
    const env = admissionEnv(
      classConstructor('Base', [], [{ type: 'assign', props: { target: 'this.value', value: '7' } }]),
      classConstructor('Derived', [], [{ type: 'do', props: { value: 'super()' } }]),
    );
    const derived = env.runnerClasses?.get('Derived');
    if (!derived) throw new Error('expected derived class');
    derived.fields = [{ name: 'value' }];
    const construction: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.value' } },
    ];

    expect(selectSourceRunnerEngine(construction, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });

  test('accepts pure scalar super arguments from constructor parameters', () => {
    const env = admissionEnv(
      classConstructor('Base', ['value'], [{ type: 'assign', props: { target: 'this.value', value: 'value' } }]),
      classConstructor('Derived', ['value'], [{ type: 'do', props: { value: 'super((value + 2) * 3)' } }]),
    );
    const construction: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived(2)' } },
      { type: 'return', props: { value: 'item.value' } },
    ];

    expect(selectSourceRunnerEngine(construction, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(construction, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 12,
    });
  });

  test('keeps constructor-dependent outer controls deferred during preflight', () => {
    const env = admissionEnv(
      classConstructor('Base', [], [{ type: 'assign', props: { target: 'this.value', value: '7' } }]),
      classConstructor('Derived', [], [{ type: 'do', props: { value: 'super()' } }]),
    );
    const construction: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'let', props: { name: 'actual', value: 'item.value' } },
      {
        type: 'if',
        props: { cond: 'actual === 7' },
        children: [{ type: 'let', props: { name: 'thenOnly', value: '0' } }],
      },
      {
        type: 'else',
        children: [{ type: 'let', props: { name: 'fallback', value: '1' } }],
      },
      { type: 'return', props: { value: 'fallback' } },
    ];

    expect(selectSourceRunnerEngine(construction, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });
});
