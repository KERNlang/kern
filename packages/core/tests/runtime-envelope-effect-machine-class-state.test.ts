import { markRunnerMachineClassBinding, markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import {
  childEnv,
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

function stateClassEnv(
  overrides: Partial<SemanticEnv> = {},
  classOverrides: Partial<RunnerClassBinding> = {},
): SemanticEnv {
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const scope: RunnerModuleScope = { classes, functions };
  const constructorBinding: RunnerClassMemberBinding = {
    body: [{ type: 'assign', props: { target: 'this.value', value: 'value' } }],
    name: 'constructor',
    ownerClass: 'Box',
    params: ['value'],
  };
  const box: RunnerClassBinding = {
    constructor: constructorBinding,
    fields: [{ name: 'value' }],
    getters: new Map(),
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

const stateProgram: readonly IRNode[] = [
  { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
  { type: 'print', props: { value: 'box.value' } },
  { type: 'assign', props: { target: 'box.value', value: '2' } },
  { type: 'print', props: { value: 'box.value' } },
];

function stdout(nodes: readonly IRNode[], env: SemanticEnv): readonly string[] {
  return executeSourceRunnerSync(nodes, env, { policy: 'machine-only' })
    .events.filter((event) => event.op === 'stdout')
    .map((event) => event.text);
}

describe('M3.26 same-root state-only class ownership', () => {
  test('preserves same-root class ownership through an authentic child environment', () => {
    const child = childEnv(stateClassEnv());

    expect(selectSourceRunnerEngine(stateProgram, child, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(stdout(stateProgram, child)).toEqual(['1', '2']);
  });

  test('owns the linked public source-runner path', () => {
    const source = [
      'class name=Box',
      '  field name=value type=number',
      '  constructor',
      '    param name=value type=number',
      '    handler lang="kern"',
      '      assign target="this.value" value="value"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=box value="new Box(1)"',
      '    print value="box.value"',
      '    assign target="box.value" value="2"',
      '    print value="box.value"',
    ].join('\n');

    expect(executeKernSource(source)).toBe('1\n2\n');
  });

  test('selects machine when the linked root function map contains the entry function', () => {
    const env = stateClassEnv();
    const scope = env.runnerClasses?.get('Box')?.module;
    scope?.functions.set('main', {
      body: stateProgram,
      module: scope,
      name: 'main',
      params: [],
      returns: 'void',
    });

    expect(selectSourceRunnerEngine(stateProgram, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
  });

  test('selects and executes construction plus own-field read/write on the machine', () => {
    expect(selectSourceRunnerEngine(stateProgram, stateClassEnv(), {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(stdout(stateProgram, stateClassEnv())).toEqual(['1', '2']);
  });

  test('routes inheritance to compatibility before provider dispatch', () => {
    let providerCalls = 0;
    const nodes: readonly IRNode[] = [
      {
        type: 'capability',
        props: { namespace: 'storage', operation: 'get' },
      },
      ...stateProgram,
    ];
    const env = stateClassEnv({ capabilities: { storage: { get: () => ++providerCalls } } }, { extendsName: 'Base' });

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test('owns constructor stdout effects on the resumable frame', () => {
    let providerCalls = 0;
    const env = stateClassEnv(
      { capabilities: { storage: { get: () => ++providerCalls } } },
      {
        constructor: {
          body: [
            { type: 'print', props: { value: 'value' } },
            { type: 'assign', props: { target: 'this.value', value: 'value' } },
          ],
          name: 'constructor',
          ownerClass: 'Box',
          params: ['value'],
        },
      },
    );
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      ...stateProgram,
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    const result = executeSourceRunnerSync(nodes, env, { policy: 'machine-only' });
    expect(result.events.filter((event) => event.op === 'stdout').map((event) => event.text)).toEqual(['1', '1', '2']);
    expect(providerCalls).toBe(1);
  });

  test('preserves receiver state across async suspension and isolates parallel runs', async () => {
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      {
        type: 'capability',
        props: {
          input: '{ prompt: box.value }',
          name: 'answer',
          namespace: 'llm',
          operation: 'complete',
        },
      },
      { type: 'assign', props: { target: 'box.value', value: 'answer' } },
      { type: 'return', props: { value: 'box.value' } },
    ];
    const run = (answer: number) =>
      executeSourceRunnerAsync(nodes, stateClassEnv(), {
        asyncCapabilities: { llm: { complete: async () => answer } },
        policy: 'machine-only',
      });

    const [first, second] = await Promise.all([run(7), run(9)]);
    expect(first.completion).toEqual({ kind: 'return', value: 7 });
    expect(second.completion).toEqual({ kind: 'return', value: 9 });
  });

  test('defers class construction and field writes that consume capability results', () => {
    const results = ['seed', 'changed'];
    const nodes: readonly IRNode[] = [
      {
        type: 'capability',
        props: { name: 'initial', namespace: 'storage', operation: 'get' },
      },
      {
        type: 'let',
        props: { name: 'box', value: 'new Box(Text.length(initial))' },
      },
      {
        type: 'capability',
        props: { name: 'updated', namespace: 'storage', operation: 'get' },
      },
      {
        type: 'assign',
        props: { target: 'box.value', value: 'Text.length(updated)' },
      },
      { type: 'return', props: { value: 'box.value' } },
    ];
    const env = stateClassEnv({
      capabilities: { storage: { get: () => results.shift() } },
    });

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 7,
    });
  });

  test('rejects post-link hostile class bindings without invoking accessors', () => {
    let getterCalls = 0;
    const env = stateClassEnv();
    const hostile = env.runnerClasses?.get('Box');
    if (!hostile) throw new Error('expected Box binding');
    Object.defineProperty(hostile, 'name', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'Box';
      },
    });

    expect(selectSourceRunnerEngine(stateProgram, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(getterCalls).toBe(0);
  });

  test('snapshots the admitted class registry before async suspension', async () => {
    let releaseProvider: (() => void) | undefined;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const nodes: readonly IRNode[] = [
      {
        type: 'capability',
        props: {
          input: '{ prompt: 0 }',
          namespace: 'llm',
          operation: 'complete',
        },
      },
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'return', props: { value: 'box.value' } },
    ];
    const env = stateClassEnv();
    const running = executeSourceRunnerAsync(nodes, env, {
      asyncCapabilities: { llm: { complete: async () => providerGate } },
      policy: 'machine-only',
    });
    const original = env.runnerClasses?.get('Box');
    if (!original) throw new Error('test class is missing');
    env.runnerClasses?.set('Box', {
      ...original,
      constructor: {
        body: [{ type: 'assign', props: { target: 'this.value', value: '99' } }],
        name: 'constructor',
        ownerClass: 'Box',
        params: ['value'],
      },
    });
    releaseProvider?.();

    const result = await running;
    expect(result.completion).toEqual({ kind: 'return', value: 1 });
  });

  test('defers class construction and field mutation fed by an async result', async () => {
    const nodes: readonly IRNode[] = [
      {
        type: 'capability',
        props: {
          input: '{ prompt: 0 }',
          name: 'answer',
          namespace: 'llm',
          operation: 'complete',
        },
      },
      { type: 'let', props: { name: 'box', value: 'new Box(answer + 1)' } },
      { type: 'assign', props: { target: 'box.value', value: 'answer + 2' } },
      { type: 'return', props: { value: 'box.value' } },
    ];

    const result = await executeSourceRunnerAsync(nodes, stateClassEnv(), {
      asyncCapabilities: { llm: { complete: async () => 2 } },
      policy: 'machine-only',
    });

    expect(result.completion).toEqual({ kind: 'return', value: 4 });
  });

  test.each([
    ['helper call', 'identity(value)'],
    ['missing binding', 'missing'],
    ['missing own field', 'this.other'],
    ['nested class allocation', 'new Box(2)'],
  ])('rejects deferred constructor %s before provider dispatch', (_label, value) => {
    let providerCalls = 0;
    const env = stateClassEnv(
      { capabilities: { storage: { get: () => ++providerCalls } } },
      {
        constructor: {
          body: [{ type: 'assign', props: { target: 'this.value', value } }],
          name: 'constructor',
          ownerClass: 'Box',
          params: ['value'],
        },
      },
    );
    if (value === 'identity(value)') {
      const scope = env.runnerClasses?.get('Box')?.module;
      scope?.functions.set('identity', {
        body: [{ type: 'return', props: { value: 'value' } }],
        module: scope,
        name: 'identity',
        params: ['value'],
        returns: 'number',
      });
    }
    const nodes: readonly IRNode[] = [
      {
        type: 'capability',
        props: { name: 'answer', namespace: 'storage', operation: 'get' },
      },
      { type: 'let', props: { name: 'box', value: 'new Box(answer)' } },
      { type: 'return', props: { value: 'box.value' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test('rejects a deferred constructor read before own-field initialization', () => {
    let providerCalls = 0;
    const env = stateClassEnv(
      { capabilities: { storage: { get: () => ++providerCalls } } },
      {
        constructor: {
          body: [
            {
              type: 'assign',
              props: { target: 'this.value', value: 'this.other' },
            },
            { type: 'assign', props: { target: 'this.other', value: 'value' } },
          ],
          name: 'constructor',
          ownerClass: 'Box',
          params: ['value'],
        },
        fields: [{ name: 'value' }, { name: 'other' }],
      },
    );
    const nodes: readonly IRNode[] = [
      {
        type: 'capability',
        props: { name: 'answer', namespace: 'storage', operation: 'get' },
      },
      { type: 'let', props: { name: 'box', value: 'new Box(answer)' } },
      { type: 'return', props: { value: 'box.value' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test.each([
    ['missing', 'other', {}],
    ['uninitialized', 'other', { fields: [{ name: 'value' }, { name: 'other' }] }],
  ])('rejects deferred %s class field reads before provider dispatch', (_label, field, classOverrides) => {
    let providerCalls = 0;
    const env = stateClassEnv(
      { capabilities: { storage: { get: () => ++providerCalls } } },
      classOverrides as Partial<RunnerClassBinding>,
    );
    const nodes: readonly IRNode[] = [
      {
        type: 'capability',
        props: { name: 'answer', namespace: 'storage', operation: 'get' },
      },
      { type: 'let', props: { name: 'box', value: 'new Box(answer)' } },
      { type: 'return', props: { value: `box.${field}` } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test('rejects an unowned class binding without invoking its accessors', () => {
    let getterCalls = 0;
    const functions: RunnerModuleScope['functions'] = new Map();
    const classes: RunnerModuleScope['classes'] = new Map();
    const scope: RunnerModuleScope = { classes, functions };
    const hostile = {} as RunnerClassBinding;
    Object.defineProperty(hostile, 'name', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'Box';
      },
    });
    classes.set('Box', hostile);
    markRunnerMachineRootScope(scope);
    const env = makeEnv({ runnerClasses: classes, runnerFunctions: functions });

    expect(selectSourceRunnerEngine(stateProgram, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(getterCalls).toBe(0);
  });

  test('routes undeclared field writes and helper/class mixing to compatibility', () => {
    const undeclared: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'assign', props: { target: 'box.other', value: '2' } },
    ];
    expect(selectSourceRunnerEngine(undeclared, stateClassEnv(), {})).toBe(SOURCE_RUNNER_ENGINE.legacy);

    const env = stateClassEnv();
    const scope = env.runnerClasses?.get('Box')?.module;
    scope?.functions.set('identity', {
      body: [{ type: 'return', props: { value: 'value' } }],
      module: scope,
      name: 'identity',
      params: ['value'],
      returns: 'number',
    });
    expect(selectSourceRunnerEngine([{ type: 'print', props: { value: 'identity(1)' } }], env, {})).toBe(
      SOURCE_RUNNER_ENGINE.legacy,
    );
  });

  test('routes nested class mutation to compatibility before provider dispatch', () => {
    let providerCalls = 0;
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      {
        type: 'if',
        props: { cond: 'true' },
        children: [{ type: 'assign', props: { target: 'box.value', value: '2' } }],
      },
    ];
    const env = stateClassEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
    });

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });
});
