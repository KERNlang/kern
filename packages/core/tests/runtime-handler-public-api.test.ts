import {
  executeKernRuntimeHandlerAsync,
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
  KernRuntimeHandlerError,
  type KernRuntimeHandlerLimits,
  type KernRuntimeHandlerRequest,
} from '../src/runtime-handler.js';

const limits: KernRuntimeHandlerLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxStringBytes: 4_096,
};

const identity = { handlerName: 'answer', sourcePath: 'app/main.kern' } as const;

function request(source: string, args: readonly unknown[] = []): KernRuntimeHandlerRequest {
  return { abi: KERN_RUNTIME_HANDLER_ABI, arguments: args, identity, source };
}

function source(parameters: readonly string[], returns: string, body: readonly string[]): string {
  return [
    `fn name=answer returns=${returns}`,
    ...parameters.map((parameter) => `  param ${parameter}`),
    '  handler lang="kern"',
    ...body.map((line) => `    ${line}`),
  ].join('\n');
}

const syncOptions = { enabled: true, limits } as const;
const asyncOptions = { capabilityTimeoutMs: 100, enabled: true, limits } as const;

describe('@kernlang/core/runtime/handler public ABI', () => {
  test('puts the exact ABI on ingress and egress with sync/async byte parity', async () => {
    const invocation = request(source(['name=value type=string'], 'string', ['return value="value"']), ['ready']);
    const sync = executeKernRuntimeHandlerSync(invocation, syncOptions);
    const asyncEnvelope = await executeKernRuntimeHandlerAsync(invocation, asyncOptions);
    expect(sync).toEqual({
      completion: { kind: 'return' },
      diagnostics: [],
      events: [],
      format: KERN_RUNTIME_HANDLER_ABI,
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'text', value: 'ready' } },
    });
    expect(asyncEnvelope).toEqual(sync);
    expect(JSON.stringify(asyncEnvelope)).toBe(JSON.stringify(sync));
  });

  test('keeps sync and immediately-resolved async capability envelopes byte-identical', async () => {
    const invocation = request(
      source([], 'string', [
        String.raw`capability namespace=llm operation=complete input="\"hello\"" name=answer`,
        'return value="answer"',
      ]),
    );
    const capabilities = { llm: { complete: () => 'world' } } as const;
    const asyncCapabilities = { llm: { complete: async () => 'world' } } as const;
    const sync = executeKernRuntimeHandlerSync(invocation, { ...syncOptions, capabilities });
    const asyncEnvelope = await executeKernRuntimeHandlerAsync(invocation, {
      ...asyncOptions,
      asyncCapabilities,
    });
    expect(asyncEnvelope).toEqual(sync);
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

  test('enforces the admitted scalar and one-dimensional list annotations before effects', () => {
    let calls = 0;
    const capabilities = {
      storage: {
        get() {
          calls += 1;
          return 'called';
        },
      },
    } as const;
    const mismatched = request(
      source(['name=count type=number'], 'number', [
        'capability namespace=storage operation=get name=result',
        'return value="count"',
      ]),
      ['not-a-number'],
    );
    expect(executeKernRuntimeHandlerSync(mismatched, { ...syncOptions, capabilities })).toMatchObject({
      diagnostics: [{ code: 'invalid-handler-arguments', phase: 'execution' }],
      events: [],
      outcome: 'failure',
      result: { presence: 'absent' },
    });
    expect(calls).toBe(0);

    const list = request(source(['name=values type="string[]"'], 'string', ['return value="values[1]"']), [
      ['zero', 'one'],
    ]);
    expect(executeKernRuntimeHandlerSync(list, syncOptions).result).toEqual({
      presence: 'value',
      value: { tag: 'text', value: 'one' },
    });
    expect(
      executeKernRuntimeHandlerSync(
        request(source(['name=values type="number[]"'], 'number', ['return value="values[0]"']), [[1.5]]),
        syncOptions,
      ),
    ).toMatchObject({ diagnostics: [{ code: 'invalid-handler-arguments' }], outcome: 'failure' });
  });

  test('rejects accessor arguments without invoking them during public preflight', () => {
    let getterCalls = 0;
    const args: unknown[] = [];
    Object.defineProperty(args, '0', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'ready';
      },
    });
    args.length = 1;
    const invocation = request(source(['name=value type=string'], 'string', ['return value="value"']), args);
    expect(executeKernRuntimeHandlerSync(invocation, syncOptions)).toMatchObject({
      diagnostics: [{ code: 'invalid-handler-arguments' }],
      events: [],
      outcome: 'failure',
      result: { presence: 'absent' },
    });
    expect(getterCalls).toBe(0);
  });

  test('rejects missing or unsupported annotations during link admission', () => {
    const missing = ['fn name=answer', '  param name=value', '  handler lang="kern"', '    return value="value"'].join(
      '\n',
    );
    const custom = source(['name=value type=Custom'], 'Custom', ['return value="value"']);
    for (const invocation of [request(missing, ['x']), request(custom, ['x'])]) {
      expect(executeKernRuntimeHandlerSync(invocation, syncOptions)).toMatchObject({
        diagnostics: [{ code: 'handler-entry-unsupported', phase: 'link' }],
        events: [],
        outcome: 'failure',
        result: { presence: 'absent' },
      });
    }
  });

  test('suppresses result and events on a declared-result mismatch without claiming effect rollback', () => {
    let calls = 0;
    const invocation = request(
      source([], 'number', [
        'capability namespace=storage operation=get name=value',
        'print value="value"',
        'return value="value"',
      ]),
    );
    const envelope = executeKernRuntimeHandlerSync(invocation, {
      ...syncOptions,
      capabilities: {
        storage: {
          get() {
            calls += 1;
            return 'text-result';
          },
        },
      },
    });
    expect(calls).toBe(1);
    expect(envelope).toEqual({
      completion: { kind: 'error' },
      diagnostics: [{ category: 'runtime', code: 'invalid-handler-result', phase: 'execution' }],
      events: [],
      format: KERN_RUNTIME_HANDLER_ABI,
      outcome: 'failure',
      result: { presence: 'absent' },
    });
  });

  test('partitions programmer/config errors from source and execution envelopes', async () => {
    const malformed = request('fn');
    expect(executeKernRuntimeHandlerSync(malformed, syncOptions)).toMatchObject({
      diagnostics: [{ code: 'handler-link-error', phase: 'link' }],
      outcome: 'failure',
    });

    for (const run of [
      () => executeKernRuntimeHandlerSync({ ...malformed, abi: 'wrong' } as never, syncOptions),
      () => executeKernRuntimeHandlerSync(malformed, { ...syncOptions, enabled: false } as never),
      () => executeKernRuntimeHandlerSync(malformed, { ...syncOptions, limits: { ...limits, maxBytes: 0 } }),
      () => executeKernRuntimeHandlerSync(malformed, { ...syncOptions, unknown: true } as never),
    ]) {
      expect(run).toThrow(KernRuntimeHandlerError);
      try {
        run();
      } catch (error) {
        expect(error).toBeInstanceOf(KernRuntimeHandlerError);
        expect(String(error)).not.toContain('/Users/');
      }
    }

    const providerFailure = request(
      source([], 'string', ['capability namespace=storage operation=get name=value', 'return value="value"']),
    );
    expect(
      executeKernRuntimeHandlerSync(providerFailure, {
        ...syncOptions,
        capabilities: { storage: { get: () => Promise.resolve('wrong-mode') as never } },
      }),
    ).toMatchObject({ diagnostics: [{ code: 'capability-error' }], events: [], outcome: 'failure' });

    const controller = new AbortController();
    controller.abort();
    const cancelled = await executeKernRuntimeHandlerAsync(
      request(source([], 'string', [String.raw`return value="\"never\""`])),
      {
        ...asyncOptions,
        scheduler: { signal: controller.signal },
      },
    );
    expect(cancelled).toMatchObject({ diagnostics: [{ code: 'execution-cancelled' }], outcome: 'failure' });

    const timeoutInvocation = request(
      source([], 'string', ['capability namespace=llm operation=complete name=value', 'return value="value"']),
    );
    const timedOut = await executeKernRuntimeHandlerAsync(timeoutInvocation, {
      ...asyncOptions,
      asyncCapabilities: { llm: { complete: () => new Promise(() => {}) } },
      scheduler: { timeoutMs: 10 },
    });
    expect(timedOut).toMatchObject({
      diagnostics: [{ code: 'execution-timeout' }],
      events: [],
      outcome: 'failure',
      result: { presence: 'absent' },
    });
  });

  test('rejects malformed public request and scheduler shapes at the entry boundary', () => {
    const invocation = request(source([], 'string', [String.raw`return value="\"ready\""`]));
    const inheritedLimits = Object.create(limits) as KernRuntimeHandlerLimits;
    try {
      executeKernRuntimeHandlerSync(invocation, { ...syncOptions, limits: inheritedLimits });
      throw new Error('expected inherited limits to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(KernRuntimeHandlerError);
      expect((error as KernRuntimeHandlerError).code).toBe('invalid-limits');
    }
    let limitGetterCalls = 0;
    const accessorLimits = Object.defineProperties(
      {},
      Object.fromEntries(
        Object.entries(limits).map(([key, value]) => [
          key,
          {
            enumerable: true,
            get: () => {
              limitGetterCalls += 1;
              return value;
            },
          },
        ]),
      ),
    ) as KernRuntimeHandlerLimits;
    try {
      executeKernRuntimeHandlerSync(invocation, { ...syncOptions, limits: accessorLimits });
      throw new Error('expected accessor limits to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(KernRuntimeHandlerError);
      expect((error as KernRuntimeHandlerError).code).toBe('invalid-limits');
      expect(limitGetterCalls).toBe(0);
    }

    for (const malformedRequest of [
      { ...invocation, arguments: {} },
      { ...invocation, identity: 'answer' },
      { ...invocation, identity: { handlerName: 'answer' } },
      { ...invocation, source: 7 },
    ]) {
      try {
        executeKernRuntimeHandlerSync(malformedRequest as never, syncOptions);
        throw new Error('expected malformed request to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(KernRuntimeHandlerError);
        expect((error as KernRuntimeHandlerError).code).toBe('invalid-request');
      }
    }

    for (const scheduler of [{}, { timeoutMs: 0 }, { timeoutMs: 2_147_483_648 }, { signal: {} }]) {
      try {
        executeKernRuntimeHandlerSync(invocation, { ...syncOptions, scheduler } as never);
        throw new Error('expected malformed scheduler to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(KernRuntimeHandlerError);
        expect((error as KernRuntimeHandlerError).code).toBe('invalid-options');
      }
    }
  });

  test('enforces operation-map-only capability providers at runtime', async () => {
    const invocation = request(source([], 'string', [String.raw`return value="\"ready\""`]));
    for (const capabilities of [
      () => 'namespace-shortcut',
      { get: 'not-a-handler' },
      Object.defineProperty({}, 'get', { enumerable: true, get: () => () => 'hidden' }),
    ]) {
      try {
        executeKernRuntimeHandlerSync(invocation, {
          ...syncOptions,
          capabilities: { storage: capabilities },
        } as never);
        throw new Error('expected malformed sync capability map to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(KernRuntimeHandlerError);
        expect((error as KernRuntimeHandlerError).code).toBe('invalid-options');
      }
    }

    try {
      await executeKernRuntimeHandlerAsync(invocation, {
        ...asyncOptions,
        asyncCapabilities: { storage: () => Promise.resolve('namespace-shortcut') },
      } as never);
      throw new Error('expected malformed async capability map to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(KernRuntimeHandlerError);
      expect((error as KernRuntimeHandlerError).code).toBe('invalid-options');
    }
  });
});
