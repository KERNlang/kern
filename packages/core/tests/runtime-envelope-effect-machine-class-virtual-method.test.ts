import { internalEffectMachineStateForEnv } from '../src/ir/semantics/internal-effect-machine-helper-state.js';
import { markRunnerMachineClassBinding, markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import {
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassMemberBinding,
  type RunnerModuleScope,
  type SemanticEnv,
} from '../src/ir/semantics/semantic-env.js';
import { executeKernSource } from '../src/runner.js';
import { KernCapabilityError } from '../src/runner-capabilities.js';
import {
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';

function method(
  ownerClass: string,
  name: string,
  value: string,
  params: readonly string[] = [],
): RunnerClassMemberBinding {
  return { body: [{ type: 'return', props: { value } }], name, ownerClass, params };
}

function member(
  ownerClass: string,
  name: string,
  body: readonly IRNode[],
  params: readonly string[] = [],
): RunnerClassMemberBinding {
  return { body, name, ownerClass, params };
}

function errorMessages(error: unknown): string {
  const messages: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) messages.push(current.message);
  return messages.join('\n');
}

function virtualMethodEnv(
  bindings: readonly Omit<RunnerClassBinding, 'module'>[],
  capabilities?: SemanticEnv['capabilities'],
): SemanticEnv {
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const scope: RunnerModuleScope = { classes, functions };
  for (const binding of bindings) {
    const cls: RunnerClassBinding = { ...binding, module: scope };
    markRunnerMachineClassBinding(cls);
    classes.set(cls.name, cls);
  }
  markRunnerMachineRootScope(scope);
  return makeEnv({
    capabilities,
    runnerCallCache: new Map(),
    runnerCallStack: [],
    runnerClasses: classes,
    runnerFunctions: functions,
  });
}

describe('M3.31b2b1 virtual this-method dispatch', () => {
  test('dispatches a base template call to the nearest derived override', () => {
    const env = virtualMethodEnv([
      {
        constructor: undefined,
        fields: [],
        getters: new Map(),
        methods: new Map([
          ['add', method('Base', 'add', 'left + right', ['left', 'right'])],
          ['render', method('Base', 'render', 'this.add(this.value(), 1)')],
          ['value', method('Base', 'value', '1')],
        ]),
        name: 'Base',
      },
      {
        constructor: undefined,
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map([['value', method('Derived', 'value', '2')]]),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.render()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 3,
    });
  });

  test('chains concrete virtual lookup into declaring-owner super lookup', () => {
    const env = virtualMethodEnv([
      {
        constructor: undefined,
        fields: [],
        getters: new Map(),
        methods: new Map([
          ['render', method('Root', 'render', 'this.value()')],
          ['value', method('Root', 'value', '1')],
        ]),
        name: 'Root',
      },
      {
        constructor: undefined,
        extendsName: 'Root',
        fields: [],
        getters: new Map(),
        methods: new Map([['value', method('Middle', 'value', 'super.value() + 10')]]),
        name: 'Middle',
      },
      {
        constructor: undefined,
        extendsName: 'Middle',
        fields: [],
        getters: new Map(),
        methods: new Map([['value', method('Leaf', 'value', 'super.value() + 100')]]),
        name: 'Leaf',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Leaf()' } },
      { type: 'return', props: { value: 'item.render()' } },
    ];

    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 111,
    });
  });

  test('dispatches virtually from a base constructor remainder and getter body', () => {
    const env = virtualMethodEnv([
      {
        constructor: member('Base', 'constructor', [
          { type: 'let', props: { name: 'seed', value: 'this.seed()' } },
          { type: 'assign', props: { target: 'this.total', value: 'seed' } },
        ]),
        fields: [{ name: 'total' }],
        getters: new Map([['current', method('Base', 'current', 'this.seed() + this.total')]]),
        methods: new Map([['seed', method('Base', 'seed', '1')]]),
        name: 'Base',
      },
      {
        constructor: undefined,
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map([['seed', method('Derived', 'seed', '5')]]),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.current' } },
    ];

    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 10,
    });
  });

  test('resumes an async derived override without replaying its base template', async () => {
    let providerCalls = 0;
    const env = virtualMethodEnv([
      {
        constructor: undefined,
        fields: [{ name: 'visits', value: '0' }],
        getters: new Map(),
        methods: new Map([
          [
            'render',
            member('Base', 'render', [
              { type: 'assign', props: { target: 'this.visits', value: 'this.visits + 1' } },
              { type: 'let', props: { name: 'result', value: 'this.read()' } },
              { type: 'return', props: { value: 'result + this.visits' } },
            ]),
          ],
          ['read', method('Base', 'read', '0')],
        ]),
        name: 'Base',
      },
      {
        constructor: undefined,
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map([
          [
            'read',
            member('Derived', 'read', [
              {
                type: 'capability',
                props: { input: '{ prompt: "derived" }', name: 'answer', namespace: 'llm', operation: 'complete' },
              },
              { type: 'return', props: { value: 'answer' } },
            ]),
          ],
        ]),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.render()' } },
    ];

    const trace = await executeSourceRunnerAsync(nodes, env, {
      asyncCapabilities: {
        llm: {
          complete: async () => {
            providerCalls += 1;
            await Promise.resolve();
            return 20;
          },
        },
      },
      policy: 'machine-only',
    });

    expect(trace.completion).toEqual({ kind: 'return', value: 21 });
    expect(providerCalls).toBe(1);
  });

  test('snapshots the virtual target body and lineage across async suspension', async () => {
    let entered!: () => void;
    let release!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    const env = virtualMethodEnv([
      {
        constructor: undefined,
        fields: [],
        getters: new Map(),
        methods: new Map([
          ['render', method('Base', 'render', 'this.read()')],
          ['read', method('Base', 'read', '1')],
        ]),
        name: 'Base',
      },
      {
        constructor: undefined,
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map([
          [
            'read',
            member('Derived', 'read', [
              {
                type: 'capability',
                props: { input: '{ prompt: "derived" }', name: 'answer', namespace: 'llm', operation: 'complete' },
              },
              { type: 'return', props: { value: 'answer + 1' } },
            ]),
          ],
        ]),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.render()' } },
    ];
    const running = executeSourceRunnerAsync(nodes, env, {
      asyncCapabilities: {
        llm: {
          complete: async () => {
            entered();
            await providerRelease;
            return 4;
          },
        },
      },
      policy: 'machine-only',
    });

    await providerEntered;
    const base = env.runnerClasses?.get('Base');
    const derived = env.runnerClasses?.get('Derived');
    if (!base || !derived) throw new Error('expected class bindings');
    base.methods.set('render', method('Base', 'render', '99'));
    derived.methods.set('read', method('Derived', 'read', '99'));
    derived.extendsName = undefined;
    release();

    expect((await running).completion).toEqual({ kind: 'return', value: 5 });
  });

  test.each([
    ['direct', new Map([['loop', method('Base', 'loop', 'this.loop()')]]), 'item.loop()'],
    [
      'indirect',
      new Map([
        ['first', method('Base', 'first', 'this.second()')],
        ['second', method('Base', 'second', 'this.first()')],
      ]),
      'item.first()',
    ],
  ])('rejects %s virtual recursion with compatibility call-stack semantics', (_name, methods, call) => {
    const env = virtualMethodEnv([
      { constructor: undefined, fields: [], getters: new Map(), methods, name: 'Base' },
      { constructor: undefined, extendsName: 'Base', fields: [], getters: new Map(), methods: new Map(), name: 'Leaf' },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Leaf()' } },
      { type: 'return', props: { value: call } },
    ];

    let caught: unknown;
    try {
      executeSourceRunnerSync(nodes, env, { policy: 'machine-only' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('effect machine rejected node type');
    expect(errorMessages(caught)).toContain('recursive member call');
    expect(internalEffectMachineStateForEnv(env)).toBeUndefined();
  });

  test('fails before a provider when a base constructor dispatch reads an uninitialized derived field', async () => {
    let providerCalls = 0;
    const env = virtualMethodEnv([
      {
        constructor: member('Base', 'constructor', [{ type: 'let', props: { name: 'value', value: 'this.read()' } }]),
        fields: [],
        getters: new Map(),
        methods: new Map([['read', method('Base', 'read', '1')]]),
        name: 'Base',
      },
      {
        constructor: undefined,
        extendsName: 'Base',
        fields: [{ name: 'later', value: '7' }],
        getters: new Map(),
        methods: new Map([
          [
            'read',
            member('Derived', 'read', [
              { type: 'let', props: { name: 'value', value: 'this.later' } },
              {
                type: 'capability',
                props: { input: '{ prompt: "late" }', name: 'answer', namespace: 'llm', operation: 'complete' },
              },
              { type: 'return', props: { value: 'value + answer' } },
            ]),
          ],
        ]),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [{ type: 'let', props: { name: 'item', value: 'new Derived()' } }];
    let caught: unknown;
    try {
      await executeSourceRunnerAsync(nodes, env, {
        asyncCapabilities: {
          llm: {
            complete: async () => {
              providerCalls += 1;
              return 1;
            },
          },
        },
        policy: 'machine-only',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(providerCalls).toBe(0);
    expect(internalEffectMachineStateForEnv(env)).toBeUndefined();
  });

  test('does not retry compatibility after a rejected virtual override provider', async () => {
    const failure = new Error('virtual provider rejected once');
    let providerCalls = 0;
    const env = virtualMethodEnv([
      {
        constructor: undefined,
        fields: [],
        getters: new Map(),
        methods: new Map([
          ['render', method('Base', 'render', 'this.read()')],
          ['read', method('Base', 'read', '1')],
        ]),
        name: 'Base',
      },
      {
        constructor: undefined,
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map([
          [
            'read',
            member('Derived', 'read', [
              {
                type: 'capability',
                props: { input: '{ prompt: "derived" }', name: 'answer', namespace: 'llm', operation: 'complete' },
              },
              { type: 'return', props: { value: 'answer' } },
            ]),
          ],
        ]),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.render()' } },
    ];
    let caught: unknown;
    try {
      await executeSourceRunnerAsync(nodes, env, {
        asyncCapabilities: {
          llm: {
            complete: async () => {
              providerCalls += 1;
              throw failure;
            },
          },
        },
        policy: 'machine-only',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(KernCapabilityError);
    expect((caught as Error).message).toContain(failure.message);
    expect(providerCalls).toBe(1);
    expect(internalEffectMachineStateForEnv(env)).toBeUndefined();
  });

  test('owns linked public source with virtual and nested super dispatch', () => {
    const source = [
      'class name=Base',
      '  method name=render returns=number',
      '    handler lang="kern"',
      '      print value="this.value()"',
      '      return value="this.value()"',
      '  method name=value returns=number',
      '    handler lang="kern"',
      '      return value="1"',
      'class name=Derived extends=Base',
      '  method name=value returns=number',
      '    handler lang="kern"',
      '      return value="super.value() + 10"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=item value="new Derived()"',
      '    print value="item.render()"',
    ].join('\n');

    expect(executeKernSource(source)).toBe('11\n11\n');
  });
});
