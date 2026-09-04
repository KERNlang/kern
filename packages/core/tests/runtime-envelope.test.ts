import { makeEnv } from '../src/ir/semantics/index.js';
import { makeDecimalValue } from '../src/ir/semantics/portable-scalar.js';
import type { Trace } from '../src/ir/semantics/trace.js';
import {
  executeInternalRuntimeEnvelopeAsync,
  executeInternalRuntimeEnvelopeSync,
} from '../src/runtime-envelope/execute.js';
import { encodeInternalRuntimeEnvelope, normalizeInternalRuntimeTrace } from '../src/runtime-envelope/normalize.js';
import { InternalRuntimeEnvelopeError, type InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import { normalizeInternalRuntimeValue } from '../src/runtime-envelope/value.js';
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

function print(value: string): IRNode {
  return { type: 'print', props: { value } };
}

function returned(value?: string): IRNode {
  return { type: 'return', props: value === undefined ? {} : { value } };
}

function thrown(): IRNode {
  return { type: 'throw', props: { errorKind: 'Error' } };
}

describe('internal transactional runtime envelope', () => {
  test('is default-off and leaves existing public executors outside this module', async () => {
    expect(() => executeInternalRuntimeEnvelopeSync([], makeEnv())).toThrow(InternalRuntimeEnvelopeError);
    await expect(executeInternalRuntimeEnvelopeAsync([], makeEnv(), undefined)).rejects.toThrow(
      InternalRuntimeEnvelopeError,
    );
  });

  test('distinguishes normal void, explicit void return, and explicit null', () => {
    const normal = executeInternalRuntimeEnvelopeSync([], makeEnv(), enabled);
    const voidReturn = executeInternalRuntimeEnvelopeSync([returned()], makeEnv(), enabled);
    const nullReturn = executeInternalRuntimeEnvelopeSync([returned('null')], makeEnv(), enabled);
    expect(normal).toMatchObject({ completion: { kind: 'normal' }, result: { presence: 'absent' } });
    expect(voidReturn).toMatchObject({ completion: { kind: 'return' }, result: { presence: 'absent' } });
    expect(nullReturn).toMatchObject({
      completion: { kind: 'return' },
      result: { presence: 'value', value: { tag: 'null' } },
    });
  });

  test('normalizes stdout and drops internal assign/call/iteration events', () => {
    const envelope = normalizeInternalRuntimeTrace(
      {
        completion: { kind: 'normal' },
        events: [
          { op: 'assign', target: 'x', value: 1 },
          { op: 'stdout', text: 'ok' },
          { op: 'call', fn: 'work', args: [] },
          { op: 'iter-done' },
        ],
      },
      limits,
    );
    expect(envelope.events).toEqual([{ op: 'stdout', text: 'ok' }]);
  });

  test('sync and immediately-resolved async capability paths encode byte-identically', async () => {
    const nodes: IRNode[] = [
      {
        type: 'capability',
        props: { input: '"hello"', name: 'answer', namespace: 'llm', operation: 'complete' },
      },
      returned('answer'),
    ];
    const sync = executeInternalRuntimeEnvelopeSync(
      nodes,
      makeEnv({ capabilities: { llm: { complete: () => 'world' } } }),
      enabled,
    );
    const asyncEnvelope = await executeInternalRuntimeEnvelopeAsync(nodes, makeEnv(), enabled, {
      asyncCapabilities: { llm: { complete: async () => 'world' } },
    });
    expect(asyncEnvelope).toEqual(sync);
    expect(encodeInternalRuntimeEnvelope(asyncEnvelope, limits)).toEqual(encodeInternalRuntimeEnvelope(sync, limits));
    expect(sync.events).toEqual([
      {
        input: { presence: 'value', value: { tag: 'text', value: 'hello' } },
        namespace: 'llm',
        op: 'capability',
        operation: 'complete',
        result: { presence: 'value', value: { tag: 'text', value: 'world' } },
      },
    ]);
  });

  test('suppresses stdout and result when execution fails', async () => {
    const sync = executeInternalRuntimeEnvelopeSync([print('"before"'), thrown()], makeEnv(), enabled);
    const asyncEnvelope = await executeInternalRuntimeEnvelopeAsync([print('"before"'), thrown()], makeEnv(), enabled);
    for (const envelope of [sync, asyncEnvelope]) {
      expect(envelope).toEqual({
        completion: { kind: 'error' },
        diagnostics: [{ category: 'runtime', code: 'uncaught-throw', phase: 'execution' }],
        events: [],
        format: 'kern.runtime.internal.r0',
        outcome: 'failure',
        result: { presence: 'absent' },
      });
    }
  });

  test('converts thrown runner and capability failures to stable message-free identity', async () => {
    const unsupported = executeInternalRuntimeEnvelopeSync([{ type: 'unknown-runtime-node' }], makeEnv(), enabled);
    expect(unsupported.diagnostics).toEqual([
      { category: 'runtime', code: 'unsupported-runtime-input', phase: 'execution' },
    ]);
    const capability = await executeInternalRuntimeEnvelopeAsync(
      [{ type: 'capability', props: { name: 'x', namespace: 'llm', operation: 'complete' } }],
      makeEnv(),
      enabled,
      { asyncCapabilities: { llm: { complete: async () => Promise.reject(new Error('host secret')) } } },
    );
    expect(capability.diagnostics).toEqual([{ category: 'runtime', code: 'capability-error', phase: 'execution' }]);
    expect(JSON.stringify(capability)).not.toContain('host secret');
  });

  test('rejects hostile values instead of stringifying or coercing them', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const hostile = [
      undefined,
      () => 1,
      Symbol('x'),
      1n,
      -0,
      Number.NaN,
      Infinity,
      2 ** 60,
      /x/u,
      new Date(),
      new Map(),
      new Set(),
      cycle,
    ];
    for (const value of hostile) {
      expect(() => normalizeInternalRuntimeValue(value, limits)).toThrow(InternalRuntimeEnvelopeError);
    }
    const forbidden = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(forbidden, '__proto__', { enumerable: true, value: 'bad' });
    expect(() => normalizeInternalRuntimeValue(forbidden, limits)).toThrow(InternalRuntimeEnvelopeError);

    let getterCalls = 0;
    const accessor = [0];
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'bad';
      },
    });
    expect(() => normalizeInternalRuntimeValue(accessor, limits)).toThrow(InternalRuntimeEnvelopeError);
    expect(getterCalls).toBe(0);

    const symbolProperty = [0];
    Object.defineProperty(symbolProperty, Symbol('hidden'), { value: 'bad' });
    expect(() => normalizeInternalRuntimeValue(symbolProperty, limits)).toThrow(InternalRuntimeEnvelopeError);

    const namedProperty = [0] as unknown[] & { extra?: string };
    namedProperty.extra = 'bad';
    expect(() => normalizeInternalRuntimeValue(namedProperty, limits)).toThrow(InternalRuntimeEnvelopeError);

    const shared = { value: 'once' };
    expect(() => normalizeInternalRuntimeValue({ left: shared, right: shared }, limits)).toThrow(
      InternalRuntimeEnvelopeError,
    );

    expect(normalizeInternalRuntimeValue(makeDecimalValue('1.5'), limits)).toEqual({ tag: 'decimal', value: '1.5' });
    for (const noncanonical of ['1.10', '1.0', '0.00', '-0', '1e2']) {
      expect(() => normalizeInternalRuntimeValue(makeDecimalValue(noncanonical), limits)).toThrow(
        InternalRuntimeEnvelopeError,
      );
    }
  });

  test('fails transactionally on hostile result and event payloads', () => {
    const hostileTrace: Trace = {
      completion: { kind: 'return', value: () => 'not portable' },
      events: [{ op: 'stdout', text: 'must disappear' }],
    };
    const envelope = normalizeInternalRuntimeTrace(hostileTrace, limits);
    expect(envelope).toMatchObject({
      diagnostics: [{ code: 'non-portable-value' }],
      events: [],
      outcome: 'failure',
      result: { presence: 'absent' },
    });
  });

  test('enforces depth, collection, string, event, encoded-byte, and exact limit contracts', () => {
    expect(() => normalizeInternalRuntimeValue([[[null]]], { ...limits, maxDepth: 1 })).toThrow(
      InternalRuntimeEnvelopeError,
    );
    expect(() => normalizeInternalRuntimeValue([1, 2], { ...limits, maxCollectionLength: 1 })).toThrow(
      InternalRuntimeEnvelopeError,
    );
    expect(() => normalizeInternalRuntimeValue('é', { ...limits, maxStringBytes: 1 })).toThrow(
      InternalRuntimeEnvelopeError,
    );
    const eventLimit = normalizeInternalRuntimeTrace(
      {
        completion: { kind: 'normal' },
        events: [
          { op: 'stdout', text: 'a' },
          { op: 'stdout', text: 'b' },
        ],
      },
      { ...limits, maxEvents: 1 },
    );
    expect(eventLimit.diagnostics[0]?.code).toBe('non-portable-value');
    const success = executeInternalRuntimeEnvelopeSync([], makeEnv(), enabled);
    expect(() => encodeInternalRuntimeEnvelope(success, { ...limits, maxBytes: 1 })).toThrow(
      InternalRuntimeEnvelopeError,
    );
    expect(() =>
      executeInternalRuntimeEnvelopeSync([], makeEnv(), { enabled: true, limits: { ...limits, extra: 1 } } as never),
    ).toThrow(InternalRuntimeEnvelopeError);
  });

  test('canonical encoding ignores insertion order and enforces diagnostic and event ceilings', () => {
    const success = executeInternalRuntimeEnvelopeSync([print('"ok"')], makeEnv(), enabled);
    const reordered = {
      result: success.result,
      outcome: success.outcome,
      format: success.format,
      events: success.events.map((item) => ('text' in item ? { text: item.text, op: item.op } : item)),
      diagnostics: success.diagnostics,
      completion: { kind: success.completion.kind },
    } as typeof success;
    expect(encodeInternalRuntimeEnvelope(reordered, limits)).toEqual(encodeInternalRuntimeEnvelope(success, limits));

    const tooManyDiagnostics = {
      ...success,
      diagnostics: [
        { category: 'runtime', code: 'internal-runner-error', phase: 'execution' },
        { category: 'runtime', code: 'internal-runner-error', phase: 'execution' },
      ],
    } as const;
    const diagnosticBytes = encodeInternalRuntimeEnvelope(tooManyDiagnostics, { ...limits, maxDiagnostics: 1 });
    expect(new TextDecoder().decode(diagnosticBytes)).toContain('"code":"encoded-limit"');

    const eventBytes = encodeInternalRuntimeEnvelope(success, { ...limits, maxEvents: 1 });
    expect(new TextDecoder().decode(eventBytes)).not.toContain('encoded-limit');
    const twoEvents = { ...success, events: [...success.events, ...success.events] };
    expect(new TextDecoder().decode(encodeInternalRuntimeEnvelope(twoEvents, { ...limits, maxEvents: 1 }))).toContain(
      '"code":"encoded-limit"',
    );
  });
});
