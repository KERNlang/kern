import {
  bindInternalReferenceTraceRetention,
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassInstanceValue,
  type RunnerModuleScope,
} from '../src/ir/semantics/index.js';
import {
  internalExecutionInterceptorKey,
  internalExecutionSchedulerKey,
} from '../src/ir/semantics/semantic-env-ownership.js';
import { markRunnerMachineClassBinding, markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import {
  runInternalLegacyEngineAsync,
  runInternalLegacyEngineSync,
} from '../src/runtime-envelope/internal-legacy-engine.js';
import { retainInternalRuntimeSchedulerDerivation } from '../src/runtime-envelope/internal-scheduler.js';
import type { IRNode } from '../src/types.js';

function aliasMutationFixture(
  body: readonly IRNode[] = [
    { type: 'assign', props: { target: 'alias.value', value: '2' } },
    { type: 'return', props: { value: 'alias.value' } },
  ],
): {
  readonly caller: ReturnType<typeof makeEnv>;
  readonly nodes: readonly IRNode[];
  readonly receiver: RunnerClassInstanceValue;
} {
  const method = {
    body,
    name: 'touch',
    ownerClass: 'Box',
    params: ['alias'],
  } as const;
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const module: RunnerModuleScope = { classes, functions };
  const boxClass: RunnerClassBinding = {
    fields: [{ name: 'value', value: '1' }],
    getters: new Map(),
    methods: new Map([['touch', method]]),
    module,
    name: 'Box',
  };
  markRunnerMachineClassBinding(boxClass);
  classes.set('Box', boxClass);
  markRunnerMachineRootScope(module);
  const caller = makeEnv({
    bindings: new Map([
      [
        'box',
        {
          __kernRunnerClassInstance: true,
          className: 'Box',
          fields: { value: 1 },
          module,
        } satisfies RunnerClassInstanceValue,
      ],
    ]),
    runnerClasses: classes,
    runnerFunctions: functions,
  });
  return {
    caller,
    nodes: [{ type: 'return', props: { value: 'box.touch(box)' } }],
    receiver: caller.bindings.get('box') as RunnerClassInstanceValue,
  };
}

describe('execution-context isolation review hardening', () => {
  test('validates only the quarantined clone of a stateful proxy graph', () => {
    let descriptorReads = 0;
    const payload = new Proxy(Object.create(null) as Record<string, unknown>, {
      getOwnPropertyDescriptor: (_target, key) => {
        if (key !== 'value') return undefined;
        descriptorReads += 1;
        return {
          configurable: true,
          enumerable: true,
          value: descriptorReads === 1 ? 1 : () => 2,
          writable: true,
        };
      },
      getPrototypeOf: () => null,
      ownKeys: () => ['value'],
    });
    const caller = makeEnv();
    caller.bindings.set('payload', payload);

    const execution = bindInternalReferenceTraceRetention(caller, 'observable-only');
    expect(execution.bindings.get('payload')).toEqual({ value: 1 });
    expect(descriptorReads).toBe(1);
  });

  test('uses captured Map and Set operations after prototype replacement', () => {
    const caller = makeEnv({
      bindings: new Map<string, unknown>([
        ['map', new Map([['answer', 42]])],
        ['set', new Set(['answer'])],
      ]),
    });
    const mapIteratorPrototype = Object.getPrototypeOf(new Map().entries()) as object;
    const setIteratorPrototype = Object.getPrototypeOf(new Set().values()) as object;
    const replacements: readonly [object, PropertyKey, PropertyDescriptor][] = [
      [Map.prototype, 'entries', Object.getOwnPropertyDescriptor(Map.prototype, 'entries')!],
      [Map.prototype, 'set', Object.getOwnPropertyDescriptor(Map.prototype, 'set')!],
      [Set.prototype, 'values', Object.getOwnPropertyDescriptor(Set.prototype, 'values')!],
      [Set.prototype, 'add', Object.getOwnPropertyDescriptor(Set.prototype, 'add')!],
      [mapIteratorPrototype, 'next', Object.getOwnPropertyDescriptor(mapIteratorPrototype, 'next')!],
      [setIteratorPrototype, 'next', Object.getOwnPropertyDescriptor(setIteratorPrototype, 'next')!],
    ];
    let poisonedCalls = 0;
    try {
      for (const [owner, key, descriptor] of replacements) {
        Object.defineProperty(owner, key, {
          ...descriptor,
          value: function poisonedCollectionOperation(): never {
            poisonedCalls += 1;
            throw new Error('poisoned collection operation ran');
          },
        });
      }
      const execution = bindInternalReferenceTraceRetention(caller, 'observable-only');
      expect((execution.bindings.get('map') as Map<string, number>).get('answer')).toBe(42);
      expect((execution.bindings.get('set') as Set<string>).has('answer')).toBe(true);
      expect(poisonedCalls).toBe(0);
    } finally {
      for (const [owner, key, descriptor] of replacements) Object.defineProperty(owner, key, descriptor);
    }
  });

  test('sync and async receiver aliases poison mutation audits and roll back', async () => {
    const sync = aliasMutationFixture();
    expect(() => runInternalLegacyEngineSync(sync.nodes, sync.caller, 'observable-only')).toThrow(
      /mutated instance state|Preconditions failed/u,
    );
    expect(sync.receiver.fields.value).toBe(1);

    const asyncFixture = aliasMutationFixture();
    await expect(
      runInternalLegacyEngineAsync(asyncFixture.nodes, asyncFixture.caller, {}, 'observable-only'),
    ).rejects.toThrow(/mutated instance state|Preconditions failed/u);
    expect(asyncFixture.receiver.fields.value).toBe(1);
  });

  test('a caught receiver-alias write still poisons the owning audit', () => {
    const fixture = aliasMutationFixture([
      {
        type: 'try',
        children: [
          { type: 'assign', props: { target: 'alias.value', value: '2' } },
          { type: 'catch', props: { name: 'error' }, children: [] },
        ],
      },
      { type: 'return', props: { value: 'alias.value' } },
    ]);
    expect(() => runInternalLegacyEngineSync(fixture.nodes, fixture.caller, 'observable-only')).toThrow(
      /mutated instance state|Preconditions failed/u,
    );
    expect(fixture.receiver.fields.value).toBe(1);
  });

  test('retention and derivation do not associate an unassociated caller', () => {
    const caller = makeEnv();
    expect(internalExecutionSchedulerKey(caller)).toBeUndefined();
    expect(internalExecutionInterceptorKey(caller)).toBeUndefined();

    const release = retainInternalRuntimeSchedulerDerivation(caller);
    release();
    expect(internalExecutionSchedulerKey(caller)).toBeUndefined();
    expect(internalExecutionInterceptorKey(caller)).toBeUndefined();

    const execution = bindInternalReferenceTraceRetention(caller, 'observable-only');
    expect(internalExecutionSchedulerKey(caller)).toBeUndefined();
    expect(internalExecutionInterceptorKey(caller)).toBeUndefined();
    expect(internalExecutionSchedulerKey(execution)).toBeDefined();
    expect(internalExecutionInterceptorKey(execution)).toBeDefined();
  });
});
