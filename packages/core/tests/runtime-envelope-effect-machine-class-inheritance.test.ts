import {
  assertInternalMachineClassGraph,
  assertInternalMachineClassUsage,
} from '../src/ir/semantics/internal-effect-machine-class-graph.js';
import { isRunnerClassInstanceValue } from '../src/ir/semantics/portable-scalar-domain.js';
import { markRunnerMachineClassBinding, markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import {
  getBinding,
  makeEnv,
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

interface InheritanceFixture {
  readonly classes: RunnerModuleScope['classes'];
  readonly scope: RunnerModuleScope;
}

function member(
  ownerClass: string,
  name: string,
  value: string,
  params: readonly string[] = [],
): RunnerClassMemberBinding {
  return {
    body: [{ type: 'return', props: { value } }],
    name,
    ownerClass,
    params,
  };
}

function inheritanceEnv(
  overrides: Partial<SemanticEnv> = {},
  adjust: (fixture: InheritanceFixture) => void = () => undefined,
): SemanticEnv {
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const scope: RunnerModuleScope = { classes, functions };
  classes.set('Animal', {
    constructor: undefined,
    fields: [
      { name: 'sound', value: "'generic'" },
      { name: 'base', value: '2' },
    ],
    getters: new Map([['voice', member('Animal', 'voice', 'this.sound')]]),
    methods: new Map([['kind', member('Animal', 'kind', '1')]]),
    module: scope,
    name: 'Animal',
  });
  classes.set('Mid', {
    constructor: undefined,
    extendsName: 'Animal',
    fields: [{ name: 'mid', value: '3' }],
    getters: new Map(),
    methods: new Map([['kind', member('Mid', 'kind', '2')]]),
    module: scope,
    name: 'Mid',
  });
  classes.set('Dog', {
    constructor: undefined,
    extendsName: 'Mid',
    fields: [
      { name: 'sound', value: "'woof'" },
      { name: 'leaf', value: '4' },
    ],
    getters: new Map(),
    methods: new Map([['total', member('Dog', 'total', 'this.base + this.mid + this.leaf')]]),
    module: scope,
    name: 'Dog',
  });
  adjust({ classes, scope });
  for (const cls of classes.values()) markRunnerMachineClassBinding(cls);
  markRunnerMachineRootScope(scope);
  return makeEnv({
    ...overrides,
    runnerCallCache: new Map(),
    runnerCallStack: [],
    runnerClasses: classes,
    runnerFunctions: functions,
  });
}

const inheritanceProgram: readonly IRNode[] = [
  { type: 'let', props: { name: 'dog', value: 'new Dog()' } },
  { type: 'print', props: { value: 'dog.sound' } },
  { type: 'print', props: { value: 'dog.voice' } },
  { type: 'print', props: { value: 'dog.kind()' } },
  { type: 'print', props: { value: 'dog.total()' } },
  { type: 'assign', props: { target: 'dog.base', value: '5' } },
  { type: 'return', props: { value: 'dog.total()' } },
];

function stdout(trace: ReturnType<typeof executeSourceRunnerSync>): readonly string[] {
  return trace.events.filter((event) => event.op === 'stdout').map((event) => event.text);
}

function linkedSource(forceCompatibility = false): string {
  const soundRead = forceCompatibility ? "dog.sound + ''" : 'dog.sound';
  return [
    'class name=Animal',
    '  field name=sound type=string value="\'generic\'"',
    '  field name=base type=number value="2"',
    '  getter name=voice returns=string',
    '    handler lang="kern"',
    '      return value="this.sound"',
    '  method name=kind returns=number',
    '    handler lang="kern"',
    '      return value="1"',
    'class name=Mid extends=Animal',
    '  field name=mid type=number value="3"',
    '  method name=kind returns=number',
    '    handler lang="kern"',
    '      return value="2"',
    'class name=Dog extends=Mid',
    '  field name=sound type=string value="\'woof\'"',
    '  field name=leaf type=number value="4"',
    '  method name=total returns=number',
    '    handler lang="kern"',
    '      return value="this.base + this.mid + this.leaf"',
    'fn name=main returns=void',
    '  handler lang="kern"',
    '    let name=dog value="new Dog()"',
    `    print value="${soundRead}"`,
    '    print value="dog.voice"',
    '    print value="dog.kind()"',
    '    print value="dog.total()"',
  ].join('\n');
}

describe('M3.30 constructorless same-root inheritance ownership', () => {
  test('normalizes the forced compatibility path to derived-field-wins', () => {
    expect(executeKernSource(linkedSource(true))).toBe('woof\nwoof\n2\n9\n');
  });

  test('owns linked source and direct transitive inheritance execution', () => {
    const env = inheritanceEnv();
    expect(() => assertInternalMachineClassGraph(env)).not.toThrow();
    expect(() => assertInternalMachineClassUsage(inheritanceProgram, env)).not.toThrow();
    expect(selectSourceRunnerEngine(inheritanceProgram, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    const trace = executeSourceRunnerSync(inheritanceProgram, env, { policy: 'machine-only' });
    expect(stdout(trace)).toEqual(['woof', 'woof', '2', '9']);
    expect(trace.completion).toEqual({ kind: 'return', value: 12 });
    expect(executeKernSource(linkedSource())).toBe('woof\nwoof\n2\n9\n');
  });

  test('overwrites a base slot when the derived field has no initializer', () => {
    const env = inheritanceEnv({}, ({ classes }) => {
      const dog = classes.get('Dog');
      if (!dog) throw new Error('expected derived');
      classes.set('Dog', {
        ...dog,
        fields: dog.fields.map((field) => (field.name === 'sound' ? { name: field.name } : field)),
      });
    });
    const trace = executeSourceRunnerSync([{ type: 'let', props: { name: 'dog', value: 'new Dog()' } }], env, {
      policy: 'machine-only',
    });
    expect(trace.completion).toEqual({ kind: 'normal' });
    const dog = getBinding(env, 'dog');
    expect(isRunnerClassInstanceValue(dog)).toBe(true);
    if (!isRunnerClassInstanceValue(dog)) throw new Error('expected constructed instance');
    expect(Object.hasOwn(dog.fields, 'sound')).toBe(true);
    expect(dog.fields.sound).toBeUndefined();
  });

  test('snapshots the complete lineage across async suspension', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'llm', operation: 'complete' } },
      ...inheritanceProgram,
    ];
    const env = inheritanceEnv();
    const running = executeSourceRunnerAsync(nodes, env, {
      asyncCapabilities: { llm: { complete: async () => gate } },
      policy: 'machine-only',
    });
    const voice = env.runnerClasses?.get('Animal')?.getters.get('voice');
    if (!voice) throw new Error('expected inherited getter');
    voice.body[0].props = { value: "'changed'" };
    release?.();
    const trace = await running;
    expect(stdout(trace)).toEqual(['woof', 'woof', '2', '9']);
    expect(trace.completion).toEqual({ kind: 'return', value: 12 });
  });

  test('allows an unrelated direct class constructor beside constructorless inheritance', () => {
    const env = inheritanceEnv({}, ({ classes, scope }) => {
      classes.set('Box', {
        constructor: {
          body: [{ type: 'assign', props: { target: 'this.value', value: 'value' } }],
          name: 'constructor',
          ownerClass: 'Box',
          params: ['value'],
        },
        fields: [{ name: 'value' }],
        getters: new Map(),
        methods: new Map(),
        module: scope,
        name: 'Box',
      });
    });
    expect(selectSourceRunnerEngine(inheritanceProgram, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
  });

  test.each([
    [
      'unknown-base',
      ({ classes }: InheritanceFixture) => {
        const dog = classes.get('Dog');
        if (!dog) throw new Error('expected derived');
        classes.set('Dog', { ...dog, extendsName: 'Missing' });
      },
    ],
    [
      'empty-base-name',
      ({ classes }: InheritanceFixture) => {
        const dog = classes.get('Dog');
        if (!dog) throw new Error('expected derived');
        classes.set('Dog', { ...dog, extendsName: '' });
      },
    ],
    [
      'cyclic',
      ({ classes }: InheritanceFixture) => {
        const animal = classes.get('Animal');
        if (!animal) throw new Error('expected base');
        classes.set('Animal', { ...animal, extendsName: 'Dog' });
      },
    ],
    [
      'cross-module',
      ({ classes }: InheritanceFixture) => {
        const animal = classes.get('Animal');
        if (!animal) throw new Error('expected base');
        classes.set('Animal', {
          ...animal,
          module: { classes: new Map(), functions: new Map() },
        });
      },
    ],
  ] as const)('routes malformed %s lineage metadata to compatibility before provider dispatch', (_label, adjust) => {
    let providerCalls = 0;
    const env = inheritanceEnv({ capabilities: { storage: { get: () => ++providerCalls } } }, adjust);
    const nodes = [{ type: 'capability', props: { namespace: 'storage', operation: 'get' } }, ...inheritanceProgram];
    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test('routes a class-binding identity replaced after linker ownership to compatibility', () => {
    let providerCalls = 0;
    const env = inheritanceEnv({ capabilities: { storage: { get: () => ++providerCalls } } });
    const animal = env.runnerClasses?.get('Animal');
    if (!animal) throw new Error('expected base');
    env.runnerClasses?.set('Animal', { ...animal });
    expect(() => assertInternalMachineClassGraph(env)).toThrow(/not linker-owned/);
    const nodes = [{ type: 'capability', props: { namespace: 'storage', operation: 'get' } }, ...inheritanceProgram];
    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test.each([
    [
      'impure base field initializer',
      ({ classes }: InheritanceFixture) => {
        const animal = classes.get('Animal');
        if (!animal) throw new Error('expected base');
        classes.set('Animal', {
          ...animal,
          fields: animal.fields.map((field) => (field.name === 'base' ? { ...field, value: 'remoteValue()' } : field)),
        });
      },
    ],
    [
      'local member kind conflict',
      ({ classes }: InheritanceFixture) => {
        const dog = classes.get('Dog');
        if (!dog) throw new Error('expected derived');
        classes.set('Dog', {
          ...dog,
          getters: new Map([['sound', member('Dog', 'sound', "'getter'")]]),
        });
      },
    ],
    [
      'inherited member kind conflict',
      ({ classes }: InheritanceFixture) => {
        const dog = classes.get('Dog');
        if (!dog) throw new Error('expected derived');
        classes.set('Dog', {
          ...dog,
          fields: dog.fields.filter((field) => field.name !== 'sound'),
          getters: new Map([['sound', member('Dog', 'sound', "'getter'")]]),
        });
      },
    ],
    [
      'method arity drift',
      ({ classes }: InheritanceFixture) => {
        const dog = classes.get('Dog');
        if (!dog) throw new Error('expected derived');
        classes.set('Dog', {
          ...dog,
          methods: new Map([...dog.methods, ['kind', member('Dog', 'kind', '2', ['unused'])]]),
        });
      },
    ],
  ] as const)('routes %s to compatibility before provider dispatch', (_label, adjust) => {
    let providerCalls = 0;
    const env = inheritanceEnv({ capabilities: { storage: { get: () => ++providerCalls } } }, adjust);
    const nodes = [{ type: 'capability', props: { namespace: 'storage', operation: 'get' } }, ...inheritanceProgram];
    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test('owns nested inherited dispatch in a scalar expression', () => {
    let providerCalls = 0;
    const env = inheritanceEnv({ capabilities: { storage: { get: () => ++providerCalls } } });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'dog', value: 'new Dog()' } },
      { type: 'return', props: { value: 'dog.voice + "!"' } },
    ];
    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 'woof!',
    });
    expect(providerCalls).toBe(1);
  });

  test('keeps nested inherited field reads deferred before provider execution', () => {
    let providerCalls = 0;
    const env = inheritanceEnv({ capabilities: { storage: { get: () => ++providerCalls } } });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'dog', value: 'new Dog()' } },
      {
        type: 'if',
        props: { cond: 'true' },
        children: [{ type: 'print', props: { value: 'dog.base' } }],
      },
    ];
    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });
});
