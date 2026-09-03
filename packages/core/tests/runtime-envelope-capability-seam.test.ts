import { bindInternalReferenceTraceRetention, makeEnv, makeExecutionFrame } from '../src/ir/semantics/index.js';
import {
  deriveInternalRuntimeCapabilityInterceptor,
  INTERNAL_RUNTIME_CAPABILITY_REQUEST_FORMAT,
  type InternalRuntimeCapabilityInterceptor,
  type InternalRuntimeCapabilityRequest,
  installInternalRuntimeCapabilityInterceptor,
  invokeInternalRuntimeCapabilitySync,
} from '../src/ir/semantics/internal-capability-interceptor.js';
import {
  executeInternalRuntimeHandlerAsync,
  executeInternalRuntimeHandlerSync,
  type InternalRuntimeHandlerEntry,
} from '../src/runtime-envelope/handler-entry.js';
import { encodeInternalRuntimeEnvelope } from '../src/runtime-envelope/normalize.js';
import type { InternalRuntimeEnvelopeLimits, InternalRuntimeEnvelopeOptions } from '../src/runtime-envelope/types.js';

const limits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxIterations: 64,
  maxStringBytes: 4_096,
};
const capability = {
  type: 'capability',
  props: { input: '{ key: "answer" }', name: 'value', namespace: 'storage', operation: 'get' },
} as const;
const returnValue = { type: 'return', props: { value: 'value' } } as const;
const entry: InternalRuntimeHandlerEntry = { body: [capability, returnValue], parameters: [] };

function options(capabilityInterceptor?: InternalRuntimeCapabilityInterceptor): InternalRuntimeEnvelopeOptions {
  return { capabilityInterceptor, enabled: true, limits };
}

function providerHost(onCall: () => void, result = 'provider') {
  return makeEnv({
    capabilities: {
      storage: {
        get() {
          onCall();
          return result;
        },
      },
    },
  });
}

describe('internal runtime capability interception seam', () => {
  test('preserves legacy provider behavior byte-for-byte when omitted', async () => {
    let calls = 0;
    const host = providerHost(() => {
      calls += 1;
    });
    const sync = executeInternalRuntimeHandlerSync(entry, [], host, options());
    const asyncEnvelope = await executeInternalRuntimeHandlerAsync(entry, [], host, options());

    expect(calls).toBe(2);
    expect(asyncEnvelope).toEqual(sync);
    expect(encodeInternalRuntimeEnvelope(asyncEnvelope, limits)).toEqual(encodeInternalRuntimeEnvelope(sync, limits));
  });

  test('proceed invokes the provider once and preserves capability then assignment order', () => {
    let calls = 0;
    const requests: InternalRuntimeCapabilityRequest[] = [];
    const interceptor: InternalRuntimeCapabilityInterceptor = (request) => {
      requests.push(request);
      return { kind: 'proceed' };
    };
    const envelope = executeInternalRuntimeHandlerSync(
      entry,
      [],
      providerHost(() => {
        calls += 1;
      }),
      options(interceptor),
    );

    expect(calls).toBe(1);
    expect(requests).toEqual([
      {
        format: INTERNAL_RUNTIME_CAPABILITY_REQUEST_FORMAT,
        input: { key: 'answer' },
        mode: 'sync',
        namespace: 'storage',
        operation: 'get',
        sequence: 0,
      },
    ]);
    expect(envelope.events).toMatchObject([
      { op: 'capability', namespace: 'storage', operation: 'get', result: { presence: 'value' } },
    ]);
    expect(envelope.result).toEqual({ presence: 'value', value: { tag: 'text', value: 'provider' } });
  });

  test('synthetic return bypasses providers and is sync/async byte-identical', async () => {
    let calls = 0;
    const requests: InternalRuntimeCapabilityRequest[] = [];
    const interceptor: InternalRuntimeCapabilityInterceptor = (request) => {
      requests.push(request);
      const decision = { kind: 'return', result: 'synthetic' } as const;
      return request.mode === 'async' ? Promise.resolve(decision) : decision;
    };
    const host = providerHost(() => {
      calls += 1;
    });
    const sync = executeInternalRuntimeHandlerSync(entry, [], host, options(interceptor));
    const asyncEnvelope = await executeInternalRuntimeHandlerAsync(entry, [], host, options(interceptor));

    expect(calls).toBe(0);
    expect(requests.map(({ mode, sequence }) => ({ mode, sequence }))).toEqual([
      { mode: 'sync', sequence: 0 },
      { mode: 'async', sequence: 0 },
    ]);
    expect(asyncEnvelope).toEqual(sync);
    expect(encodeInternalRuntimeEnvelope(asyncEnvelope, limits)).toEqual(encodeInternalRuntimeEnvelope(sync, limits));
  });

  test('reject and invalid decisions fail closed before provider dispatch', () => {
    const interceptors: InternalRuntimeCapabilityInterceptor[] = [
      () => ({ kind: 'reject' }),
      () => ({ kind: 'unknown' }),
      () => ({ extra: true, kind: 'proceed' }),
      () => ({ kind: 'return', result: () => 'not portable' }),
      () => {
        throw new Error('interceptor failure');
      },
      () => Promise.resolve({ kind: 'proceed' }),
      () => Promise.reject(new Error('rejected interceptor decision')),
    ];

    for (const interceptor of interceptors) {
      let calls = 0;
      const envelope = executeInternalRuntimeHandlerSync(
        entry,
        [],
        providerHost(() => {
          calls += 1;
        }),
        options(interceptor),
      );
      expect(calls).toBe(0);
      expect(envelope).toMatchObject({
        diagnostics: [{ code: 'capability-error', phase: 'execution' }],
        events: [],
        outcome: 'failure',
        result: { presence: 'absent' },
      });
    }
  });

  test('preserves interceptor failure causes without exposing them in the envelope', () => {
    const host = makeEnv();
    const cause = new Error('local interceptor detail');
    installInternalRuntimeCapabilityInterceptor(host, () => {
      throw cause;
    });

    let thrown: unknown;
    try {
      invokeInternalRuntimeCapabilitySync(host, { namespace: 'storage', operation: 'get' });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error & { cause?: unknown }).cause).toBe(cause);

    const envelope = executeInternalRuntimeHandlerSync(
      entry,
      [],
      host,
      options(() => Promise.reject(cause)),
    );
    expect(envelope).toMatchObject({
      diagnostics: [{ code: 'capability-error', phase: 'execution' }],
      events: [],
      outcome: 'failure',
    });
    expect(JSON.stringify(envelope)).not.toContain('local interceptor detail');
  });

  test('async interceptors may settle before a sync provider dispatch', async () => {
    let calls = 0;
    const interceptor: InternalRuntimeCapabilityInterceptor = async () => ({ kind: 'proceed' });
    const envelope = await executeInternalRuntimeHandlerAsync(
      entry,
      [],
      providerHost(() => {
        calls += 1;
      }),
      options(interceptor),
    );

    expect(calls).toBe(1);
    expect(envelope.result).toEqual({ presence: 'value', value: { tag: 'text', value: 'provider' } });
  });

  test('child scopes inherit the seam and later calls do not', () => {
    const nestedEntry: InternalRuntimeHandlerEntry = {
      body: [
        {
          type: 'branch',
          props: { on: '"selected"' },
          children: [
            {
              type: 'path',
              props: { value: 'selected' },
              __quotedProps: ['value'],
              children: [capability, returnValue],
            },
          ],
        },
      ],
      parameters: [],
    };
    let calls = 0;
    const requests: InternalRuntimeCapabilityRequest[] = [];
    const host = providerHost(() => {
      calls += 1;
    });
    const intercepted = executeInternalRuntimeHandlerSync(
      nestedEntry,
      [],
      host,
      options((request) => {
        requests.push(request);
        return { kind: 'return', result: 'nested' };
      }),
    );
    const direct = executeInternalRuntimeHandlerSync(entry, [], host, options());

    expect(requests.map(({ sequence }) => sequence)).toEqual([0]);
    expect(intercepted.result).toEqual({ presence: 'value', value: { tag: 'text', value: 'nested' } });
    expect(direct.result).toEqual({ presence: 'value', value: { tag: 'text', value: 'provider' } });
    expect(calls).toBe(1);
  });

  test('rebuilt function and class frames inherit the seam through execution context', () => {
    const runnerCallCache = new Map();
    const root = makeEnv({ runnerCallCache });
    const requests: InternalRuntimeCapabilityRequest[] = [];
    installInternalRuntimeCapabilityInterceptor(root, (request) => {
      requests.push(request);
      return { kind: 'return', result: `${request.operation}-${request.sequence}` };
    });
    const functionEnv = makeExecutionFrame(root, { runnerCallCache });
    const classEnv = makeExecutionFrame(root, { runnerCallCache });
    const unrelatedEnv = makeEnv({ runnerCallCache });

    expect(
      invokeInternalRuntimeCapabilitySync(functionEnv, {
        namespace: 'storage',
        operation: 'function',
      }),
    ).toBe('function-0');
    expect(
      invokeInternalRuntimeCapabilitySync(classEnv, {
        namespace: 'storage',
        operation: 'class',
      }),
    ).toBe('class-1');
    expect(requests.map(({ operation, sequence }) => ({ operation, sequence }))).toEqual([
      { operation: 'function', sequence: 0 },
      { operation: 'class', sequence: 1 },
    ]);
    expect(() =>
      invokeInternalRuntimeCapabilitySync(unrelatedEnv, {
        namespace: 'storage',
        operation: 'unrelated',
      }),
    ).toThrow(/was requested but not provided/);
  });

  test('isolated derivations share interceptor authority but start independent sequences', () => {
    const root = makeEnv();
    const requests: InternalRuntimeCapabilityRequest[] = [];
    installInternalRuntimeCapabilityInterceptor(root, (request) => {
      requests.push(request);
      return { kind: 'return', result: request.sequence };
    });
    const first = bindInternalReferenceTraceRetention(root, 'observable-only');
    const second = bindInternalReferenceTraceRetention(root, 'observable-only');
    deriveInternalRuntimeCapabilityInterceptor(root, first);
    deriveInternalRuntimeCapabilityInterceptor(root, second);

    for (const env of [first, first, second, second]) {
      invokeInternalRuntimeCapabilitySync(env, { namespace: 'storage', operation: 'get' });
    }
    expect(requests.map(({ sequence }) => sequence)).toEqual([0, 1, 0, 1]);
  });
});
