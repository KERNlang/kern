import { bindInternalReferenceTraceRetention, makeEnv } from '../src/ir/semantics/index.js';
import { executeInternalRuntimeEnvelopeSync } from '../src/runtime-envelope/execute.js';
import {
  executeInternalRuntimeHandlerAsync,
  executeInternalRuntimeHandlerSync,
  type InternalRuntimeHandlerEntry,
} from '../src/runtime-envelope/handler-entry.js';
import {
  installInternalRuntimeScheduler,
  retainInternalRuntimeSchedulerDerivation,
  throwIfInternalRuntimeSchedulerTerminated,
} from '../src/runtime-envelope/internal-scheduler.js';
import { encodeInternalRuntimeEnvelope } from '../src/runtime-envelope/normalize.js';
import type { InternalRuntimeEnvelopeLimits, InternalRuntimeEnvelopeOptions } from '../src/runtime-envelope/types.js';

const limits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxStringBytes: 4_096,
};
const syncEntry: InternalRuntimeHandlerEntry = {
  body: [
    {
      type: 'capability',
      props: { input: '"request"', name: 'answer', namespace: 'storage', operation: 'get' },
    },
    { type: 'return', props: { value: 'answer' } },
  ],
  parameters: [],
};
const asyncEntry: InternalRuntimeHandlerEntry = {
  body: [
    {
      type: 'capability',
      props: { input: '"request"', name: 'answer', namespace: 'llm', operation: 'complete' },
    },
    { type: 'return', props: { value: 'answer' } },
  ],
  parameters: [],
};

function options(
  scheduler?: InternalRuntimeEnvelopeOptions['scheduler'],
  capabilityInterceptor?: InternalRuntimeEnvelopeOptions['capabilityInterceptor'],
): InternalRuntimeEnvelopeOptions {
  return { capabilityInterceptor, enabled: true, limits, scheduler };
}

function failure(code: 'execution-cancelled' | 'execution-timeout' | 'internal-runner-error') {
  return {
    completion: { kind: 'error' },
    diagnostics: [{ category: 'runtime', code, phase: 'execution' }],
    events: [],
    format: 'kern.runtime.internal.r0',
    outcome: 'failure',
    result: { presence: 'absent' },
  };
}

class CountingAbortSignal {
  aborted = false;
  added = 0;
  removed = 0;
  private listener: EventListenerOrEventListenerObject | undefined;

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.added += 1;
    this.listener = listener;
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    if (this.listener === listener) this.listener = undefined;
    this.removed += 1;
  }

  abort(): void {
    this.aborted = true;
    const event = new Event('abort');
    if (typeof this.listener === 'function') this.listener(event);
    else this.listener?.handleEvent(event);
  }

  asAbortSignal(): AbortSignal {
    return this as unknown as AbortSignal;
  }
}

describe('internal runtime scheduler control', () => {
  test('omitted and inactive scheduler controls preserve envelope bytes', async () => {
    const host = makeEnv({ capabilities: { storage: { get: () => 'value' } } });
    const baselineSync = executeInternalRuntimeHandlerSync(syncEntry, [], host, options());
    const signal = new CountingAbortSignal();
    const scheduledSync = executeInternalRuntimeHandlerSync(
      syncEntry,
      [],
      host,
      options({ signal: signal.asAbortSignal() }),
    );
    const baselineAsync = await executeInternalRuntimeHandlerAsync(syncEntry, [], host, options());
    const scheduledAsync = await executeInternalRuntimeHandlerAsync(
      syncEntry,
      [],
      host,
      options({ signal: new AbortController().signal }),
    );

    expect(scheduledSync).toEqual(baselineSync);
    expect(scheduledAsync).toEqual(baselineAsync);
    expect(encodeInternalRuntimeEnvelope(scheduledSync, limits)).toEqual(
      encodeInternalRuntimeEnvelope(baselineSync, limits),
    );
    expect(signal.added).toBe(1);
    expect(signal.removed).toBe(1);
  });

  test('invalid controls fail before handler or provider execution', () => {
    const invalid = [
      null,
      {},
      { extra: true },
      { signal: {} },
      { timeoutMs: 0 },
      { timeoutMs: -1 },
      { timeoutMs: 1.5 },
      { timeoutMs: 2_147_483_648 },
      { timeoutMs: Number.POSITIVE_INFINITY },
    ];
    for (const scheduler of invalid) {
      let calls = 0;
      const envelope = executeInternalRuntimeHandlerSync(
        syncEntry,
        [],
        makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } }),
        options(scheduler as never),
      );
      expect(calls).toBe(0);
      expect(envelope).toEqual(failure('internal-runner-error'));
    }
  });

  test('a settled raw-envelope environment can install a fresh scheduler generation', () => {
    const env = makeEnv({ runnerCallCache: new Map() });
    const first = executeInternalRuntimeEnvelopeSync([], env, options({ signal: new AbortController().signal }));
    const second = executeInternalRuntimeEnvelopeSync([], env, options({ signal: new AbortController().signal }));
    expect(first).toMatchObject({ outcome: 'success' });
    expect(second).toEqual(first);
  });

  test('isolated derivations share terminal state and retain disposed scheduler generations', () => {
    const controller = new AbortController();
    const root = makeEnv({ runnerCallCache: new Map() });
    const dispose = installInternalRuntimeScheduler(root, { signal: controller.signal });
    const release = retainInternalRuntimeSchedulerDerivation(root);
    const derived = bindInternalReferenceTraceRetention(root, 'observable-only');

    controller.abort();
    dispose();
    expect(() => throwIfInternalRuntimeSchedulerTerminated(derived)).toThrow(/execution-cancelled/);
    expect(() => installInternalRuntimeScheduler(root, { signal: new AbortController().signal })).toThrow(
      /already installed/,
    );

    release();
    const disposeFresh = installInternalRuntimeScheduler(root, { signal: new AbortController().signal });
    expect(() => throwIfInternalRuntimeSchedulerTerminated(root)).not.toThrow();
    disposeFresh();
  });

  test('already-aborted calls fail before sync or async providers run', async () => {
    const controller = new AbortController();
    controller.abort();
    let syncCalls = 0;
    let asyncCalls = 0;
    const sync = executeInternalRuntimeHandlerSync(
      syncEntry,
      [],
      makeEnv({ capabilities: { storage: { get: () => (syncCalls += 1) } } }),
      options({ signal: controller.signal }),
    );
    const asyncEnvelope = await executeInternalRuntimeHandlerAsync(
      asyncEntry,
      [],
      makeEnv(),
      options({ signal: controller.signal }),
      { asyncCapabilities: { llm: { complete: async () => (asyncCalls += 1) } } },
    );

    expect(syncCalls).toBe(0);
    expect(asyncCalls).toBe(0);
    expect(sync).toEqual(failure('execution-cancelled'));
    expect(asyncEnvelope).toEqual(failure('execution-cancelled'));
  });

  test('in-flight cancellation terminates an interceptor wait before provider dispatch', async () => {
    const controller = new AbortController();
    let providerCalls = 0;
    let entered: (() => void) | undefined;
    let settle: ((value: { kind: 'proceed' }) => void) | undefined;
    const waiting = new Promise<{ kind: 'proceed' }>((resolve) => {
      settle = resolve;
    });
    const interceptorEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const running = executeInternalRuntimeHandlerAsync(
      syncEntry,
      [],
      makeEnv({ capabilities: { storage: { get: () => (providerCalls += 1) } } }),
      options({ signal: controller.signal }, () => {
        entered?.();
        return waiting;
      }),
    );
    await interceptorEntered;
    controller.abort();
    const envelope = await running;

    expect(envelope).toEqual(failure('execution-cancelled'));
    expect(providerCalls).toBe(0);
    settle?.({ kind: 'proceed' });
    await Promise.resolve();
    await Promise.resolve();
    expect(providerCalls).toBe(0);
    expect(envelope).toEqual(failure('execution-cancelled'));
  });

  test('scheduler timeout is distinct from async provider capability timeout', async () => {
    const never = new Promise<string>(() => {});
    const envelope = await executeInternalRuntimeHandlerAsync(asyncEntry, [], makeEnv(), options({ timeoutMs: 5 }), {
      asyncCapabilities: { llm: { complete: async () => never } },
      capabilityTimeoutMs: 1_000,
    });
    expect(envelope).toEqual(failure('execution-timeout'));
  });

  test('late interceptor rejection is observed and a later call gets fresh state', async () => {
    const controller = new AbortController();
    let rejectWaiting: ((reason?: unknown) => void) | undefined;
    let entered: (() => void) | undefined;
    const waiting = new Promise<never>((_resolve, reject) => {
      rejectWaiting = reject;
    });
    const interceptorEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = executeInternalRuntimeHandlerAsync(
      syncEntry,
      [],
      makeEnv({ capabilities: { storage: { get: () => 'unreached' } } }),
      options({ signal: controller.signal }, () => {
        entered?.();
        return waiting;
      }),
    );
    await interceptorEntered;
    controller.abort();
    expect(await first).toEqual(failure('execution-cancelled'));
    rejectWaiting?.(new Error('late secret'));
    await Promise.resolve();
    await Promise.resolve();

    const second = executeInternalRuntimeHandlerSync(
      syncEntry,
      [],
      makeEnv({ capabilities: { storage: { get: () => 'fresh' } } }),
      options({ signal: new AbortController().signal }),
    );
    expect(second).toMatchObject({ outcome: 'success', result: { presence: 'value' } });
  });
});
