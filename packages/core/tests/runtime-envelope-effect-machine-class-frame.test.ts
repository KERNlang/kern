import { internalEffectMachineStateForEnv } from '../src/ir/semantics/internal-effect-machine-helper-state.js';
import { markRunnerMachineClassBinding, markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import {
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassMemberBinding,
  type RunnerModuleScope,
  type SemanticEnv,
} from '../src/ir/semantics/semantic-env.js';
import { KernCapabilityError } from '../src/runner-capabilities.js';
import {
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';

interface FrameClassOptions {
  readonly capabilities?: SemanticEnv['capabilities'];
  readonly constructorBody?: readonly IRNode[];
  readonly fields?: RunnerClassBinding['fields'];
  readonly getterBody?: readonly IRNode[];
  readonly methodBody?: readonly IRNode[];
}

function classMember(name: string, body: readonly IRNode[], params: readonly string[] = []): RunnerClassMemberBinding {
  return { body, name, ownerClass: 'Box', params };
}

function frameClassEnv(options: FrameClassOptions = {}): SemanticEnv {
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const scope: RunnerModuleScope = { classes, functions };
  const box: RunnerClassBinding = {
    constructor: classMember(
      'constructor',
      options.constructorBody ?? [{ type: 'assign', props: { target: 'this.value', value: 'value' } }],
      ['value'],
    ),
    fields: options.fields ?? [
      { name: 'value', value: '0' },
      { name: 'visits', value: '0' },
    ],
    getters: options.getterBody ? new Map([['remote', classMember('remote', options.getterBody)]]) : new Map(),
    methods: options.methodBody ? new Map([['read', classMember('read', options.methodBody)]]) : new Map(),
    module: scope,
    name: 'Box',
  };
  markRunnerMachineClassBinding(box);
  classes.set('Box', box);
  markRunnerMachineRootScope(scope);
  return makeEnv({
    capabilities: options.capabilities,
    runnerCallCache: new Map(),
    runnerCallStack: [],
    runnerClasses: classes,
    runnerFunctions: functions,
  });
}

describe('M3.31a resumable same-root class frames', () => {
  test('resumes a sync constructor without replaying pre-yield receiver mutation', () => {
    let providerCalls = 0;
    const env = frameClassEnv({
      capabilities: {
        storage: {
          get: () => {
            providerCalls += 1;
            return 40;
          },
        },
      },
      constructorBody: [
        { type: 'assign', props: { target: 'this.visits', value: 'this.visits + 1' } },
        { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
        { type: 'assign', props: { target: 'this.value', value: 'answer' } },
        { type: 'assign', props: { target: 'this.visits', value: 'this.visits + 1' } },
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(0)' } },
      { type: 'return', props: { value: 'box.value + box.visits' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 42,
    });
    expect(providerCalls).toBe(1);
  });

  test('preserves left-to-right binary invocation order without replaying a completed sibling', () => {
    const answers = [10, 20];
    let providerCalls = 0;
    const env = frameClassEnv({
      capabilities: {
        storage: {
          get: () => {
            providerCalls += 1;
            return answers.shift();
          },
        },
      },
      methodBody: [
        { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
        { type: 'return', props: { value: 'this.value + answer' } },
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(2)' } },
      { type: 'return', props: { value: 'box.read() + box.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 34,
    });
    expect(providerCalls).toBe(2);
    expect(answers).toEqual([]);
  });

  test('composes class frames through constructor arguments, templates, lazy conditionals, and short circuits', () => {
    const answers = [2, 3];
    let providerCalls = 0;
    const env = frameClassEnv({
      capabilities: {
        storage: {
          get: () => {
            providerCalls += 1;
            return answers.shift();
          },
        },
      },
      methodBody: [
        { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
        { type: 'return', props: { value: 'this.value + answer' } },
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'let', props: { name: 'second', value: 'new Box(box.read())' } },
      {
        type: 'return',
        props: { value: '`second=${false ? box.read() : second.value};lazy=${true || box.read()};last=${box.read()}`' },
      },
    ];

    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 'second=3;lazy=true;last=4',
    });
    expect(providerCalls).toBe(2);
    expect(answers).toEqual([]);
  });

  test('uses a suspended constructor argument in a later pure field expression', () => {
    let providerCalls = 0;
    const env = frameClassEnv({
      capabilities: {
        storage: {
          get: () => {
            providerCalls += 1;
            return 2;
          },
        },
      },
      methodBody: [
        { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
        { type: 'return', props: { value: 'this.value + answer' } },
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'let', props: { name: 'second', value: 'new Box(box.read())' } },
      { type: 'return', props: { value: 'second.value + 1' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 4,
    });
    expect(providerCalls).toBe(1);
  });

  test('isolates async getter activations across overlapping runs', async () => {
    const getterBody: readonly IRNode[] = [
      {
        type: 'capability',
        props: { input: '{ prompt: this.value }', name: 'answer', namespace: 'llm', operation: 'complete' },
      },
      { type: 'return', props: { value: 'this.value + answer' } },
    ];
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(seed)' } },
      { type: 'return', props: { value: 'box.remote' } },
    ];
    const firstEnv = frameClassEnv({ getterBody });
    firstEnv.bindings.set('seed', 1);
    const secondEnv = frameClassEnv({ getterBody });
    secondEnv.bindings.set('seed', 2);
    const first = executeSourceRunnerAsync(nodes, firstEnv, {
      asyncCapabilities: { llm: { complete: async () => 10 } },
      policy: 'machine-only',
    });
    const second = executeSourceRunnerAsync(nodes, secondEnv, {
      asyncCapabilities: { llm: { complete: async () => 20 } },
      policy: 'machine-only',
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.completion).toEqual({ kind: 'return', value: 11 });
    expect(secondResult.completion).toEqual({ kind: 'return', value: 22 });
  });

  test('injects provider rejection once, restores private machine state, and never retries compatibility', async () => {
    const failure = new Error('provider rejected once');
    let calls = 0;
    const methodBody: readonly IRNode[] = [
      {
        type: 'capability',
        props: { input: '{ prompt: this.value }', name: 'answer', namespace: 'llm', operation: 'complete' },
      },
      { type: 'return', props: { value: 'answer' } },
    ];
    const env = frameClassEnv({ methodBody });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'return', props: { value: 'box.read()' } },
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

    const healthy = await executeSourceRunnerAsync(nodes, frameClassEnv({ methodBody }), {
      asyncCapabilities: { llm: { complete: async () => 7 } },
      policy: 'machine-only',
    });
    expect(healthy.completion).toEqual({ kind: 'return', value: 7 });
  });

  test('rejects an uninitialized member field before provider dispatch', () => {
    let providerCalls = 0;
    const env = frameClassEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      constructorBody: [],
      fields: [{ name: 'value' }],
      methodBody: [
        { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
        { type: 'return', props: { value: 'this.value' } },
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'return', props: { value: 'box.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test('accepts an uninitialized field after a definite constructor assignment', () => {
    let providerCalls = 0;
    const env = frameClassEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      fields: [{ name: 'value' }],
      methodBody: [
        { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
        { type: 'return', props: { value: 'this.value' } },
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(3)' } },
      { type: 'return', props: { value: 'box.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 3,
    });
    expect(providerCalls).toBe(1);
  });

  test('rejects an unsupported inactive descendant before an earlier provider executes', () => {
    let providerCalls = 0;
    const env = frameClassEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      methodBody: [{ type: 'return', props: { value: 'this.value' } }],
    });
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'return', props: { value: 'true ? box.read() : box.read?.()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test('requires and consumes the caller-owned iteration budget for class-body loops', () => {
    const env = frameClassEnv({
      methodBody: [
        { type: 'let', props: { name: 'index', value: '0' } },
        {
          type: 'while',
          props: { cond: 'index < 2' },
          children: [{ type: 'assign', props: { target: 'index', value: 'index + 1' } }],
        },
        { type: 'return', props: { value: 'this.value + index' } },
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(3)' } },
      { type: 'return', props: { value: 'box.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(selectSourceRunnerEngine(nodes, env, { iterationBudget: 2 })).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { iterationBudget: 2, policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 5,
    });
  });

  test('rejects constructor control flow that could complete abnormally through mutated receiver state', () => {
    const env = frameClassEnv({
      constructorBody: [
        { type: 'assign', props: { target: 'this.value', value: 'value' } },
        {
          type: 'if',
          props: { cond: 'this.value > 0' },
          children: [{ type: 'return', props: { value: 'this.value' } }],
        },
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'return', props: { value: 'box.value' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });

  test('keeps multi-statement class calls in assignment values on compatibility before dispatch', () => {
    let providerCalls = 0;
    const env = frameClassEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      methodBody: [
        { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
        { type: 'return', props: { value: 'answer' } },
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'let', props: { name: 'result', value: '0' } },
      { type: 'assign', props: { target: 'result', value: 'box.read()' } },
      { type: 'return', props: { value: 'result' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });

  test.each([
    'this.value.extra',
    'this.missing',
  ])('rejects malformed or unavailable class assignment target %s before provider dispatch', (target) => {
    let providerCalls = 0;
    const env = frameClassEnv({
      capabilities: { storage: { get: () => ++providerCalls } },
      constructorBody: [
        { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
        { type: 'assign', props: { target, value: 'answer' } },
      ],
    });
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box(1)' } },
      { type: 'return', props: { value: 'box.value' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(providerCalls).toBe(0);
  });
});
