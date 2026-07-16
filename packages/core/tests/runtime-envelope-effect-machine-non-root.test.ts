import { hasStableOwnedEnvironmentChain } from '../src/ir/semantics/internal-effect-machine-admission.js';
import { childEnv, defineBinding, makeEnv, type SemanticEnv } from '../src/ir/semantics/semantic-env.js';
import {
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  SOURCE_RUNNER_ENGINE,
  selectSourceRunnerEngine,
} from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';

const parentRead: readonly IRNode[] = [{ type: 'return', props: { value: 'outer' } }];

function authenticChild(root: SemanticEnv = makeEnv({ bindings: new Map([['outer', 1]]) })): SemanticEnv {
  return childEnv(root);
}

describe('source runner non-root environment ownership', () => {
  test('selects and executes an authentic child through sync and async source APIs', async () => {
    const syncEnv = authenticChild();
    expect(selectSourceRunnerEngine(parentRead, syncEnv, {})).toBe(SOURCE_RUNNER_ENGINE.machine);
    expect(executeSourceRunnerSync(parentRead, syncEnv, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 1,
    });

    const asyncEnv = authenticChild();
    expect((await executeSourceRunnerAsync(parentRead, asyncEnv, { policy: 'machine-only' })).completion).toEqual({
      kind: 'return',
      value: 1,
    });
  });

  test('preserves multi-level lexical reads, shadowing, local declarations, and exact ancestor writes', () => {
    const root = makeEnv({
      bindings: new Map<string, unknown>([
        ['counter', 1],
        ['label', 'root'],
      ]),
    });
    const middle = childEnv(root);
    defineBinding(middle, 'label', 'middle');
    const entry = childEnv(middle);
    const nodes: readonly IRNode[] = [
      { type: 'let', props: { name: 'seen', value: 'label' } },
      { type: 'assign', props: { target: 'counter', value: 'counter + 1' } },
      { type: 'let', props: { name: 'label', value: '"entry"' } },
      { type: 'return', props: { value: 'seen' } },
    ];

    expect(executeSourceRunnerSync(nodes, entry, { policy: 'machine-only' }).completion).toEqual({
      kind: 'return',
      value: 'middle',
    });
    expect(root.bindings.get('counter')).toBe(2);
    expect(root.bindings.get('label')).toBe('root');
    expect(middle.bindings.get('label')).toBe('middle');
    expect(entry.bindings.get('label')).toBe('entry');
    expect(entry.bindings.get('seen')).toBe('middle');
  });

  test('rejects a replaced, spliced, or cyclic parent edge', () => {
    const root = makeEnv({ bindings: new Map([['outer', 1]]) });
    const other = makeEnv({ bindings: new Map([['outer', 2]]) });

    const replaced = childEnv(root);
    replaced.parent = other;
    expect(selectSourceRunnerEngine(parentRead, replaced, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);

    const spliced = childEnv(childEnv(root));
    spliced.parent = childEnv(other);
    expect(selectSourceRunnerEngine(parentRead, spliced, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);

    const cyclic = childEnv(root);
    cyclic.parent = cyclic;
    expect(selectSourceRunnerEngine(parentRead, cyclic, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });

  test('rejects environment accessors without invoking them', () => {
    const child = authenticChild();
    const originalBindings = child.bindings;
    let accessorCalls = 0;
    Object.defineProperty(child, 'bindings', {
      configurable: true,
      enumerable: true,
      get: () => {
        accessorCalls += 1;
        return originalBindings;
      },
    });

    expect(selectSourceRunnerEngine(parentRead, child, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(accessorCalls).toBe(0);
  });

  test.each([
    'parent',
    'bindings',
    'intProvenance',
    'freshArrayBindings',
    'pushBuiltFreshArrayBindings',
    'capturedArrayBindings',
    'recordArrayFields',
    'runnerFunctions',
    'runnerClasses',
    'runnerCallStack',
    'runnerCallCache',
    'runnerThis',
    'runnerSuperClass',
    'runnerProtectedClassInstances',
    'capabilities',
    'capabilityContext',
    'seed',
    'now',
  ] as const)('rejects an accessor-backed %s field without invocation', (field) => {
    const child = authenticChild();
    const original = Object.getOwnPropertyDescriptor(child, field)?.value;
    let accessorCalls = 0;
    Object.defineProperty(child, field, {
      configurable: true,
      enumerable: true,
      get: () => {
        accessorCalls += 1;
        return original;
      },
    });

    expect(selectSourceRunnerEngine(parentRead, child, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(accessorCalls).toBe(0);
  });

  test('rejects inherited parent replacement without invoking it', () => {
    const child = authenticChild();
    let accessorCalls = 0;
    Reflect.deleteProperty(child, 'parent');
    Object.setPrototypeOf(child, {
      get parent() {
        accessorCalls += 1;
        return undefined;
      },
    });

    expect(selectSourceRunnerEngine(parentRead, child, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(accessorCalls).toBe(0);
  });

  test('rejects an accessor on a non-adjacent ancestor before coherence reads it', () => {
    const root = makeEnv({ bindings: new Map([['outer', 1]]) });
    const entry = childEnv(childEnv(root));
    const capabilities = root.capabilities;
    let accessorCalls = 0;
    Object.defineProperty(root, 'capabilities', {
      configurable: true,
      enumerable: true,
      get: () => {
        accessorCalls += 1;
        return capabilities;
      },
    });

    expect(selectSourceRunnerEngine(parentRead, entry, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
    expect(accessorCalls).toBe(0);
  });

  test('rejects falsy runtime inputs in the exported resume predicate', () => {
    expect(hasStableOwnedEnvironmentChain(undefined as unknown as SemanticEnv)).toBe(false);
    expect(hasStableOwnedEnvironmentChain(null as unknown as SemanticEnv)).toBe(false);
  });

  test('rejects analysis-style children, unowned values, non-empty call state, and active class frames', () => {
    const rawParent = { ...makeEnv({ bindings: new Map([['outer', 1]]) }) } as SemanticEnv;
    expect(selectSourceRunnerEngine(parentRead, childEnv(rawParent), {})).toBe(SOURCE_RUNNER_ENGINE.legacy);

    const unowned = authenticChild();
    unowned.bindings.set('bad', []);
    expect(selectSourceRunnerEngine(parentRead, unowned, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);

    const activeCall = authenticChild(makeEnv({ runnerCallStack: ['helper'] }));
    expect(selectSourceRunnerEngine(parentRead, activeCall, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);

    const receiver = { __kernRunnerClassInstance: true, className: 'Box', fields: {} } as const;
    const activeClass = authenticChild(makeEnv({ runnerThis: receiver }));
    expect(selectSourceRunnerEngine(parentRead, activeClass, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });

  test('rejects coherent-looking but divergent child graph fields', () => {
    const functions = new Map();
    const root = makeEnv({ bindings: new Map([['outer', 1]]), runnerFunctions: functions });
    const child = childEnv(root);
    const other = makeEnv({ runnerFunctions: new Map() });
    child.runnerFunctions = other.runnerFunctions;

    expect(selectSourceRunnerEngine(parentRead, child, {})).toBe(SOURCE_RUNNER_ENGINE.legacy);
  });

  test('fails closed when a provider reparents the entry before machine resume', async () => {
    const root = makeEnv({ bindings: new Map([['outer', 1]]) });
    const child = childEnv(root);
    const other = makeEnv({ bindings: new Map([['outer', 99]]) });
    let providerCalls = 0;
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { name: 'ignored', namespace: 'llm', operation: 'complete' } },
      { type: 'return', props: { value: 'outer' } },
    ];

    await expect(
      executeSourceRunnerAsync(nodes, child, {
        asyncCapabilities: {
          llm: {
            complete: async () => {
              providerCalls += 1;
              child.parent = other;
              return 0;
            },
          },
        },
        policy: 'machine-only',
      }),
    ).rejects.toThrow();
    expect(providerCalls).toBe(1);
    expect(root.bindings.get('outer')).toBe(1);
  });

  test('revalidates after a synchronous provider before resuming the machine', () => {
    let providerCalls = 0;
    let child: SemanticEnv;
    const root = makeEnv({
      bindings: new Map([['outer', 1]]),
      capabilities: {
        storage: {
          get: () => {
            providerCalls += 1;
            child.bindings = makeEnv().bindings;
            return 0;
          },
        },
      },
    });
    child = childEnv(root);
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
      { type: 'return', props: { value: 'outer' } },
    ];

    expect(() => executeSourceRunnerSync(nodes, child, { policy: 'machine-only' })).toThrow();
    expect(providerCalls).toBe(1);
  });

  test('preserves live portable parent mutation across async suspension', async () => {
    const root = makeEnv({ bindings: new Map([['outer', 1]]) });
    const child = childEnv(root);
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { name: 'ignored', namespace: 'llm', operation: 'complete' } },
      { type: 'return', props: { value: 'outer' } },
    ];
    const trace = await executeSourceRunnerAsync(nodes, child, {
      asyncCapabilities: {
        llm: {
          complete: async () => {
            root.bindings.set('outer', 2);
            return 0;
          },
        },
      },
      policy: 'machine-only',
    });

    expect(trace.completion).toEqual({ kind: 'return', value: 2 });
  });

  test('isolates overlapping async runs on independent child chains', async () => {
    const run = async (value: number) => {
      const root = makeEnv({ bindings: new Map([['outer', value]]) });
      const child = childEnv(root);
      return executeSourceRunnerAsync(
        [
          { type: 'capability', props: { name: 'ignored', namespace: 'llm', operation: 'complete' } },
          { type: 'return', props: { value: 'outer' } },
        ],
        child,
        {
          asyncCapabilities: { llm: { complete: async () => Promise.resolve(0) } },
          policy: 'machine-only',
        },
      );
    };

    const [left, right] = await Promise.all([run(1), run(2)]);
    expect(left.completion).toEqual({ kind: 'return', value: 1 });
    expect(right.completion).toEqual({ kind: 'return', value: 2 });
  });
});
