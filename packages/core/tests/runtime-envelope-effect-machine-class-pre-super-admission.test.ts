import { SOURCE_RUNNER_ENGINE, selectSourceRunnerEngine } from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';
import { classMember, preSuperEnv } from './runtime-envelope-effect-machine-class-pre-super-fixtures.js';

function admissionNodes(): readonly IRNode[] {
  return [
    { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
    { type: 'let', props: { name: 'item', value: 'new Derived(1)' } },
    { type: 'return', props: { value: 'item.value' } },
  ];
}

function admissionEnv(preSuper: readonly IRNode[], superArgument = 'value') {
  let providerCalls = 0;
  const env = preSuperEnv(
    [
      {
        constructor: classMember(
          'Base',
          'constructor',
          ['value'],
          [{ type: 'assign', props: { target: 'this.value', value: 'value' } }],
        ),
        fields: [{ name: 'value', value: '0' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Base',
      },
      {
        constructor: classMember(
          'Derived',
          'constructor',
          ['value'],
          [...preSuper, { type: 'do', props: { value: `super(${superArgument})` } }],
        ),
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map(),
        name: 'Derived',
      },
    ],
    { storage: { get: () => ++providerCalls } },
  );
  return { env, providerCalls: () => providerCalls };
}

describe('M3.31b2c1 pre-super fail-closed admission', () => {
  test.each([
    ['this field read', [{ type: 'let', props: { name: 'local', value: 'this.value' } }]],
    ['this field assignment', [{ type: 'assign', props: { target: 'this.value', value: '1' } }]],
    ['this method call', [{ type: 'do', props: { value: 'this.read()' } }]],
    ['super member call', [{ type: 'do', props: { value: 'super.read()' } }]],
    ['bare this transport', [{ type: 'let', props: { name: 'local', value: 'this' } }]],
    ['early return', [{ type: 'return', props: { value: '1' } }]],
    ['early throw', [{ type: 'throw', props: { value: '"stop"' } }]],
  ] as const)('rejects pre-super %s before an earlier provider dispatch', (_label, preSuper) => {
    const scenario = admissionEnv(preSuper);

    expect(selectSourceRunnerEngine(admissionNodes(), scenario.env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(scenario.providerCalls()).toBe(0);
  });

  test.each([
    ['helper call', 'load(value)'],
    ['class allocation', 'new Base(value)'],
    ['this field', 'this.value'],
    ['super member', 'super.value'],
    ['missing local', 'missing'],
  ] as const)('rejects a %s in super arguments before an earlier provider dispatch', (_label, argument) => {
    const scenario = admissionEnv([], argument);

    expect(selectSourceRunnerEngine(admissionNodes(), scenario.env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(scenario.providerCalls()).toBe(0);
  });

  test('rejects a conditionally established pre-super local', () => {
    const scenario = admissionEnv(
      [
        {
          type: 'if',
          props: { cond: 'value > 0' },
          children: [{ type: 'let', props: { name: 'local', value: 'value + 1' } }],
        },
      ],
      'local',
    );

    expect(selectSourceRunnerEngine(admissionNodes(), scenario.env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(scenario.providerCalls()).toBe(0);
  });

  test('keeps helper-reached pre-super effects unsupported', () => {
    const scenario = admissionEnv(
      [{ type: 'capability', props: { name: 'local', namespace: 'storage', operation: 'get' } }],
      'local',
    );
    const functions = scenario.env.runnerFunctions;
    if (!functions) throw new Error('expected function registry');
    functions.set('build', {
      body: [
        { type: 'let', props: { name: 'item', value: 'new Derived(1)' } },
        { type: 'return', props: { value: 'item.value' } },
      ],
      name: 'build',
      params: [],
      module: scenario.env.runnerClasses?.get('Derived')?.module,
    });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'return', props: { value: 'build()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, scenario.env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(scenario.providerCalls()).toBe(0);
  });
});
