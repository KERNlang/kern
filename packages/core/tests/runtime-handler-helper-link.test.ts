import {
  executeKernRuntimeHandlerAsync,
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
  type KernRuntimeHandlerLimits,
  type KernRuntimeHandlerRequest,
} from '../src/runtime-handler.js';

const limits: KernRuntimeHandlerLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxIterations: 64,
  maxStringBytes: 4_096,
};
const syncOptions = { enabled: true, limits } as const;
const asyncOptions = { capabilityTimeoutMs: 100, enabled: true, limits } as const;
const identity = { handlerName: 'answer', sourcePath: 'app/helper-link.kern' } as const;

function request(source: string, args: readonly unknown[] = []): KernRuntimeHandlerRequest {
  return { abi: KERN_RUNTIME_HANDLER_ABI, arguments: args, identity, source };
}

function entry(parameters: readonly string[], returns: string, body: readonly string[]): string[] {
  return [
    `fn name=answer returns=${returns}`,
    ...parameters.map((parameter) => `  param ${parameter}`),
    '  handler lang="kern"',
    ...body.map((line) => `    ${line}`),
  ];
}

async function expectParity(invocation: KernRuntimeHandlerRequest) {
  const sync = executeKernRuntimeHandlerSync(invocation, syncOptions);
  const asyncEnvelope = await executeKernRuntimeHandlerAsync(invocation, asyncOptions);
  expect(asyncEnvelope).toEqual(sync);
  expect(JSON.stringify(asyncEnvelope)).toBe(JSON.stringify(sync));
  return sync;
}

describe('M3.31d public runtime-handler sibling helper link', () => {
  test('preserves authored arguments through transitive scalar helpers', async () => {
    const source = [
      'fn name=join returns=string',
      '  param name=left type=string',
      '  param name=right type=string',
      '  handler lang="kern"',
      String.raw`    return value="left + \":\" + right"`,
      'fn name=relay returns=string',
      '  param name=first type=string',
      '  param name=second type=string',
      '  handler lang="kern"',
      '    return value="join(second, first)"',
      ...entry(['name=first type=string', 'name=second type=string'], 'string', [
        'return value="relay(first, second)"',
      ]),
    ].join('\n');

    const envelope = await expectParity(request(source, ['left', 'right']));
    expect(envelope).toMatchObject({
      diagnostics: [],
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'text', value: 'right:left' } },
    });
  });

  test('keeps list arguments inside the linked machine domain', async () => {
    const source = [
      'fn name=first returns=string',
      '  param name=values type="string[]"',
      '  handler lang="kern"',
      '    return value="values[0]"',
      ...entry(['name=values type="string[]"'], 'string', ['return value="first(values)"']),
    ].join('\n');
    const envelope = await expectParity(request(source, [['zero', 'one']]));
    expect(envelope).toMatchObject({
      diagnostics: [],
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'text', value: 'zero' } },
    });
  });

  test('does not make the selected entry callable as its own sibling helper', async () => {
    const source = entry(['name=value type=string'], 'string', ['return value="answer(value)"']).join('\n');
    const envelope = await expectParity(request(source, ['ready']));
    expect(envelope).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
  });

  test('links main as an ordinary sibling when another public entry is selected', async () => {
    const source = [
      'fn name=main returns=string',
      '  handler lang="kern"',
      String.raw`    return value="\"from-main\""`,
      ...entry([], 'string', ['return value="main()"']),
    ].join('\n');
    const envelope = await expectParity(request(source));
    expect(envelope).toMatchObject({
      diagnostics: [],
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'text', value: 'from-main' } },
    });
  });

  test('rejects a class colliding with the selected public entry before execution', async () => {
    const source = ['class name=answer', ...entry([], 'string', [String.raw`return value="\"unreachable\""`])].join(
      '\n',
    );
    const envelope = await expectParity(request(source));
    expect(envelope).toMatchObject({
      diagnostics: [{ code: 'handler-link-error', phase: 'link' }],
      events: [],
      outcome: 'failure',
    });
  });

  test('rejects wrong helper arity before effects', async () => {
    const source = [
      'fn name=identity returns=string',
      '  param name=value type=string',
      '  handler lang="kern"',
      '    return value="value"',
      ...entry([], 'string', ['return value="identity()"']),
    ].join('\n');
    const envelope = await expectParity(request(source));
    expect(envelope).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
  });

  test('retains bounded helper loops and recursion with sync/async parity', async () => {
    const loops = [
      'fn name=sum returns=number',
      '  param name=count type=number',
      '  handler lang="kern"',
      '    let name=total value="0"',
      '    for name=i from=0 to=count',
      '      assign target=total op="+=" value="i"',
      '    return value="total"',
      ...entry(['name=count type=number'], 'number', ['return value="sum(count)"']),
    ].join('\n');
    const loopSuccess = await expectParity(request(loops, [3]));
    expect(loopSuccess).toMatchObject({
      diagnostics: [],
      result: { presence: 'value', value: { tag: 'integer', value: '3' } },
    });
    const loopFailure = await expectParity(request(loops, [65]));
    expect(loopFailure).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });

    const recursion = [
      'fn name=countdown returns=number',
      '  param name=count type=number',
      '  handler lang="kern"',
      '    if cond="count <= 0"',
      '      return value="0"',
      '    return value="1 + countdown(count - 1)"',
      ...entry(['name=count type=number'], 'number', ['return value="countdown(count)"']),
    ].join('\n');
    const recursionSuccess = await expectParity(request(recursion, [5]));
    expect(recursionSuccess).toMatchObject({
      diagnostics: [],
      result: { presence: 'value', value: { tag: 'integer', value: '5' } },
    });
    const recursionFailure = await expectParity(request(recursion, [513]));
    expect(recursionFailure).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
  });

  test('ignores unreachable effectful helpers but rejects reached helper effects before providers', async () => {
    const helper = [
      'fn name=effectful returns=string',
      '  handler lang="kern"',
      '    capability namespace=storage operation=get name=value',
      '    print value="value"',
      '    return value="value"',
    ];
    const unreachable = [...helper, ...entry([], 'string', [String.raw`return value="\"safe\""`])].join('\n');
    const unreachableEnvelope = await expectParity(request(unreachable));
    expect(unreachableEnvelope).toMatchObject({
      diagnostics: [],
      events: [],
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'text', value: 'safe' } },
    });

    let calls = 0;
    const reached = [...helper, ...entry([], 'string', ['return value="effectful()"'])].join('\n');
    const invocation = request(reached);
    const capabilities = { storage: { get: () => `${++calls}` } } as const;
    const sync = executeKernRuntimeHandlerSync(invocation, { ...syncOptions, capabilities });
    const asyncEnvelope = await executeKernRuntimeHandlerAsync(invocation, {
      ...asyncOptions,
      asyncCapabilities: { storage: { get: async () => `${++calls}` } },
    });
    expect(asyncEnvelope).toEqual(sync);
    expect(sync).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('isolates linked scopes, arrays, and results across overlapping invocations', async () => {
    const source = [
      'fn name=pick returns=string',
      '  param name=values type="string[]"',
      '  handler lang="kern"',
      '    return value="values[0]"',
      ...entry(['name=values type="string[]"'], 'string', ['return value="pick(values)"']),
    ].join('\n');
    const left = ['left'];
    const right = ['right'];
    const [leftEnvelope, rightEnvelope] = await Promise.all([
      executeKernRuntimeHandlerAsync(request(source, [left]), asyncOptions),
      executeKernRuntimeHandlerAsync(request(source, [right]), asyncOptions),
    ]);
    expect(leftEnvelope.result).toEqual({ presence: 'value', value: { tag: 'text', value: 'left' } });
    expect(rightEnvelope.result).toEqual({ presence: 'value', value: { tag: 'text', value: 'right' } });
    expect(left).toEqual(['left']);
    expect(right).toEqual(['right']);
  });
});
