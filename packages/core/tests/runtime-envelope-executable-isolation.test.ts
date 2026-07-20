import { readFileSync } from 'node:fs';
import { CONTRACT_REGISTRY, makeEnv, type NodeContract } from '../src/ir/semantics/index.js';
import {
  runInternalEffectMachineAsync,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import {
  DECIMAL_VALUE_TAG,
  isOwnedDecimalValue,
  makeDecimalValue,
} from '../src/ir/semantics/portable-scalar-domain.js';
import { referenceRunSequence } from '../src/ir/semantics/reference-runner.js';
import { registerAllContracts, resetAllContractRegistration } from '../src/ir/semantics/register-all.js';
import { ownSemanticAtomicValue } from '../src/ir/semantics/semantic-atomic-ownership.js';
import { tracesEqual } from '../src/ir/semantics/trace.js';
import {
  executeInternalRuntimeEnvelopeAsync,
  executeInternalRuntimeEnvelopeSync,
} from '../src/runtime-envelope/execute.js';
import {
  executeInternalRuntimeEnvelopeCompatAsync,
  executeInternalRuntimeEnvelopeCompatSync,
} from '../src/runtime-envelope/execute-compat.js';
import {
  executeInternalRuntimeHandlerAsync,
  executeInternalRuntimeHandlerSync,
} from '../src/runtime-envelope/handler-entry.js';
import {
  executeInternalRuntimeSourceHandlerAsync,
  executeInternalRuntimeSourceHandlerSync,
} from '../src/runtime-envelope/source-handler.js';
import type { InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import type { IRNode } from '../src/types.js';

const limits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxStringBytes: 4_096,
};
const enabled = { enabled: true, limits } as const;

function restoreRegistry(): void {
  CONTRACT_REGISTRY.clear();
  resetAllContractRegistration();
  registerAllContracts();
}

describe('M3.15 executable-envelope isolation', () => {
  afterEach(restoreRegistry);

  const legacyEnvironment = () => makeEnv({ runnerFunctions: new Map([['helper', {}]]) as never });

  test('direct sync/async fail closed on legacy-only input while explicit compat preserves fallback', async () => {
    const nodes: IRNode[] = [
      { type: 'let', props: { name: 'xs', value: '[1]' } },
      { type: 'expression-v1', props: { name: 'res', expr: '1 + 2' } },
      { type: 'return', props: { value: 'res' } },
    ];

    const directSync = executeInternalRuntimeEnvelopeSync(nodes, legacyEnvironment(), enabled);
    const directAsync = await executeInternalRuntimeEnvelopeAsync(nodes, legacyEnvironment(), enabled);
    for (const direct of [directSync, directAsync]) {
      expect(direct).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
    }

    const compatSync = executeInternalRuntimeEnvelopeCompatSync(nodes, legacyEnvironment(), enabled);
    const compatAsync = await executeInternalRuntimeEnvelopeCompatAsync(nodes, legacyEnvironment(), enabled);
    expect(compatSync).toMatchObject({
      completion: { kind: 'return' },
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: '3' } },
    });
    expect(compatAsync).toEqual(compatSync);
  });

  test('direct execution neither requires nor populates the global contract registry', async () => {
    CONTRACT_REGISTRY.clear();
    resetAllContractRegistration();
    const nodes: IRNode[] = [{ type: 'return', props: { value: '42' } }];

    expect(executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), enabled)).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: '42' } },
    });
    expect(await executeInternalRuntimeEnvelopeAsync(nodes, makeEnv(), enabled)).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: '42' } },
    });
    expect(CONTRACT_REGISTRY.size).toBe(0);
  });

  test('poisoned contracts cannot observe or alter any machine-owned operational leaf', async () => {
    CONTRACT_REGISTRY.clear();
    resetAllContractRegistration();
    let touches = 0;
    const poison = (nodeType: string): NodeContract => ({
      completion: () => ({ kind: 'return', value: 999 }),
      effects: () => {
        touches += 1;
        return { completion: { kind: 'return', value: 999 }, events: [] };
      },
      fixtures: [],
      forbiddenRewrites: [],
      nodeType,
      preconditions: () => true,
    });
    for (const type of ['assign', 'break', 'continue', 'fmt', 'let', 'print', 'return', 'throw']) {
      CONTRACT_REGISTRY.set(type, poison(type));
    }

    const cases: readonly IRNode[][] = [
      [
        { type: 'let', props: { name: 'n', value: '1' } },
        { type: 'assign', props: { op: '+=', target: 'n', value: '1' } },
        { type: 'return', props: { value: 'n' } },
      ],
      [
        { type: 'fmt', props: { name: 'message', template: 'value=${2}' } },
        { type: 'print', props: { value: 'message' } },
        { type: 'return', props: { value: 'message' } },
      ],
      [{ type: 'throw', props: { errorKind: 'Error' } }],
      [{ type: 'for', props: { from: '0', name: 'i', to: '1' }, children: [{ type: 'break' }] }],
      [{ type: 'for', props: { from: '0', name: 'i', to: '1' }, children: [{ type: 'continue' }] }],
    ];

    for (const nodes of cases) {
      const sync = executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), enabled);
      const asyncEnvelope = await executeInternalRuntimeEnvelopeAsync(nodes, makeEnv(), enabled);
      expect(asyncEnvelope).toEqual(sync);
    }
    expect(touches).toBe(0);
    expect(CONTRACT_REGISTRY.size).toBe(8);
  });

  test('whole-tree leaf preflight rejects before an earlier capability or environment mutation', async () => {
    let providerCalls = 0;
    const nodes: IRNode[] = [
      {
        type: 'capability',
        props: { name: 'answer', namespace: 'storage', operation: 'get' },
      },
      { type: 'let', props: { name: 'missingInitializer' } },
    ];
    const env = makeEnv({
      bindings: new Map([['untouched', 7]]),
      capabilities: { storage: { get: () => (providerCalls += 1) } },
    });
    const before = [...env.bindings.entries()];

    const sync = executeInternalRuntimeEnvelopeSync(nodes, env, enabled);
    expect(sync).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(providerCalls).toBe(0);
    expect([...env.bindings.entries()]).toEqual(before);

    const asyncEnv = makeEnv({ bindings: new Map(before) });
    const asyncEnvelope = await executeInternalRuntimeEnvelopeAsync(nodes, asyncEnv, enabled, {
      asyncCapabilities: { storage: { get: async () => (providerCalls += 1) } },
    });
    expect(asyncEnvelope).toEqual(sync);
    expect(providerCalls).toBe(0);
    expect([...asyncEnv.bindings.entries()]).toEqual(before);
  });

  test('compat selected for the machine does not register or touch contracts', async () => {
    CONTRACT_REGISTRY.clear();
    resetAllContractRegistration();
    const nodes: IRNode[] = [{ type: 'return', props: { value: '7' } }];

    const sync = executeInternalRuntimeEnvelopeCompatSync(nodes, makeEnv(), enabled);
    const asyncEnvelope = await executeInternalRuntimeEnvelopeCompatAsync(nodes, makeEnv(), enabled);
    expect(sync).toMatchObject({ outcome: 'success' });
    expect(asyncEnvelope).toEqual(sync);
    expect(CONTRACT_REGISTRY.size).toBe(0);
  });

  test('direct rejects a hidden runner-class instance without executing its module getter', () => {
    let getterCalls = 0;
    const classes = new Map<string, never>();
    const scope = { classes, functions: new Map<string, never>() };
    const getter = {
      body: [{ type: 'return', props: { value: '41' } }],
      name: 'answer',
      ownerClass: 'Box',
      params: [],
    };
    classes.set('Box', {
      fields: [],
      getters: new Map([['answer', getter]]),
      methods: new Map(),
      module: scope,
      name: 'Box',
    } as never);
    const instance = {
      __kernRunnerClassInstance: true as const,
      className: 'Box',
      module: scope,
    } as { __kernRunnerClassInstance: true; className: string; fields: Record<string, unknown>; module: typeof scope };
    Object.defineProperty(instance, 'fields', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return {};
      },
    });
    const env = makeEnv();
    env.bindings.set('obj', instance);
    const nodes: IRNode[] = [{ type: 'return', props: { value: 'obj.answer' } }];

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(getterCalls).toBe(0);

    const compatEnv = makeEnv();
    compatEnv.bindings.set('obj', instance);
    expect(executeInternalRuntimeEnvelopeCompatSync(nodes, compatEnv, enabled)).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: '41' } },
    });
    expect(getterCalls).toBeGreaterThan(0);
  });

  test('direct rejects accessor-backed arrays before print, return, or each can invoke host code', async () => {
    let getterCalls = 0;
    const makeAccessorEnv = () => {
      const items = [1];
      Object.defineProperty(items, '0', {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 1;
        },
      });
      const env = makeEnv();
      env.bindings.set('items', items);
      return env;
    };
    const cases: readonly IRNode[][] = [
      [{ type: 'print', props: { value: 'items[0]' } }],
      [{ type: 'return', props: { value: 'items[0]' } }],
      [{ type: 'each', props: { in: 'items', name: 'item' }, children: [{ type: 'print', props: { value: 'item' } }] }],
    ];

    for (const nodes of cases) {
      expect(executeInternalRuntimeEnvelopeSync(nodes, makeAccessorEnv(), enabled)).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
      expect(await executeInternalRuntimeEnvelopeAsync(nodes, makeAccessorEnv(), enabled)).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
    }
    expect(getterCalls).toBe(0);
  });

  test('direct rejects sparse root arrays before iteration', () => {
    const items = new Array(2);
    items[0] = 1;
    const env = makeEnv();
    env.bindings.set('items', items);
    expect(
      executeInternalRuntimeEnvelopeSync(
        [
          {
            type: 'each',
            props: { in: 'items', name: 'item' },
            children: [{ type: 'print', props: { value: 'item' } }],
          },
        ],
        env,
        enabled,
      ),
    ).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
  });

  test('whole-tree preflight rejects forbidden raw record keys before capability dispatch', () => {
    let providerCalls = 0;
    for (const key of [
      '__proto__',
      'constructor',
      'prototype',
      '__defineGetter__',
      '__defineSetter__',
      '__lookupGetter__',
      '__lookupSetter__',
    ]) {
      const record = Object.create(null) as Record<string, unknown>;
      record[key] = 1;
      const nodes: IRNode[] = [
        { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
        { type: 'return', props: { value: record } },
      ];
      const env = makeEnv({ capabilities: { storage: { get: () => (providerCalls += 1) } } });
      expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
    }
    expect(providerCalls).toBe(0);
  });

  test('direct rejects proxy-backed root state without invoking proxy traps', async () => {
    let traps = 0;
    const proxy = <T extends object>(value: T): T =>
      new Proxy(value, {
        get: (target, key, receiver) => {
          traps += 1;
          return Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor: (target, key) => {
          traps += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        getPrototypeOf: (target) => {
          traps += 1;
          return Reflect.getPrototypeOf(target);
        },
        ownKeys: (target) => {
          traps += 1;
          return Reflect.ownKeys(target);
        },
      });
    const cases = [proxy([1]), proxy({ answer: 42 })];

    for (const value of cases) {
      const syncEnv = makeEnv();
      syncEnv.bindings.set('value', value);
      expect(
        executeInternalRuntimeEnvelopeSync([{ type: 'return', props: { value: 'value' } }], syncEnv, enabled),
      ).toMatchObject({ diagnostics: [{ code: 'unsupported-runtime-input' }], events: [], outcome: 'failure' });

      const asyncEnv = makeEnv();
      asyncEnv.bindings.set('value', value);
      expect(
        await executeInternalRuntimeEnvelopeAsync([{ type: 'return', props: { value: 'value' } }], asyncEnv, enabled),
      ).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
    }
    expect(traps).toBe(0);
  });

  test('makeEnv does not invoke or launder hostile binding accessors', () => {
    let getterCalls = 0;
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'secret', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 42;
      },
    });

    const env = makeEnv({ bindings: new Map([['value', hostile]]) });
    expect(getterCalls).toBe(0);
    expect(
      executeInternalRuntimeEnvelopeSync([{ type: 'return', props: { value: 'value' } }], env, enabled),
    ).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(getterCalls).toBe(0);
  });

  test('makeEnv does not invoke accessor-backed array elements', () => {
    let getterCalls = 0;
    const hostile = [0];
    Object.defineProperty(hostile, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 42;
      },
    });
    const env = makeEnv({ bindings: new Map([['value', hostile]]) });
    expect(
      executeInternalRuntimeEnvelopeSync([{ type: 'return', props: { value: 'value' } }], env, enabled),
    ).toMatchObject({ diagnostics: [{ code: 'unsupported-runtime-input' }], events: [], outcome: 'failure' });
    expect(getterCalls).toBe(0);
  });

  test('makeEnv rejects hostile container shapes without laundering them into owned values', () => {
    class ArraySubclass<T> extends Array<T> {}
    class MapSubclass<K, V> extends Map<K, V> {}
    class SetSubclass<T> extends Set<T> {}
    const values: readonly unknown[] = [new ArraySubclass(1), new MapSubclass([['key', 1]]), new SetSubclass([1])];

    for (const value of values) {
      const env = makeEnv({ bindings: new Map([['value', value]]) });
      expect(
        executeInternalRuntimeEnvelopeSync([{ type: 'return', props: { value: 'value' } }], env, enabled),
      ).toMatchObject({ diagnostics: [{ code: 'unsupported-runtime-input' }], events: [], outcome: 'failure' });
    }
  });

  test('makeEnv preserves aliases and cycles so direct admission rejects the graph', () => {
    const shared = { answer: 42 };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const values = [{ first: shared, second: shared }, cyclic];

    for (const value of values) {
      const env = makeEnv({ bindings: new Map([['value', value]]) });
      expect(
        executeInternalRuntimeEnvelopeSync([{ type: 'return', props: { value: 'value' } }], env, enabled),
      ).toMatchObject({ diagnostics: [{ code: 'unsupported-runtime-input' }], events: [], outcome: 'failure' });
    }
  });

  test('makeEnv admits descriptor-safe null-prototype records', () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.answer = 42;
    expect(
      executeInternalRuntimeEnvelopeSync(
        [{ type: 'return', props: { value: 'value' } }],
        makeEnv({ bindings: new Map([['value', value]]) }),
        enabled,
      ),
    ).toMatchObject({
      outcome: 'success',
      result: {
        presence: 'value',
        value: { tag: 'record', value: [{ key: 'answer', value: { tag: 'integer', value: '42' } }] },
      },
    });
  });

  test('direct root composites require makeEnv ownership instead of raw map injection', () => {
    const nodes: IRNode[] = [{ type: 'return', props: { value: 'value' } }];
    const rawEnv = makeEnv();
    rawEnv.bindings.set('value', { answer: 42 });
    expect(executeInternalRuntimeEnvelopeSync(nodes, rawEnv, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });

    expect(
      executeInternalRuntimeEnvelopeSync(nodes, makeEnv({ bindings: new Map([['value', { answer: 42 }]]) }), enabled),
    ).toMatchObject({
      completion: { kind: 'return' },
      outcome: 'success',
      result: {
        presence: 'value',
        value: { tag: 'record', value: [{ key: 'answer', value: { tag: 'integer', value: '42' } }] },
      },
    });
  });

  test('direct rejects replaced mutable metadata without iterating host containers', () => {
    let touches = 0;
    class HostSet<T> extends Set<T> {
      override [Symbol.iterator](): SetIterator<T> {
        touches += 1;
        return super[Symbol.iterator]();
      }
    }
    class HostMap<K, V> extends Map<K, V> {
      override [Symbol.iterator](): MapIterator<[K, V]> {
        touches += 1;
        return super[Symbol.iterator]();
      }
    }
    const replacements: Array<(env: ReturnType<typeof makeEnv>) => void> = [
      (env) => {
        env.intProvenance = new HostSet();
      },
      (env) => {
        env.freshArrayBindings = new HostSet();
      },
      (env) => {
        env.capturedArrayBindings = new HostSet();
      },
      (env) => {
        env.pushBuiltFreshArrayBindings = new HostSet();
      },
      (env) => {
        env.recordArrayFields = new HostMap();
      },
    ];

    for (const replace of replacements) {
      const env = makeEnv();
      replace(env);
      expect(
        executeInternalRuntimeEnvelopeSync([{ type: 'return', props: { value: '1' } }], env, enabled),
      ).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
    }
    expect(touches).toBe(0);
  });

  test('direct rejects accessor-tampered owned metadata without invoking host code', () => {
    let touches = 0;
    const tamperers: Array<(env: ReturnType<typeof makeEnv>) => void> = [
      (env) => {
        Object.defineProperty(env.bindings, Symbol.iterator, {
          configurable: true,
          get() {
            touches += 1;
            return Map.prototype[Symbol.iterator];
          },
        });
      },
      (env) => {
        Object.defineProperty(env.recordArrayFields, 'values', {
          configurable: true,
          get() {
            touches += 1;
            return Map.prototype.values;
          },
        });
      },
      (env) => {
        Object.defineProperty(env.intProvenance, 'values', {
          configurable: true,
          get() {
            touches += 1;
            return Set.prototype.values;
          },
        });
      },
      (env) => {
        Object.defineProperty(env.runnerCallStack, Symbol.iterator, {
          configurable: true,
          get() {
            touches += 1;
            return Array.prototype[Symbol.iterator];
          },
        });
      },
    ];

    for (const tamper of tamperers) {
      const env = makeEnv();
      tamper(env);
      expect(
        executeInternalRuntimeEnvelopeSync([{ type: 'return', props: { value: '1' } }], env, enabled),
      ).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
    }
    expect(touches).toBe(0);
  });

  test('direct rejects deleted factory metadata instead of repairing it during admission', () => {
    const keys = [
      'intProvenance',
      'freshArrayBindings',
      'capturedArrayBindings',
      'pushBuiltFreshArrayBindings',
      'recordArrayFields',
      'runnerCallStack',
    ] as const;
    for (const key of keys) {
      const env = makeEnv();
      delete env[key];
      expect(
        executeInternalRuntimeEnvelopeSync([{ type: 'return', props: { value: '1' } }], env, enabled),
      ).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
    }
  });

  test('direct rejects one owned composite aliased across root bindings', () => {
    const env = makeEnv({ bindings: new Map([['first', [1]]]) });
    env.bindings.set('second', env.bindings.get('first'));
    expect(
      executeInternalRuntimeEnvelopeSync([{ type: 'return', props: { value: 'first' } }], env, enabled),
    ).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
  });

  test('machine-created nested records remain owned when the environment is reused', () => {
    const env = makeEnv();
    expect(
      executeInternalRuntimeEnvelopeSync(
        [
          { type: 'let', props: { name: 'record', value: '{items: [1, 2]}' } },
          { type: 'return', props: { value: '1' } },
        ],
        env,
        enabled,
      ),
    ).toMatchObject({ outcome: 'success' });
    expect(
      executeInternalRuntimeEnvelopeSync([{ type: 'return', props: { value: 'record' } }], env, enabled),
    ).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'record' } },
    });
  });

  test('owned root Map bindings remain direct-readable', () => {
    const env = makeEnv({ bindings: new Map([['values', new Map([['answer', 42]])]]) });
    expect(
      executeInternalRuntimeEnvelopeSync(
        [{ type: 'return', props: { value: 'Map.get(values, "answer")' } }],
        env,
        enabled,
      ),
    ).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'integer', value: '42' } },
    });
  });

  test('makeEnv preserves immutable Decimal identity and direct evaluator behavior', () => {
    const env = makeEnv({ bindings: new Map([['decimal', makeDecimalValue('1.5')]]) });
    expect(isOwnedDecimalValue(env.bindings.get('decimal'))).toBe(true);
    expect(
      executeInternalRuntimeEnvelopeSync(
        [{ type: 'return', props: { value: 'Decimal.eq(decimal, Decimal.of("1.5"))' } }],
        env,
        enabled,
      ),
    ).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'boolean', value: true } },
    });
  });

  test('direct decimal admission rejects owned accessor impostors without invoking getters', () => {
    let getterCalls = 0;
    const impostor = {} as Record<PropertyKey, unknown>;
    Object.defineProperties(impostor, {
      [DECIMAL_VALUE_TAG]: {
        configurable: true,
        get() {
          getterCalls += 1;
          return true;
        },
      },
      canonical: {
        configurable: true,
        get() {
          getterCalls += 1;
          return '1.5';
        },
      },
    });
    ownSemanticAtomicValue(impostor);
    const env = makeEnv();
    env.bindings.set('decimal', impostor);

    expect(
      executeInternalRuntimeEnvelopeSync([{ type: 'return', props: { value: 'decimal' } }], env, enabled),
    ).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(getterCalls).toBe(0);
  });

  test('all eight operational leaves preserve frozen raw sync/async/reference traces', async () => {
    restoreRegistry();
    const cases: readonly IRNode[][] = [
      [
        { type: 'let', props: { name: 'n', value: '1' } },
        { type: 'assign', props: { op: '+=', target: 'n', value: '2' } },
        { type: 'return', props: { value: 'n' } },
      ],
      [
        { type: 'fmt', props: { name: 'message', template: 'value=${2}' } },
        { type: 'print', props: { value: 'message' } },
        { type: 'return', props: { value: 'message' } },
      ],
      [{ type: 'throw', props: { value: 'new Error("boom")' } }],
      [{ type: 'return', props: { value: undefined } }],
      [{ type: 'return', props: { value: [1, [2, 3]] } }],
      [{ type: 'return', props: { value: { answer: 42, items: [1, 2] } } }],
      [{ type: 'for', props: { from: '0', name: 'i', to: '1' }, children: [{ type: 'break' }] }],
      [{ type: 'for', props: { from: '0', name: 'i', to: '1' }, children: [{ type: 'continue' }] }],
    ];

    for (const nodes of cases) {
      const reference = referenceRunSequence(nodes, makeEnv());
      const sync = runInternalEffectMachineSync(nodes, makeEnv(), { iterationBudget: limits.maxCollectionLength });
      const asyncTrace = await runInternalEffectMachineAsync(nodes, makeEnv(), {
        iterationBudget: limits.maxCollectionLength,
      });
      expect(tracesEqual(sync, reference)).toBe(true);
      expect(tracesEqual(asyncTrace, reference)).toBe(true);
    }
  });

  test('handler and source-handler roots fail closed on legacy-only sync/async input', async () => {
    const body: IRNode[] = [
      { type: 'let', props: { name: 'pairs', value: '[[1,2]]' } },
      { type: 'each', props: { in: 'pairs', pairKey: 'key', pairValue: 'value' }, children: [] },
      { type: 'return', props: { value: '1' } },
    ];
    const entry = { body, parameters: [] };
    const handlerSync = executeInternalRuntimeHandlerSync(entry, [], makeEnv(), enabled);
    const handlerAsync = await executeInternalRuntimeHandlerAsync(entry, [], makeEnv(), enabled);
    expect(handlerSync).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(handlerAsync).toEqual(handlerSync);

    const source = [
      'fn name=append returns=number',
      '  handler lang="kern"',
      '    let name=pairs value="[[1,2]]"',
      '    each pairKey=key pairValue=value in="pairs"',
      '    return value="1"',
    ].join('\n');
    const identity = { handlerName: 'append', sourcePath: 'app/main.kern' } as const;
    const sourceSync = executeInternalRuntimeSourceHandlerSync(source, identity, [], makeEnv(), enabled);
    const sourceAsync = await executeInternalRuntimeSourceHandlerAsync(source, identity, [], makeEnv(), enabled);
    expect(sourceSync).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(sourceAsync).toEqual(sourceSync);
  });

  test('direct async and handler source ownership are explicit in source', () => {
    const executeSource = readFileSync(new URL('../src/runtime-envelope/execute.ts', import.meta.url), 'utf8');
    const engineSource = readFileSync(new URL('../src/runtime-envelope/internal-engine.ts', import.meta.url), 'utf8');
    const handlerSource = readFileSync(new URL('../src/runtime-envelope/handler-entry.ts', import.meta.url), 'utf8');
    expect(executeSource).not.toContain('AsyncReferenceRunnerOptions');
    expect(engineSource).not.toContain('AsyncReferenceRunnerOptions');
    expect(handlerSource).toContain("from './execute.js'");
    expect(handlerSource).not.toContain("from './execute-compat.js'");
    expect(handlerSource).not.toContain('InternalRuntimeCompatAsyncOptions');
  });

  test('capability-produced class-shaped records remain data and cannot activate class semantics', () => {
    const classShape = { __kernRunnerClassInstance: true, className: 'Box', fields: [] };
    const provider = { runtime: { get: () => classShape } };
    const asData: IRNode[] = [
      { type: 'capability', props: { name: 'answer', namespace: 'runtime', operation: 'get' } },
      { type: 'return', props: { value: 'answer' } },
    ];
    expect(executeInternalRuntimeEnvelopeSync(asData, makeEnv({ capabilities: provider }), enabled)).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'record' } },
    });

    const activate: IRNode[] = [
      { type: 'capability', props: { name: 'answer', namespace: 'runtime', operation: 'get' } },
      { type: 'return', props: { value: 'answer.className' } },
    ];
    expect(executeInternalRuntimeEnvelopeSync(activate, makeEnv({ capabilities: provider }), enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
  });
});
