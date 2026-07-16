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
  params: readonly string[],
  body: readonly IRNode[],
): RunnerClassMemberBinding {
  return { body, name, ownerClass, params };
}

function superMethodEnv(
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

describe('M3.31b2a super-method dispatch', () => {
  test('continues the overriding method after a base method returns', () => {
    const env = superMethodEnv([
      {
        constructor: undefined,
        fields: [],
        getters: new Map(),
        methods: new Map([
          ['value', method('Base', 'value', ['input'], [{ type: 'return', props: { value: 'input + 1' } }])],
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
            'value',
            method(
              'Derived',
              'value',
              ['input'],
              [
                { type: 'let', props: { name: 'base', value: 'super.value(input)' } },
                { type: 'let', props: { name: 'after', value: 'base + 10' } },
                { type: 'return', props: { value: 'after' } },
              ],
            ),
          ],
        ]),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.value(5)' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 16,
    });
  });

  test('walks a three-level declaring-owner chain with independent locals', () => {
    const env = superMethodEnv([
      {
        constructor: undefined,
        fields: [],
        getters: new Map(),
        methods: new Map([
          ['score', method('Root', 'score', ['input'], [{ type: 'return', props: { value: 'input + 1' } }])],
        ]),
        name: 'Root',
      },
      {
        constructor: undefined,
        extendsName: 'Root',
        fields: [],
        getters: new Map(),
        methods: new Map([
          [
            'score',
            method(
              'Middle',
              'score',
              ['input'],
              [
                { type: 'let', props: { name: 'base', value: 'super.score(input)' } },
                { type: 'let', props: { name: 'step', value: 'base + 10' } },
                { type: 'return', props: { value: 'step' } },
              ],
            ),
          ],
        ]),
        name: 'Middle',
      },
      {
        constructor: undefined,
        extendsName: 'Middle',
        fields: [],
        getters: new Map(),
        methods: new Map([
          [
            'score',
            method(
              'Leaf',
              'score',
              ['input'],
              [
                { type: 'let', props: { name: 'base', value: 'super.score(input)' } },
                { type: 'let', props: { name: 'step', value: 'base + 100' } },
                { type: 'return', props: { value: 'step' } },
              ],
            ),
          ],
        ]),
        name: 'Leaf',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Leaf()' } },
      { type: 'return', props: { value: 'item.score(5)' } },
    ];

    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 116,
    });
  });

  test('calls a base method from a constructor remainder and getter body', () => {
    const env = superMethodEnv([
      {
        constructor: method(
          'Base',
          'constructor',
          ['value'],
          [{ type: 'assign', props: { target: 'this.value', value: 'value' } }],
        ),
        fields: [{ name: 'value', value: '0' }],
        getters: new Map(),
        methods: new Map([['read', method('Base', 'read', [], [{ type: 'return', props: { value: 'this.value' } }])]]),
        name: 'Base',
      },
      {
        constructor: method(
          'Derived',
          'constructor',
          ['value'],
          [
            { type: 'do', props: { value: 'super(value)' } },
            { type: 'let', props: { name: 'base', value: 'super.read()' } },
            { type: 'assign', props: { target: 'this.result', value: 'base + 1' } },
          ],
        ),
        extendsName: 'Base',
        fields: [{ name: 'result', value: '0' }],
        getters: new Map([
          [
            'total',
            method('Derived', 'total', [], [{ type: 'return', props: { value: 'super.read() + this.result' } }]),
          ],
        ]),
        methods: new Map(),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived(3)' } },
      { type: 'return', props: { value: 'item.total' } },
    ];

    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 7,
    });
  });

  test('resumes a real async base method without replaying the derived activation', async () => {
    let providerCalls = 0;
    const env = superMethodEnv([
      {
        constructor: undefined,
        fields: [],
        getters: new Map(),
        methods: new Map([
          [
            'read',
            method(
              'Base',
              'read',
              [],
              [
                {
                  type: 'capability',
                  props: { input: '{ prompt: "base" }', name: 'answer', namespace: 'llm', operation: 'complete' },
                },
                { type: 'return', props: { value: 'answer' } },
              ],
            ),
          ],
        ]),
        name: 'Base',
      },
      {
        constructor: undefined,
        extendsName: 'Base',
        fields: [{ name: 'visits', value: '0' }],
        getters: new Map(),
        methods: new Map([
          [
            'read',
            method(
              'Derived',
              'read',
              [],
              [
                { type: 'assign', props: { target: 'this.visits', value: 'this.visits + 1' } },
                { type: 'let', props: { name: 'base', value: 'super.read()' } },
                { type: 'return', props: { value: 'base + this.visits' } },
              ],
            ),
          ],
        ]),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.read()' } },
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

  test('snapshots the declaring-owner chain and target body across async suspension', async () => {
    let enterProvider!: () => void;
    let releaseProvider!: () => void;
    const entered = new Promise<void>((resolve) => {
      enterProvider = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const env = superMethodEnv([
      {
        constructor: undefined,
        fields: [],
        getters: new Map(),
        methods: new Map([
          [
            'read',
            method(
              'Base',
              'read',
              [],
              [
                {
                  type: 'capability',
                  props: { input: '{ prompt: "base" }', name: 'answer', namespace: 'llm', operation: 'complete' },
                },
                { type: 'return', props: { value: 'answer + 1' } },
              ],
            ),
          ],
        ]),
        name: 'Base',
      },
      {
        constructor: undefined,
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map([
          ['read', method('Derived', 'read', [], [{ type: 'return', props: { value: 'super.read()' } }])],
        ]),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.read()' } },
    ];
    const running = executeSourceRunnerAsync(nodes, env, {
      asyncCapabilities: {
        llm: {
          complete: async () => {
            enterProvider();
            await release;
            return 4;
          },
        },
      },
      policy: 'machine-only',
    });

    await entered;
    const base = env.runnerClasses?.get('Base');
    const derived = env.runnerClasses?.get('Derived');
    if (!base || !derived) throw new Error('expected class bindings');
    base.methods.set('read', method('Base', 'read', [], [{ type: 'return', props: { value: '99' } }]));
    derived.extendsName = undefined;
    releaseProvider();

    expect((await running).completion).toEqual({ kind: 'return', value: 5 });
  });

  test('injects a rejected base provider once and clears nested activation state', async () => {
    const failure = new Error('base provider rejected once');
    let providerCalls = 0;
    const env = superMethodEnv([
      {
        constructor: undefined,
        fields: [],
        getters: new Map(),
        methods: new Map([
          [
            'read',
            method(
              'Base',
              'read',
              [],
              [
                {
                  type: 'capability',
                  props: { input: '{ prompt: "base" }', name: 'answer', namespace: 'llm', operation: 'complete' },
                },
                { type: 'return', props: { value: 'answer' } },
              ],
            ),
          ],
        ]),
        name: 'Base',
      },
      {
        constructor: undefined,
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map([
          ['read', method('Derived', 'read', [], [{ type: 'return', props: { value: 'super.read()' } }])],
        ]),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.read()' } },
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

  test('owns linked public source with constructor and super-method dispatch', () => {
    const source = [
      'class name=Base',
      '  field name=prefix type=string',
      '  constructor',
      '    param name=prefix type=string',
      '    handler lang="kern"',
      '      assign target="this.prefix" value="prefix"',
      '  method name=label returns=string',
      '    handler lang="kern"',
      '      return value="this.prefix"',
      'class name=Derived extends=Base',
      '  constructor',
      '    param name=prefix type=string',
      '    handler lang="kern"',
      '      do value="super(prefix)"',
      '  method name=label returns=string',
      '    handler lang="kern"',
      '      print value="super.label()"',
      '      return value="super.label() + \'/child\'"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=item value="new Derived(\'x\')"',
      '    print value="item.label()"',
    ].join('\n');

    expect(executeKernSource(source)).toBe('x\nx/child\n');
  });
});
