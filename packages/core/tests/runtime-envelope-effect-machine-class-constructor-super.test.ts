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

function member(
  ownerClass: string,
  name: string,
  params: readonly string[],
  body: readonly IRNode[],
): RunnerClassMemberBinding {
  return { body, name, ownerClass, params };
}

function constructorSuperEnv(
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

describe('M3.31b1 Option-C constructor super lifecycle', () => {
  test('owns a leading explicit super call through the base constructor', () => {
    const env = constructorSuperEnv([
      {
        constructor: member(
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
        constructor: member('Derived', 'constructor', ['value'], [{ type: 'do', props: { value: 'super(value)' } }]),
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map(),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived(7)' } },
      { type: 'return', props: { value: 'item.value' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 7,
    });
  });

  test('injects implicit no-arg super through a constructor-less middle layer', () => {
    const env = constructorSuperEnv([
      {
        constructor: member(
          'Base',
          'constructor',
          [],
          [{ type: 'assign', props: { target: 'this.base', value: '2' } }],
        ),
        fields: [{ name: 'base', value: '0' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Base',
      },
      {
        constructor: undefined,
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map(),
        name: 'Middle',
      },
      {
        constructor: member(
          'Derived',
          'constructor',
          ['value'],
          [{ type: 'assign', props: { target: 'this.derived', value: 'value' } }],
        ),
        extendsName: 'Middle',
        fields: [{ name: 'derived', value: '0' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived(7)' } },
      { type: 'return', props: { value: 'item.base + item.derived' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 9,
    });
  });

  test('interleaves base fields, base constructor, derived fields, and derived constructor', () => {
    const env = constructorSuperEnv([
      {
        constructor: member(
          'Base',
          'constructor',
          [],
          [{ type: 'assign', props: { target: 'this.stage', value: 'this.stage + 1' } }],
        ),
        fields: [{ name: 'stage', value: '1' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Base',
      },
      {
        constructor: member(
          'Derived',
          'constructor',
          [],
          [
            { type: 'do', props: { value: 'super()' } },
            { type: 'assign', props: { target: 'this.stage', value: 'this.stage + 3' } },
          ],
        ),
        extendsName: 'Base',
        fields: [{ name: 'stage', value: '20' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.stage' } },
    ];

    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 23,
    });
  });

  test('owns linked public source with a pure explicit super argument', () => {
    const source = [
      'class name=Base',
      '  field name=base type=number value={{ 0 }}',
      '  constructor',
      '    param name=value type=number',
      '    handler lang="kern"',
      '      assign target="this.base" value="value"',
      'class name=Derived extends=Base',
      '  field name=derived type=number value={{ 0 }}',
      '  constructor',
      '    param name=value type=number',
      '    handler lang="kern"',
      '      do value="super(value + 1)"',
      '      assign target="this.derived" value="this.base + 1"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=item value="new Derived(5)"',
      '    print value="item.base + item.derived"',
    ].join('\n');

    expect(executeKernSource(source)).toBe('13\n');
  });

  test('preflights a base constructor assignment for a later inherited field read', () => {
    const env = constructorSuperEnv([
      {
        constructor: member(
          'Base',
          'constructor',
          [],
          [{ type: 'assign', props: { target: 'this.value', value: '7' } }],
        ),
        fields: [{ name: 'value' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Base',
      },
      {
        constructor: member('Derived', 'constructor', [], [{ type: 'do', props: { value: 'super()' } }]),
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map(),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.value' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 7,
    });
  });

  test('resumes base and derived constructor bodies without replay', () => {
    let providerCalls = 0;
    const env = constructorSuperEnv(
      [
        {
          constructor: member(
            'Base',
            'constructor',
            [],
            [
              { type: 'assign', props: { target: 'this.visits', value: 'this.visits + 1' } },
              { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
              { type: 'assign', props: { target: 'this.value', value: 'answer' } },
            ],
          ),
          fields: [
            { name: 'value', value: '0' },
            { name: 'visits', value: '0' },
          ],
          getters: new Map(),
          methods: new Map(),
          name: 'Base',
        },
        {
          constructor: member(
            'Derived',
            'constructor',
            [],
            [
              { type: 'do', props: { value: 'super()' } },
              { type: 'assign', props: { target: 'this.visits', value: 'this.visits + 1' } },
            ],
          ),
          extendsName: 'Base',
          fields: [],
          getters: new Map(),
          methods: new Map(),
          name: 'Derived',
        },
      ],
      { storage: { get: () => (providerCalls += 1) * 5 } },
    );
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.value + item.visits' } },
    ];

    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 7,
    });
    expect(providerCalls).toBe(1);
  });

  test('resumes real async base and derived capabilities in authored order without replay', async () => {
    const providerOrder: string[] = [];
    const env = constructorSuperEnv([
      {
        constructor: member(
          'Base',
          'constructor',
          [],
          [
            { type: 'capability', props: { name: 'baseValue', namespace: 'llm', operation: 'complete' } },
            { type: 'assign', props: { target: 'this.base', value: 'baseValue' } },
          ],
        ),
        fields: [{ name: 'base', value: '0' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Base',
      },
      {
        constructor: member(
          'Derived',
          'constructor',
          [],
          [
            { type: 'do', props: { value: 'super()' } },
            { type: 'capability', props: { name: 'derivedValue', namespace: 'llm', operation: 'complete' } },
            { type: 'assign', props: { target: 'this.derived', value: 'derivedValue' } },
          ],
        ),
        extendsName: 'Base',
        fields: [{ name: 'derived', value: '0' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.base + item.derived' } },
    ];

    const trace = await executeSourceRunnerAsync(nodes, env, {
      asyncCapabilities: {
        llm: {
          complete: async () => {
            const layer = providerOrder.length === 0 ? 'base' : 'derived';
            providerOrder.push(layer);
            await Promise.resolve();
            return layer === 'base' ? 2 : 5;
          },
        },
      },
      policy: 'machine-only',
    });

    expect(trace.completion).toEqual({ kind: 'return', value: 7 });
    expect(providerOrder).toEqual(['base', 'derived']);
  });

  test('snapshots constructor bodies and lineage before async suspension', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const env = constructorSuperEnv([
      {
        constructor: member(
          'Base',
          'constructor',
          [],
          [{ type: 'assign', props: { target: 'this.value', value: '7' } }],
        ),
        fields: [{ name: 'value', value: '0' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Base',
      },
      {
        constructor: member('Derived', 'constructor', [], [{ type: 'do', props: { value: 'super()' } }]),
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map(),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'llm', operation: 'complete' } },
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.value' } },
    ];
    const running = executeSourceRunnerAsync(nodes, env, {
      asyncCapabilities: { llm: { complete: async () => gate } },
      policy: 'machine-only',
    });
    const base = env.runnerClasses?.get('Base');
    const statement = base?.constructor?.body[0];
    if (!base || !statement?.props) throw new Error('expected base constructor');
    statement.props.value = '99';
    env.runnerClasses?.set('Derived', { ...env.runnerClasses.get('Derived')!, extendsName: 'Missing' });
    release?.();

    expect((await running).completion).toEqual({ kind: 'return', value: 7 });
  });

  test('injects a rejected base provider once and clears private state without leaking the receiver', async () => {
    const failure = new Error('base constructor rejected');
    let calls = 0;
    const env = constructorSuperEnv([
      {
        constructor: member(
          'Base',
          'constructor',
          [],
          [
            { type: 'capability', props: { name: 'answer', namespace: 'llm', operation: 'complete' } },
            { type: 'assign', props: { target: 'this.value', value: 'answer' } },
          ],
        ),
        fields: [{ name: 'value', value: '0' }],
        getters: new Map(),
        methods: new Map(),
        name: 'Base',
      },
      {
        constructor: member('Derived', 'constructor', [], [{ type: 'do', props: { value: 'super()' } }]),
        extendsName: 'Base',
        fields: [],
        getters: new Map(),
        methods: new Map(),
        name: 'Derived',
      },
    ]);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'item', value: 'new Derived()' } },
      { type: 'return', props: { value: 'item.value' } },
    ];

    let caught: unknown;
    try {
      await executeSourceRunnerAsync(nodes, env, {
        asyncCapabilities: {
          llm: {
            complete: async () => {
              calls += 1;
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
    expect(calls).toBe(1);
    expect(internalEffectMachineStateForEnv(env)).toBeUndefined();
    expect(env.bindings.has('item')).toBe(false);
  });
});
