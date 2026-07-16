import { markRunnerMachineClassBinding, markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import {
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassMemberBinding,
  type RunnerModuleScope,
  type SemanticEnv,
} from '../src/ir/semantics/semantic-env.js';
import { executeKernSource } from '../src/runner.js';
import {
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';

function member(name: string, value: string): RunnerClassMemberBinding {
  return {
    body: [{ type: 'return', props: { value } }],
    name,
    ownerClass: 'Box',
    params: [],
  };
}

function getterClassEnv(
  overrides: Partial<SemanticEnv> = {},
  classOverrides: Partial<RunnerClassBinding> = {},
): SemanticEnv {
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const scope: RunnerModuleScope = { classes, functions };
  const box: RunnerClassBinding = {
    constructor: {
      body: [{ type: 'assign', props: { target: 'this.value', value: 'value' } }],
      name: 'constructor',
      ownerClass: 'Box',
      params: ['value'],
    },
    fields: [{ name: 'value' }],
    getters: new Map([['double', member('double', 'this.value * 2')]]),
    methods: new Map(),
    module: scope,
    name: 'Box',
    ...classOverrides,
  };
  markRunnerMachineClassBinding(box);
  classes.set('Box', box);
  markRunnerMachineRootScope(scope);
  return makeEnv({
    ...overrides,
    runnerCallCache: new Map(),
    runnerCallStack: [],
    runnerClasses: classes,
    runnerFunctions: functions,
  });
}

const getterProgram: readonly IRNode[] = [
  { type: 'let', props: { name: 'box', value: 'new Box(2)' } },
  { type: 'return', props: { value: 'box.double' } },
];

describe('M3.29 pure same-root class getter ownership', () => {
  test('owns linked source and direct sync getter execution', () => {
    expect(selectSourceRunnerEngine(getterProgram, getterClassEnv(), {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(getterProgram, getterClassEnv(), { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 4,
    });

    const source = [
      'class name=Box',
      '  field name=value type=number',
      '  constructor',
      '    param name=value type=number',
      '    handler lang="kern"',
      '      assign target="this.value" value="value"',
      '  getter name=double returns=number',
      '    handler lang="kern"',
      '      return value="this.value * 2"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=box value="new Box(2)"',
      '    print value="box.double"',
    ].join('\n');
    expect(executeKernSource(source)).toBe('4\n');
  });

  test('owns complete root let, print, and return getter leaves', () => {
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(3)' } },
      { type: 'let', props: { name: 'seen', value: 'box.double' } },
      { type: 'print', props: { value: 'box.double' } },
      { type: 'return', props: { value: 'seen' } },
    ];
    const trace = executeSourceRunnerSync(nodes, getterClassEnv(), { policy: 'machine-only' });
    expect(trace.events.filter((event) => event.op === 'stdout')).toEqual([{ op: 'stdout', text: '6' }]);
    expect(trace.completion).toEqual({ kind: 'return', value: 6 });
  });

  test('declared field presence wins over a same-named getter', () => {
    const env = getterClassEnv(
      {},
      {
        fields: [{ name: 'value' }, { name: 'double', value: '5' }],
      },
    );
    expect(executeSourceRunnerSync(getterProgram, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 5,
    });
  });

  test('snapshots getter metadata across async suspension', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'llm', operation: 'complete' } },
      ...getterProgram,
    ];
    const env = getterClassEnv();
    const running = executeSourceRunnerAsync(nodes, env, {
      asyncCapabilities: { llm: { complete: async () => gate } },
      policy: 'machine-only',
    });
    const getter = env.runnerClasses?.get('Box')?.getters.get('double');
    if (!getter) throw new Error('expected getter');
    getter.body[0].props = { value: '99' };
    release?.();
    expect((await running).completion).toEqual({ kind: 'return', value: 4 });
  });

  test('owns nested getter use inside a scalar expression', () => {
    let providerCalls = 0;
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'box', value: 'new Box(2)' } },
      { type: 'return', props: { value: 'box.double + 1' } },
    ];
    const env = getterClassEnv({ capabilities: { storage: { get: () => ++providerCalls } } });

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 5,
    });
    expect(providerCalls).toBe(1);
  });

  test.each([
    [
      'parameters',
      { getters: new Map([['double', { ...member('double', 'this.value'), params: ['x'] }]]) },
      'box.double',
    ],
    [
      'effect',
      {
        getters: new Map([
          ['double', { ...member('double', 'this.value'), body: [{ type: 'print', props: { value: 'this.value' } }] }],
        ]),
      },
      'box.double',
    ],
    ['missing field', { getters: new Map([['double', member('double', 'this.missing')]]) }, 'box.double'],
    ['method call', { getters: new Map([['double', member('double', 'this.read()')]]) }, 'box.double'],
    ['optional access', {}, 'box?.double'],
  ] as const)('routes getter %s to compatibility before provider dispatch', (_label, classOverrides, value) => {
    let providerCalls = 0;
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'box', value: 'new Box(2)' } },
      { type: 'return', props: { value } },
    ];
    const env = getterClassEnv(
      { capabilities: { storage: { get: () => ++providerCalls } } },
      classOverrides as Partial<RunnerClassBinding>,
    );
    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test('keeps inheritance deferred before provider dispatch', () => {
    let providerCalls = 0;
    const env = getterClassEnv({ capabilities: { storage: { get: () => ++providerCalls } } }, { extendsName: 'Base' });
    const nodes = [{ type: 'capability', props: { namespace: 'storage', operation: 'get' } }, ...getterProgram];
    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });
});
