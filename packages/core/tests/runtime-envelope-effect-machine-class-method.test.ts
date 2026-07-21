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

function method(name: string, params: readonly string[], value: string): RunnerClassMemberBinding {
  return {
    body: [{ type: 'return', props: { value } }],
    name,
    ownerClass: 'Box',
    params,
  };
}

function methodClassEnv(
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
    getters: new Map(),
    methods: new Map([
      ['read', method('read', [], 'this.value')],
      ['plus', method('plus', ['amount'], 'this.value + amount')],
    ]),
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

const methodProgram: readonly IRNode[] = [
  { type: 'let', props: { name: 'box', value: 'new Box(2)' } },
  { type: 'print', props: { value: 'box.read()' } },
  { type: 'let', props: { name: 'total', value: 'box.plus(3)' } },
  { type: 'return', props: { value: 'total' } },
];

describe('M3.27 direct same-root class methods', () => {
  test('selects and executes pure direct methods on the machine', () => {
    const env = methodClassEnv();

    expect(selectSourceRunnerEngine(methodProgram, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    const result = executeSourceRunnerSync(methodProgram, methodClassEnv(), { policy: 'machine-only' });
    expect(result.completion).toEqual({ kind: 'return', value: 5 });
    expect(result.events.find((event) => event.op === 'stdout')).toEqual({ op: 'stdout', text: '2' });
  });

  test('owns the linked public source path without changing compatibility output', () => {
    const source = [
      'class name=Box',
      '  field name=value type=number',
      '  constructor',
      '    param name=value type=number',
      '    handler lang="kern"',
      '      assign target="this.value" value="value"',
      '  method name=plus returns=number',
      '    param name=amount type=number',
      '    handler lang="kern"',
      '      return value="this.value + amount"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=box value="new Box(2)"',
      '    print value="box.plus(3)"',
    ].join('\n');

    expect(executeKernSource(source)).toBe('5\n');
  });

  test('preserves direct method dispatch across async suspension', async () => {
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(4)' } },
      {
        type: 'capability',
        props: { input: '{ prompt: 0 }', name: 'ignored', namespace: 'llm', operation: 'complete' },
      },
      { type: 'return', props: { value: 'box.plus(2)' } },
    ];

    const result = await executeSourceRunnerAsync(nodes, methodClassEnv(), {
      asyncCapabilities: { llm: { complete: async () => 99 } },
      policy: 'machine-only',
    });

    expect(result).toMatchObject({ completion: { kind: 'return', value: 6 } });
  });

  test('snapshots admitted direct method bodies before async suspension', async () => {
    let releaseProvider: (() => void) | undefined;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const nodes: readonly IRNode[] = [
      {
        type: 'capability',
        props: { input: '{ prompt: 0 }', namespace: 'llm', operation: 'complete' },
      },
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'return', props: { value: 'box.read()' } },
    ];
    const env = methodClassEnv();
    const running = executeSourceRunnerAsync(nodes, env, {
      asyncCapabilities: { llm: { complete: async () => providerGate } },
      policy: 'machine-only',
    });
    const statement = env.runnerClasses?.get('Box')?.methods.get('read')?.body[0];
    if (statement?.props) statement.props.value = '99';
    releaseProvider?.();

    expect((await running).completion).toEqual({ kind: 'return', value: 1 });
  });

  test.each([
    [
      'state mutation',
      {
        methods: new Map([
          [
            'change',
            {
              body: [
                { type: 'assign', props: { target: 'this.value', value: '1' } },
                { type: 'return', props: { value: 'this.value' } },
              ],
              name: 'change',
              ownerClass: 'Box',
              params: [],
            },
          ],
        ]),
      },
      'box.change()',
      1,
    ],
    ['nested scalar use', {}, 'box.read() + 1', 2],
  ] as const)('owns method %s in a class frame', (_label, classOverrides, value, expected) => {
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'return', props: { value } },
    ];
    const env = methodClassEnv({}, classOverrides as Partial<RunnerClassBinding>);

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: expected,
    });
  });

  test.each([
    ['wrong arity', {}, 'box.plus()'],
    ['missing method', {}, 'box.missing()'],
    ['optional receiver', {}, 'box?.read()'],
    ['optional call', {}, 'box.read?.()'],
  ] as const)('routes %s to compatibility before provider dispatch', (_label, classOverrides, value) => {
    let providerCalls = 0;
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'return', props: { value } },
    ];
    const env = methodClassEnv(
      { capabilities: { storage: { get: () => ++providerCalls } } },
      classOverrides as Partial<RunnerClassBinding>,
    );

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test('owns deferred method arguments through the resumable class frame', () => {
    let providerCalls = 0;
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'return', props: { value: 'box.plus(answer)' } },
    ];
    const env = methodClassEnv({ capabilities: { storage: { get: () => ++providerCalls } } });

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 2,
    });
    expect(providerCalls).toBe(1);
  });

  test.each([
    ['free binding', 'outside'],
    ['missing own field', 'this.other'],
    ['nested call', 'String(this.value)'],
  ])('rejects a method body with %s before provider dispatch', (_label, value) => {
    let providerCalls = 0;
    const env = methodClassEnv(
      { capabilities: { storage: { get: () => ++providerCalls } } },
      { methods: new Map([['read', method('read', [], value)]]) },
    );
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'return', props: { value: 'box.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test('routes class-instance alias transport to compatibility before provider dispatch', () => {
    let providerCalls = 0;
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'let', props: { name: 'alias', value: 'box' } },
      { type: 'return', props: { value: 'alias.read()' } },
    ];
    const env = methodClassEnv({ capabilities: { storage: { get: () => ++providerCalls } } });

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test.each([
    [
      'if body',
      {
        type: 'if',
        props: { cond: 'true' },
        children: [{ type: 'return', props: { value: 'box.read()' } }],
      },
    ],
    [
      'branch path',
      {
        type: 'branch',
        props: { on: '"selected"' },
        children: [
          {
            type: 'path',
            props: { value: 'selected' },
            __quotedProps: ['value'],
            children: [{ type: 'return', props: { value: 'box.read()' } }],
          },
        ],
      },
    ],
    [
      'if scalar expression',
      {
        type: 'if',
        props: { cond: 'true' },
        children: [{ type: 'return', props: { value: 'box.read() + 1' } }],
      },
    ],
  ] as const)(
    'routes a direct method call in a nested %s to compatibility before provider dispatch',
    (_label, body) => {
      let providerCalls = 0;
      const nodes: readonly IRNode[] = [
        { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
        { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
        body,
      ];
      const env = methodClassEnv({ capabilities: { storage: { get: () => ++providerCalls } } });

      expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
      expect(providerCalls).toBe(0);
    },
  );

  test.each([
    ['missing return', []],
    ['non-scalar return', [{ type: 'return', props: { value: '{ value: this.value }' } }]],
  ] as const)('rejects a method with %s before provider dispatch', (_label, body) => {
    let providerCalls = 0;
    const invalid: RunnerClassMemberBinding = {
      body: [...body],
      name: 'read',
      ownerClass: 'Box',
      params: [],
    };
    const env = methodClassEnv(
      { capabilities: { storage: { get: () => ++providerCalls } } },
      { methods: new Map([['read', invalid]]) },
    );
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'return', props: { value: 'box.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test('rejects a caller-forged receiver during admission', () => {
    const env = methodClassEnv({
      bindings: new Map([
        [
          'box',
          {
            __kernRunnerClassInstance: true,
            className: 'Box',
            fields: { value: 1 },
          },
        ],
      ]),
    });

    expect(selectSourceRunnerEngine([{ type: 'return', props: { value: 'box.read()' } }], env, {})).toBe(
      SOURCE_RUNNER_ENGINE.legacy,
    );
  });

  test('rejects method metadata changed after linker ownership', () => {
    const env = methodClassEnv();
    const statement = env.runnerClasses?.get('Box')?.methods.get('read')?.body[0];
    if (statement?.props) statement.props.value = '1';

    expect(selectSourceRunnerEngine(methodProgram, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });
});
