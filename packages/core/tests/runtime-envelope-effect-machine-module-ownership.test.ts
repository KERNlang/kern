import { isInternalMachineResumableHelperCall } from '../src/ir/semantics/internal-effect-machine-helper-contract.js';
import { bindInternalEffectMachineState } from '../src/ir/semantics/internal-effect-machine-helper-state.js';
import { markRunnerMachineClassBinding, markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import {
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassMemberBinding,
  type RunnerFunctionBinding,
  type RunnerModuleScope,
} from '../src/ir/semantics/semantic-env.js';
import {
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';

function moduleScope(): RunnerModuleScope {
  return { classes: new Map(), functions: new Map() };
}

function addHelper(
  scope: RunnerModuleScope,
  name: string,
  body: readonly IRNode[],
  params: readonly string[] = [],
  returns: unknown = 'number',
): RunnerFunctionBinding {
  const binding: RunnerFunctionBinding = { body, module: scope, name, params, returns };
  scope.functions.set(name, binding);
  return binding;
}

function classMember(
  ownerClass: string,
  name: string,
  body: readonly IRNode[],
  params: readonly string[] = [],
): RunnerClassMemberBinding {
  return { body, name, ownerClass, params };
}

function addClass(
  scope: RunnerModuleScope,
  name: string,
  options: {
    readonly constructor?: RunnerClassMemberBinding;
    readonly fields?: RunnerClassBinding['fields'];
    readonly getters?: ReadonlyMap<string, RunnerClassMemberBinding>;
    readonly methods?: ReadonlyMap<string, RunnerClassMemberBinding>;
  } = {},
): RunnerClassBinding {
  const binding: RunnerClassBinding = {
    constructor: Object.hasOwn(options, 'constructor') ? options.constructor : undefined,
    fields: options.fields ?? [],
    getters: new Map(options.getters),
    methods: new Map(options.methods),
    module: scope,
    name,
  };
  markRunnerMachineClassBinding(binding);
  scope.classes.set(name, binding);
  return binding;
}

function linkedEnv(root: RunnerModuleScope, capabilities?: Parameters<typeof makeEnv>[0]['capabilities']) {
  markRunnerMachineRootScope(root);
  return makeEnv({
    capabilities,
    runnerCallCache: new Map(),
    runnerCallStack: [],
    runnerClasses: root.classes,
    runnerFunctions: root.functions,
  });
}

describe('M3.31c module-owned helper and class identity', () => {
  test('executes an imported helper alias in its defining private helper scope', () => {
    const remote = moduleScope();
    addHelper(remote, 'value', [{ type: 'return', props: { value: '40' } }]);
    const remoteRead = addHelper(remote, 'read', [{ type: 'return', props: { value: 'value() + 2' } }]);
    const root = moduleScope();
    addHelper(root, 'value', [{ type: 'return', props: { value: '1' } }]);
    root.functions.set('remoteRead', remoteRead);
    const env = linkedEnv(root);
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'remoteRead() + value()' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 43,
    });
  });

  test('requires a budget for a private helper reached through an imported helper class', () => {
    const remote = moduleScope();
    addHelper(
      remote,
      'spin',
      [
        { type: 'let', props: { name: 'value', value: '0' } },
        {
          type: 'while',
          props: { cond: 'value < limit' },
          children: [{ type: 'assign', props: { target: 'value', value: 'value + 1' } }],
        },
        { type: 'return', props: { value: 'value' } },
      ],
      ['limit'],
    );
    const read = classMember('PrivateBox', 'read', [{ type: 'return', props: { value: 'spin(1)' } }]);
    addClass(remote, 'PrivateBox', { methods: new Map([['read', read]]) });
    const remoteRead = addHelper(remote, 'readRemote', [
      { type: 'let', props: { name: 'box', value: 'new PrivateBox()' } },
      { type: 'return', props: { value: 'box.read()' } },
    ]);
    const root = moduleScope();
    root.functions.set('remoteRead', remoteRead);
    const env = linkedEnv(root);
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'remoteRead()' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(selectSourceRunnerEngine(nodes, env, { iterationBudget: 1 })).toBe(SOURCE_RUNNER_ENGINE.machine);
  });

  test('partitions equal private helper names by defining binding identity', () => {
    const left = moduleScope();
    addHelper(left, 'compute', [{ type: 'return', props: { value: '1' } }], ['value']);
    const leftRead = addHelper(left, 'read', [{ type: 'return', props: { value: 'compute(0)' } }]);
    const right = moduleScope();
    addHelper(right, 'compute', [{ type: 'return', props: { value: '2' } }], ['value']);
    const rightRead = addHelper(right, 'read', [{ type: 'return', props: { value: 'compute(0)' } }]);
    const root = moduleScope();
    root.functions.set('leftRead', leftRead);
    root.functions.set('rightRead', rightRead);
    const env = linkedEnv(root);
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'leftRead() + rightRead()' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 3,
    });
  });

  test('prefers resumable helper binding identity over an equal display name', () => {
    const pureModule = moduleScope();
    addHelper(pureModule, 'h', [{ type: 'return', props: { value: '1' } }]);
    const effectModule = moduleScope();
    const resumable = addHelper(effectModule, 'h', [{ type: 'return', props: { value: '2' } }]);
    const env = makeEnv({ runnerFunctions: pureModule.functions });
    const restore = bindInternalEffectMachineState(env, {
      helperRegistry: pureModule.functions,
      remainingIterations: undefined,
      resumableHelperNames: new Set(['h']),
      resumableHelpers: new Set([resumable]),
    });

    try {
      expect(isInternalMachineResumableHelperCall('h', 0, env)).toBe(false);
    } finally {
      restore();
    }
  });

  test('does not classify an equal-name pure helper as resumable by display name', async () => {
    const effectModule = moduleScope();
    const effectfulRead = classMember('EffectBox', 'read', [
      { type: 'capability', props: { input: '"remote"', name: 'answer', namespace: 'llm', operation: 'complete' } },
      { type: 'return', props: { value: 'answer' } },
    ]);
    addClass(effectModule, 'EffectBox', { methods: new Map([['read', effectfulRead]]) });
    const resumable = addHelper(
      effectModule,
      'h',
      [
        { type: 'let', props: { name: 'box', value: 'new EffectBox()' } },
        { type: 'return', props: { value: 'box.read() + String(value)' } },
      ],
      ['value'],
      'string',
    );

    const pureModule = moduleScope();
    const pure = addHelper(pureModule, 'h', [{ type: 'return', props: { value: '1' } }]);
    const root = moduleScope();
    root.functions.set('aH', resumable);
    root.functions.set('h', pure);
    const combine = classMember('RootBox', 'combine', [{ type: 'return', props: { value: 'aH(h())' } }]);
    addClass(root, 'RootBox', { methods: new Map([['combine', combine]]) });
    const env = linkedEnv(root);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new RootBox()' } },
      { type: 'return', props: { value: 'box.combine()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    await expect(
      executeSourceRunnerAsync(nodes, env, {
        asyncCapabilities: { llm: { complete: async () => 'owned:' } },
        policy: 'machine-only',
      }),
    ).resolves.toEqual(expect.objectContaining({ completion: { kind: 'return', value: 'owned:1' } }));
  });

  test('suspends in an imported class alias and dispatches through its defining module', async () => {
    const remote = moduleScope();
    addHelper(remote, 'suffix', [{ type: 'return', props: { value: '"remote"' } }], [], 'string');
    const read = classMember('Box', 'read', [
      { type: 'capability', props: { input: '"remote"', name: 'answer', namespace: 'llm', operation: 'complete' } },
      { type: 'return', props: { value: 'answer + ":" + suffix()' } },
    ]);
    const remoteBox = addClass(remote, 'Box', { methods: new Map([['read', read]]) });
    const root = moduleScope();
    addHelper(root, 'suffix', [{ type: 'return', props: { value: '"root"' } }], [], 'string');
    root.classes.set('RemoteBox', remoteBox);
    const env = linkedEnv(root);
    let providerCalls = 0;
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new RemoteBox()' } },
      { type: 'return', props: { value: 'box.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    await expect(
      executeSourceRunnerAsync(nodes, env, {
        asyncCapabilities: {
          llm: {
            complete: async () => {
              providerCalls += 1;
              return 'owned';
            },
          },
        },
        policy: 'machine-only',
      }),
    ).resolves.toEqual(expect.objectContaining({ completion: { kind: 'return', value: 'owned:remote' } }));
    expect(providerCalls).toBe(1);
  });

  test('does not resolve an imported class field initializer from the caller module', () => {
    const remote = moduleScope();
    const remoteBox = addClass(remote, 'Box', { fields: [{ name: 'value', value: 'secret' }] });
    const root = moduleScope();
    root.classes.set('RemoteBox', remoteBox);
    const env = linkedEnv(root);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'secret', value: '99' } },
      { type: 'let', props: { name: 'box', value: 'new RemoteBox()' } },
      { type: 'return', props: { value: 'box.value' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });

  test('does not confuse equal class member labels across defining modules', () => {
    const remote = moduleScope();
    const remoteReadMember = classMember('Box', 'read', [{ type: 'return', props: { value: '2' } }]);
    addClass(remote, 'Box', { methods: new Map([['read', remoteReadMember]]) });
    const remoteRead = addHelper(remote, 'remoteRead', [
      { type: 'let', props: { name: 'box', value: 'new Box()' } },
      { type: 'return', props: { value: 'box.read()' } },
    ]);

    const root = moduleScope();
    root.functions.set('remoteRead', remoteRead);
    const rootReadMember = classMember('Box', 'read', [{ type: 'return', props: { value: 'remoteRead() + 1' } }]);
    addClass(root, 'Box', { methods: new Map([['read', rootReadMember]]) });
    const env = linkedEnv(root);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new Box()' } },
      { type: 'return', props: { value: 'box.read()' } },
    ];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(nodes, env, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 3,
    });
  });

  test('rejects a helper inserted after the linker ownership mark', () => {
    const root = moduleScope();
    addHelper(root, 'safe', [{ type: 'return', props: { value: '1' } }]);
    const env = linkedEnv(root);
    addHelper(root, 'forged', [{ type: 'return', props: { value: '2' } }]);
    const nodes: readonly IRNode[] = [{ type: 'return', props: { value: 'forged()' } }];

    expect(selectSourceRunnerEngine(nodes, env, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });

  test('snapshots an imported private helper across async suspension', async () => {
    const remote = moduleScope();
    const privateValue = addHelper(remote, 'privateValue', [{ type: 'return', props: { value: '41' } }]);
    const read = classMember('Box', 'read', [
      { type: 'capability', props: { input: '"remote"', name: 'answer', namespace: 'llm', operation: 'complete' } },
      { type: 'return', props: { value: 'privateValue() + 1' } },
    ]);
    const remoteBox = addClass(remote, 'Box', { methods: new Map([['read', read]]) });
    const root = moduleScope();
    root.classes.set('RemoteBox', remoteBox);
    const env = linkedEnv(root);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'box', value: 'new RemoteBox()' } },
      { type: 'return', props: { value: 'box.read()' } },
    ];

    await expect(
      executeSourceRunnerAsync(nodes, env, {
        asyncCapabilities: {
          llm: {
            complete: async () => {
              (privateValue.body[0].props as Record<string, unknown>).value = '0';
              return 'ignored';
            },
          },
        },
        policy: 'machine-only',
      }),
    ).resolves.toEqual(expect.objectContaining({ completion: { kind: 'return', value: 42 } }));
  });

  test('rejects an imported alias replaced after linker ownership', () => {
    const remote = moduleScope();
    const read = addHelper(remote, 'read', [{ type: 'return', props: { value: '1' } }]);
    const root = moduleScope();
    root.functions.set('remoteRead', read);
    const env = linkedEnv(root);
    const replacementScope = moduleScope();
    root.functions.set('remoteRead', addHelper(replacementScope, 'read', [{ type: 'return', props: { value: '2' } }]));

    expect(selectSourceRunnerEngine([{ type: 'return', props: { value: 'remoteRead()' } }], env, {})).toBe(
      SOURCE_RUNNER_ENGINE.legacy,
    );
  });
});
