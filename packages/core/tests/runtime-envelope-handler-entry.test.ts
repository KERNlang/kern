import { makeEnv } from '../src/ir/semantics/index.js';
import {
  executeInternalRuntimeHandlerAsync,
  executeInternalRuntimeHandlerSync,
  type InternalRuntimeHandlerEntry,
} from '../src/runtime-envelope/handler-entry.js';
import { encodeInternalRuntimeEnvelope } from '../src/runtime-envelope/normalize.js';
import { InternalRuntimeEnvelopeError, type InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import type { IRNode } from '../src/types.js';

const limits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxIterations: 64,
  maxStringBytes: 4_096,
};
const enabled = { enabled: true, limits } as const;

function entry(parameters: readonly string[], body: readonly IRNode[]): InternalRuntimeHandlerEntry {
  return { body, parameters };
}

function returned(value?: string): IRNode {
  return { type: 'return', props: value === undefined ? {} : { value } };
}

describe('internal typed runtime handler entry', () => {
  test('is default-off', async () => {
    const target = entry([], []);
    expect(() => executeInternalRuntimeHandlerSync(target, [], makeEnv())).toThrow(InternalRuntimeEnvelopeError);
    await expect(executeInternalRuntimeHandlerAsync(target, [], makeEnv())).rejects.toThrow(
      InternalRuntimeEnvelopeError,
    );
  });

  test('round-trips current executable argument values and void', async () => {
    const values = [null, true, 'hello', 42, [1, 'two', [false]], { active: true, names: ['a', 'b'] }];
    for (const value of values) {
      const envelope = executeInternalRuntimeHandlerSync(
        entry(['arg'], [returned('arg')]),
        [value],
        makeEnv(),
        enabled,
      );
      expect(envelope).toMatchObject({
        completion: { kind: 'return' },
        outcome: 'success',
      });
      await expect(
        executeInternalRuntimeHandlerAsync(entry(['arg'], [returned('arg')]), [value], makeEnv(), enabled),
      ).resolves.toEqual(envelope);
    }
    expect(executeInternalRuntimeHandlerSync(entry([], []), [], makeEnv(), enabled)).toMatchObject({
      completion: { kind: 'normal' },
      result: { presence: 'absent' },
    });
  });

  test('uses fresh argument bindings and preserves sync/async bytes', async () => {
    const target = entry(['value'], [returned('value')]);
    const host = makeEnv({ bindings: new Map([['value', 'host-secret']]) });
    const sync = executeInternalRuntimeHandlerSync(target, ['request'], host, enabled);
    const asyncEnvelope = await executeInternalRuntimeHandlerAsync(target, ['request'], host, enabled);
    expect(sync.result).toEqual({
      presence: 'value',
      value: { tag: 'text', value: 'request' },
    });
    expect(asyncEnvelope).toEqual(sync);
    expect(encodeInternalRuntimeEnvelope(asyncEnvelope, limits)).toEqual(encodeInternalRuntimeEnvelope(sync, limits));
  });

  test('installs integer and record-array provenance for admitted handler operations', () => {
    const indexed = executeInternalRuntimeHandlerSync(
      entry(['xs', 'i'], [returned('xs[i]')]),
      [['zero', 'one'], 1],
      makeEnv(),
      enabled,
    );
    expect(indexed.result).toEqual({
      presence: 'value',
      value: { tag: 'text', value: 'one' },
    });

    const iterated = executeInternalRuntimeHandlerSync(
      entry(
        ['arg'],
        [
          {
            type: 'each',
            props: { in: 'arg.names', name: 'name' },
            children: [{ type: 'print', props: { value: 'name' } }],
          },
        ],
      ),
      [{ names: ['a', 'b'] }],
      makeEnv(),
      enabled,
    );
    expect(iterated.events).toEqual([
      { op: 'stdout', text: 'a' },
      { op: 'stdout', text: 'b' },
    ]);
  });

  test('rejects names, arity, unsupported values, and hostile argument arrays', () => {
    const shared = { value: 1 };
    let getterCalls = 0;
    const accessor = [1];
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    const symbolArray = [1];
    Object.defineProperty(symbolArray, Symbol('hidden'), { value: true });
    const fixtures: Array<[InternalRuntimeHandlerEntry, readonly unknown[]]> = [
      [entry(['bad-name'], []), [1]],
      [entry(['x', 'x'], []), [1, 2]],
      [entry(['x'], []), []],
      [entry(['x'], []), [1.5]],
      [entry(['x'], []), [{ nested: { value: 1 } }]],
      [entry(['x'], []), [{ left: shared, right: shared }]],
      [entry(['x'], []), [Number.MAX_SAFE_INTEGER + 1]],
      [entry(['x'], []), accessor],
      [entry(['x'], []), symbolArray],
    ];
    for (const [target, args] of fixtures) {
      expect(executeInternalRuntimeHandlerSync(target, args, makeEnv(), enabled)).toMatchObject({
        diagnostics: [{ code: 'invalid-handler-arguments' }],
        events: [],
        outcome: 'failure',
        result: { presence: 'absent' },
      });
    }
    expect(getterCalls).toBe(0);
    expect(
      executeInternalRuntimeHandlerSync(entry(['x', 'y'], []), [shared, shared], makeEnv(), enabled),
    ).toMatchObject({ diagnostics: [{ code: 'invalid-handler-arguments' }] });
    expect(
      executeInternalRuntimeHandlerSync(entry(['x', 'y'], []), [1, 2], makeEnv(), {
        enabled: true,
        limits: { ...limits, maxCollectionLength: 1 },
      }),
    ).toMatchObject({ diagnostics: [{ code: 'invalid-handler-arguments' }] });
    let oversizedScans = 0;
    const oversized = new Proxy([1, 2], {
      ownKeys(target) {
        oversizedScans += 1;
        return Reflect.ownKeys(target);
      },
    });
    expect(
      executeInternalRuntimeHandlerSync(entry(['x', 'y'], []), oversized, makeEnv(), {
        enabled: true,
        limits: { ...limits, maxCollectionLength: 1 },
      }),
    ).toMatchObject({ diagnostics: [{ code: 'invalid-handler-arguments' }] });
    expect(oversizedScans).toBe(0);
  });

  test('rejects proxy-presented argument shapes before handler execution', () => {
    let trapCalls = 0;
    const disguisedList = new Proxy([1], {
      get(target, property, receiver) {
        trapCalls += 1;
        return property === 'length' ? 0 : Reflect.get(target, property, receiver);
      },
    });
    const target = entry(['arg'], [returned('List.length(arg)')]);
    expect(executeInternalRuntimeHandlerSync(target, [disguisedList], makeEnv(), enabled)).toMatchObject({
      diagnostics: [{ code: 'invalid-handler-arguments' }],
      events: [],
      outcome: 'failure',
      result: { presence: 'absent' },
    });
    expect(trapCalls > 0).toBe(true);

    const disguisedArguments = new Proxy([1], {});
    expect(
      executeInternalRuntimeHandlerSync(entry(['arg'], [returned('arg')]), disguisedArguments, makeEnv(), enabled),
    ).toMatchObject({
      diagnostics: [{ code: 'invalid-handler-arguments' }],
      outcome: 'failure',
    });
  });

  test('rejects invalid arguments before capability execution', () => {
    let calls = 0;
    const host = makeEnv({
      capabilities: {
        storage: {
          get() {
            calls += 1;
            return 'leak';
          },
        },
      },
    });
    const target = entry(
      ['arg'],
      [
        {
          type: 'capability',
          props: { name: 'result', namespace: 'storage', operation: 'get' },
        },
      ],
    );
    const envelope = executeInternalRuntimeHandlerSync(target, [() => 'invalid'], host, enabled);
    expect(envelope.diagnostics).toEqual([
      {
        category: 'runtime',
        code: 'invalid-handler-arguments',
        phase: 'execution',
      },
    ]);
    expect(envelope.events).toEqual([]);
    expect(calls).toBe(0);
  });

  test('forwards async capability providers through the typed entry', async () => {
    const target = entry(
      [],
      [
        {
          type: 'capability',
          props: {
            input: '"hello"',
            name: 'answer',
            namespace: 'llm',
            operation: 'complete',
          },
        },
        returned('answer'),
      ],
    );
    const envelope = await executeInternalRuntimeHandlerAsync(target, [], makeEnv(), enabled, {
      asyncCapabilities: { llm: { complete: async () => 'world' } },
    });
    expect(envelope).toMatchObject({
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'text', value: 'world' } },
    });
    expect(envelope.events).toEqual([
      {
        input: { presence: 'value', value: { tag: 'text', value: 'hello' } },
        namespace: 'llm',
        op: 'capability',
        operation: 'complete',
        result: { presence: 'value', value: { tag: 'text', value: 'world' } },
      },
    ]);
  });

  test('resets host call-frame state at the handler root', () => {
    const host = makeEnv({
      bindings: new Map([['secret', 'host']]),
      runnerCallCache: new Map([['host-cache', 'leak']]),
      runnerCallStack: ['host-frame'],
      runnerFunctions: new Map([['hostHelper', { body: [returned('7')], name: 'hostHelper', params: [] }]]),
      runnerSuperClass: 'HostBase',
      runnerThis: {
        __kernRunnerClassInstance: true,
        className: 'Host',
        fields: { secret: 'leak' },
      },
    });
    const envelope = executeInternalRuntimeHandlerSync(entry([], [returned('secret')]), [], host, enabled);
    expect(envelope).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(executeInternalRuntimeHandlerSync(entry([], [returned('hostHelper()')]), [], host, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      outcome: 'failure',
    });
  });
});
