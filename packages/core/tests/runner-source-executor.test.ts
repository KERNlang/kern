import { parseDocumentWithDiagnostics } from '../src/parser.js';
import {
  CONTRACT_REGISTRY,
  createMemoryStorageCapability,
  createWebCryptoCapability,
  executeKernSource,
  executeKernSourceAsync,
  type KernRunnerAsyncCapabilities,
  type KernRunnerCapabilities,
  KernRunnerError,
  type RuntimeCapabilityHandler,
  resolveKernMainHandler,
} from '../src/runner.js';

function mainProgram(bodyLines: string[]): string {
  return ['fn name=main returns=void', '  handler lang="kern"', ...bodyLines.map((line) => `    ${line}`)].join('\n');
}

function programWithFunctions(functions: string[][], mainBodyLines: string[]): string {
  return [...functions.map((lines) => lines.join('\n')), mainProgram(mainBodyLines)].join('\n');
}

describe('@kernlang/core/runner source executor', () => {
  test('parses and executes a KERN source string without the CLI', () => {
    const stdout = executeKernSource(
      mainProgram([
        'let kind=let name=total value="0"',
        'for name=i from="1" to="4"',
        '  assign target=total value="total + i"',
        'print value="total"',
      ]),
    );

    expect(stdout).toBe('6\n');
  });

  test('binds flat records and prints scalar dot-field reads', () => {
    const stdout = executeKernSource(
      mainProgram([
        'let name=user value="{ name: \\"Ada\\", age: 37, active: true }"',
        'print value="user.name"',
        'print value="user.age"',
        'print value="user.active"',
        'let name=flags value="{ zero: 0, empty: \\"\\", off: false, missing: null }"',
        'print value="flags.zero"',
        'print value="flags.empty"',
        'print value="flags.off"',
        'print value="flags.missing"',
      ]),
    );

    expect(stdout).toBe('Ada\n37\ntrue\n0\n\nfalse\nnull\n');
  });

  test('formats portable scalar interpolation through fmt bindings', () => {
    const stdout = executeKernSource(
      mainProgram([
        'let name=who value="\\"Ada\\""',
        'let name=count value="3"',
        'fmt name=msg template="hi ${who}: ${count}"',
        'print value="msg"',
      ]),
    );

    expect(stdout).toBe('hi Ada: 3\n');
  });

  test('executes branch paths and defaults with scoped path-local bindings', () => {
    const stdout = executeKernSource(
      mainProgram([
        'let kind=let name=out value="\\"\\""',
        'let name=kind value="\\"paid\\""',
        'branch on="kind"',
        '  path value="paid"',
        '    let name=label value="\\"ok\\""',
        '    assign target=out value="label"',
        '  path default=true',
        '    assign target=out value="\\"fallback\\""',
        'print value="out"',
        'branch on="\\"missing\\""',
        '  path value="paid"',
        '    print value="\\"unreached\\""',
        '  path default=true',
        '    print value="\\"default\\""',
      ]),
    );

    expect(stdout).toBe('ok\ndefault\n');
  });

  test('branch with no matching path and no default falls through', () => {
    const stdout = executeKernSource(
      mainProgram([
        'print value="\\"before\\""',
        'branch on="\\"missing\\""',
        '  path value="paid"',
        '    print value="\\"unreached\\""',
        'print value="\\"after\\""',
      ]),
    );

    expect(stdout).toBe('before\nafter\n');
  });

  test('executes explicit Error try/catch/finally with caught message reads', () => {
    const stdout = executeKernSource(
      mainProgram([
        'try',
        '  print value="\\"try\\""',
        '  throw value="new Error(\\"boom\\")"',
        '  catch name=e',
        '    print value="e.message"',
        '  finally',
        '    print value="\\"cleanup\\""',
        'print value="\\"after\\""',
      ]),
    );

    expect(stdout).toBe('try\nboom\ncleanup\nafter\n');
  });

  test('skips catch when try body completes normally and still runs finally', () => {
    const stdout = executeKernSource(
      mainProgram([
        'try',
        '  print value="\\"work\\""',
        '  catch name=e',
        '    print value="\\"unreached\\""',
        '  finally',
        '    print value="\\"cleanup\\""',
      ]),
    );

    expect(stdout).toBe('work\ncleanup\n');
  });

  test('fails closed when a try body returns while a catch is present', () => {
    expect(() =>
      executeKernSource(
        mainProgram([
          'try',
          '  print value="\\"before\\""',
          '  return',
          '  catch name=e',
          '    print value="\\"caught\\""',
        ]),
      ),
    ).toThrow(KernRunnerError);
  });

  test('fails closed when finally reads a same-named outer catch binding', () => {
    expect(() =>
      executeKernSource(
        mainProgram([
          'let name=e value="{ message: \\"outer\\" }"',
          'try',
          '  throw value="new Error(\\"boom\\")"',
          '  catch name=e',
          '    print value="e.message"',
          '  finally',
          '    print value="e.message"',
        ]),
      ),
    ).toThrow(KernRunnerError);
  });

  test('fails closed when post-catch code reads a same-named outer catch binding', () => {
    expect(() =>
      executeKernSource(
        mainProgram([
          'let name=e value="{ message: \\"outer\\" }"',
          'try',
          '  throw value="new Error(\\"boom\\")"',
          '  catch name=e',
          '    print value="e.message"',
          'print value="e.message"',
        ]),
      ),
    ).toThrow(KernRunnerError);
  });

  test('calls same-file pure KERN functions from portable expressions', () => {
    const stdout = executeKernSource(
      programWithFunctions(
        [
          [
            'fn name=add params="x:number,y:number" returns=number',
            '  handler lang="kern"',
            '    return value="x + y"',
          ],
          ['fn name=double params="n:number" returns=number', '  handler lang="kern"', '    return value="add(n, n)"'],
        ],
        [
          'print value="add(2, 3)"',
          'let kind=let name=total value="0"',
          'for name=i from="1" to="4"',
          '  assign target=total value="total + double(i)"',
          'print value="total"',
        ],
      ),
    );

    expect(stdout).toBe('5\n12\n');
  });

  test('calls helper functions declared with structured param children', () => {
    const stdout = executeKernSource(
      programWithFunctions(
        [
          [
            'fn name=addOne returns=number',
            '  param name=x type=number optional=false variadic=false',
            '  handler lang="kern"',
            '    return value="x + 1"',
          ],
        ],
        ['print value="addOne(2)"'],
      ),
    );

    expect(stdout).toBe('3\n');
  });

  test('caches pure helper calls across precondition and effect passes', () => {
    const functions: string[][] = [['fn name=f0 returns=number', '  handler lang="kern"', '    return value="1"']];
    for (let index = 1; index <= 32; index += 1) {
      functions.push([
        `fn name=f${index} returns=number`,
        '  handler lang="kern"',
        `    return value="f${index - 1}() + 1"`,
      ]);
    }

    const stdout = executeKernSource(programWithFunctions(functions, ['print value="f32()"']));

    expect(stdout).toBe('33\n');
  });

  test('preserves integer provenance for helper parameters used as array indices', () => {
    const stdout = executeKernSource(
      programWithFunctions(
        [
          [
            'fn name=pick params="i:number" returns=number',
            '  handler lang="kern"',
            '    let name=xs value="[10,20,30]"',
            '    return value="xs[i]"',
          ],
        ],
        ['print value="pick(2)"', 'for name=i from="0" to="2"', '  print value="pick(i)"'],
      ),
    );

    expect(stdout).toBe('30\n10\n20\n');
  });

  test('does not let cached provenanced calls mask non-provenanced index arguments', () => {
    expect(() =>
      executeKernSource(
        programWithFunctions(
          [
            [
              'fn name=pick params="i:number" returns=number',
              '  handler lang="kern"',
              '    let name=xs value="[10,20,30]"',
              '    return value="xs[i]"',
            ],
          ],
          ['print value="pick(2)"', 'let name=j value="4 / 2"', 'print value="pick(j)"'],
        ),
      ),
    ).toThrow(KernRunnerError);
  });

  test('rejects optional helper calls', () => {
    expect(() =>
      executeKernSource(
        programWithFunctions(
          [['fn name=addOne params="x:number" returns=number', '  handler lang="kern"', '    return value="x + 1"']],
          ['print value="addOne?.(2)"'],
        ),
      ),
    ).toThrow(KernRunnerError);
  });

  test('runs function bodies in a fresh local scope without capturing caller bindings', () => {
    expect(() =>
      executeKernSource(
        programWithFunctions(
          [['fn name=readX returns=number', '  handler lang="kern"', '    return value="x"']],
          ['let name=x value="10"', 'print value="readX()"'],
        ),
      ),
    ).toThrow(KernRunnerError);
  });

  test('keeps function-local bindings separate from main bindings', () => {
    const stdout = executeKernSource(
      programWithFunctions(
        [
          [
            'fn name=addOne params="x:number" returns=number',
            '  handler lang="kern"',
            '    let name=y value="x + 1"',
            '    return value="y"',
          ],
        ],
        ['let name=y value="10"', 'print value="addOne(2)"', 'print value="y"'],
      ),
    );

    expect(stdout).toBe('3\n10\n');
  });

  test('rejects runner function arity mismatches', () => {
    expect(() =>
      executeKernSource(
        programWithFunctions(
          [
            [
              'fn name=add params="x:number,y:number" returns=number',
              '  handler lang="kern"',
              '    return value="x + y"',
            ],
          ],
          ['print value="add(1)"'],
        ),
      ),
    ).toThrow(KernRunnerError);
  });

  test('rejects recursive runner function calls', () => {
    expect(() =>
      executeKernSource(
        programWithFunctions(
          [
            ['fn name=a returns=number', '  handler lang="kern"', '    return value="b()"'],
            ['fn name=b returns=number', '  handler lang="kern"', '    return value="a()"'],
          ],
          ['print value="a()"'],
        ),
      ),
    ).toThrow(KernRunnerError);
  });

  test('rejects runner functions that produce side effects', () => {
    expect(() =>
      executeKernSource(
        programWithFunctions(
          [
            [
              'fn name=noisy returns=number',
              '  handler lang="kern"',
              '    print value="\\"hidden\\""',
              '    return value="1"',
            ],
          ],
          ['print value="noisy()"'],
        ),
      ),
    ).toThrow(KernRunnerError);
  });

  test('rejects runner functions without a portable scalar return', () => {
    expect(() =>
      executeKernSource(
        programWithFunctions(
          [['fn name=missing returns=number', '  handler lang="kern"', '    let name=x value="1"']],
          ['print value="missing()"'],
        ),
      ),
    ).toThrow(KernRunnerError);
  });

  test('ignores unsupported runner function siblings until called', () => {
    const stdout = executeKernSource(
      programWithFunctions(
        [
          ['fn name=remote returns=number', '  handler lang="ts"'],
          [
            'fn name=maybe params="x:{a:number,b:number}" returns=number',
            '  handler lang="kern"',
            '    return value="x"',
          ],
          ['fn name=noop returns=void', '  handler lang="kern"', '    return'],
        ],
        ['print value="1"'],
      ),
    );

    expect(stdout).toBe('1\n');
  });

  test('rejects calls to unsupported runner function declarations', () => {
    expect(() =>
      executeKernSource(
        programWithFunctions([['fn name=remote returns=number', '  handler lang="ts"']], ['print value="remote()"']),
      ),
    ).toThrow(KernRunnerError);
    expect(() =>
      executeKernSource(
        programWithFunctions(
          [
            [
              'fn name=maybe params="x:{a:number,b:number}" returns=number',
              '  handler lang="kern"',
              '    return value="x"',
            ],
          ],
          ['print value="maybe(1)"'],
        ),
      ),
    ).toThrow(KernRunnerError);
    expect(() =>
      executeKernSource(
        programWithFunctions(
          [['fn name=noop returns=void', '  handler lang="kern"', '    return']],
          ['print value="noop()"'],
        ),
      ),
    ).toThrow(KernRunnerError);
  });

  test('rejects duplicate valid runner functions', () => {
    expect(() =>
      executeKernSource(
        programWithFunctions(
          [
            ['fn name=dup returns=number', '  handler lang="kern"', '    return value="1"'],
            ['fn name=dup returns=number', '  handler lang="kern"', '    return value="2"'],
          ],
          ['print value="1"'],
        ),
      ),
    ).toThrow(KernRunnerError);
  });

  test('reports strict main-resolution errors as controlled runner errors', () => {
    expect(() => executeKernSource('fn name=other returns=void\n  handler lang="kern"')).toThrow(KernRunnerError);
  });

  test('rejects boolean stream=true on parsed or direct main IR', () => {
    expect(() =>
      resolveKernMainHandler({
        type: 'document',
        children: [
          {
            type: 'fn',
            props: { name: 'main', returns: 'void', stream: true },
            children: [{ type: 'handler', props: { lang: 'kern' }, children: [] }],
          },
        ],
      }),
    ).toThrow(KernRunnerError);
  });

  test('rejects main parameter child nodes', () => {
    expect(() =>
      executeKernSource(
        [
          'fn name=main returns=void',
          '  param name=x type=number',
          '  handler lang="kern"',
          '    print value="x"',
        ].join('\n'),
      ),
    ).toThrow(KernRunnerError);
  });

  test('abstains atomically on non-portable operations', () => {
    try {
      executeKernSource(mainProgram(['print value="1"', 'print value="3 / 2"']));
      throw new Error('expected executeKernSource to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(KernRunnerError);
      expect((error as Error).message).toContain('non-portable operation');
    }
  });

  test('fails closed on uncaught explicit throws without replaying partial stdout', () => {
    expect(() =>
      executeKernSource(mainProgram(['print value="\\"before\\""', 'throw value="new Error(\\"boom\\")"'])),
    ).toThrow(KernRunnerError);
  });

  test('fails closed on non-canonical bare throws', () => {
    expect(() => executeKernSource(mainProgram(['throw value="\\"raw\\""']))).toThrow(KernRunnerError);
  });

  test('fails closed when void main returns a value', () => {
    expect(() => executeKernSource(mainProgram(['print value="\\"before\\""', 'return value="1"']))).toThrow(
      KernRunnerError,
    );
  });

  test('fails closed on non-canonical throws inside try/catch', () => {
    expect(() =>
      executeKernSource(
        mainProgram([
          'try',
          '  print value="\\"before\\""',
          '  throw value="\\"raw\\""',
          '  catch name=e',
          '    print value="e.message"',
        ]),
      ),
    ).toThrow(KernRunnerError);
  });

  test('fails closed on missing record fields', () => {
    expect(() =>
      executeKernSource(mainProgram(['let name=user value="{ name: \\"Ada\\" }"', 'print value="user.missing"'])),
    ).toThrow(KernRunnerError);
  });

  test('fails closed when a capability is requested without an explicit host provider', () => {
    expect(() =>
      executeKernSource(
        mainProgram([
          'capability namespace=rag operation=retrieve name=chunks input="{ query: \\"refund\\", limit: 2 }"',
          'print value="chunks.length"',
        ]),
      ),
    ).toThrow(/rag\.retrieve/);
  });

  test('does not fall back to similarly named globals for capabilities', () => {
    const globals = globalThis as typeof globalThis & { rag?: unknown };
    const hadPrevious = 'rag' in globals;
    const previous = globals.rag;
    globals.rag = {
      retrieve: () => [{ id: 'global', text: 'must not run', score: 1 }],
    };
    try {
      expect(() =>
        executeKernSource(
          mainProgram([
            'capability namespace=rag operation=retrieve name=chunks input="{ query: \\"refund\\" }"',
            'print value="chunks.length"',
          ]),
        ),
      ).toThrow(/rag\.retrieve/);
    } finally {
      if (!hadPrevious) delete globals.rag;
      else globals.rag = previous;
    }
  });

  test('runs an injected fake rag.retrieve capability through the browser-safe runner ABI', () => {
    const calls: unknown[] = [];
    const capabilities: KernRunnerCapabilities = {
      rag: {
        retrieve(call, context) {
          calls.push({ call, context });
          return [
            { id: 'chunk-1', text: 'refunds are available', score: 0.98 },
            { id: 'chunk-2', text: 'shipping takes two days', score: 0.72 },
          ];
        },
      },
    };

    const stdout = executeKernSource(
      mainProgram([
        'capability namespace=rag operation=retrieve name=chunks input="{ query: \\"refund\\", limit: 2 }"',
        'print value="chunks.length"',
      ]),
      { capabilities, capabilityContext: { runId: 'run-1', sourceName: 'browser-test.kern' } },
    );

    expect(stdout).toBe('2\n');
    expect(calls).toEqual([
      {
        call: { namespace: 'rag', operation: 'retrieve', input: { query: 'refund', limit: 2 } },
        context: { runId: 'run-1', sourceName: 'browser-test.kern' },
      },
    ]);
  });

  test('binds portable record results returned from an injected capability', () => {
    const capabilities: KernRunnerCapabilities = {
      rag: {
        retrieve() {
          return { answer: 'grounded', count: 2 };
        },
      },
    };

    const stdout = executeKernSource(
      mainProgram([
        'capability namespace=rag operation=retrieve name=result input="{ query: \\"refund\\" }"',
        'print value="result.answer"',
        'print value="result.count"',
      ]),
      { capabilities },
    );

    expect(stdout).toBe('grounded\n2\n');
  });

  test('passes structured capability results into later capability input records', () => {
    const calls: unknown[] = [];
    const capabilities: KernRunnerCapabilities = {
      rag: {
        promptContext(call) {
          calls.push(call.input);
          return { text: 'grounded context', chunks: (call.input as { readonly chunks?: unknown }).chunks ?? [] };
        },
        retrieve() {
          return [{ id: 'chunk-1', text: 'refunds are available', score: 0.98, source: 'docs/refunds.md' }];
        },
      },
    };

    const stdout = executeKernSource(
      mainProgram([
        'capability namespace=rag operation=retrieve name=chunks input="{ query: \\"refund\\" }"',
        'capability namespace=rag operation=promptContext name=context input="{ chunks: chunks, maxChars: 6000 }"',
        'print value="context.text"',
      ]),
      { capabilities },
    );

    expect(stdout).toBe('grounded context\n');
    expect(calls).toEqual([
      {
        chunks: [{ id: 'chunk-1', text: 'refunds are available', score: 0.98, source: 'docs/refunds.md' }],
        maxChars: 6000,
      },
    ]);
  });

  test('runs the browser-safe volatile storage capability through the runner ABI', () => {
    const capabilities: KernRunnerCapabilities = {
      storage: createMemoryStorageCapability({ initial: { greeting: 'hello' } }),
    };

    const stdout = executeKernSource(
      mainProgram([
        'capability namespace=storage operation=get name=before input="{ key: \\"greeting\\" }"',
        'print value="before"',
        'capability namespace=storage operation=set name=setOk input="{ key: \\"count\\", value: 2 }"',
        'print value="setOk"',
        'capability namespace=storage operation=has name=hasCount input="{ key: \\"count\\" }"',
        'print value="hasCount"',
        'capability namespace=storage operation=get name=count input="{ key: \\"count\\" }"',
        'print value="count"',
        'capability namespace=storage operation=keys name=keys',
        'print value="keys.length"',
        'print value="keys[0]"',
        'capability namespace=storage operation=delete name=deleted input="{ key: \\"count\\" }"',
        'print value="deleted"',
        'capability namespace=storage operation=has name=afterDelete input="{ key: \\"count\\" }"',
        'print value="afterDelete"',
        'capability namespace=storage operation=clear name=cleared',
        'print value="cleared"',
        'capability namespace=storage operation=has name=afterClear input="{ key: \\"greeting\\" }"',
        'print value="afterClear"',
      ]),
      { capabilities },
    );

    expect(stdout).toBe('hello\ntrue\ntrue\n2\n2\ncount\ntrue\nfalse\ntrue\nfalse\n');
  });

  test('runs the browser-safe crypto capability through the runner ABI with portable values', () => {
    const capabilities: KernRunnerCapabilities = {
      crypto: createWebCryptoCapability({
        crypto: {
          randomUUID: () => '123E4567-E89B-42D3-A456-426614174000',
          getRandomValues(array) {
            for (let index = 0; index < array.length; index += 1) array[index] = index + 1;
            return array;
          },
        },
      }),
    };

    const stdout = executeKernSource(
      mainProgram([
        'capability namespace=crypto operation=randomUUID name=id',
        'print value="id"',
        'capability namespace=crypto operation=randomBytes name=bytes input="{ length: 4 }"',
        'print value="bytes.length"',
        'print value="bytes[0]"',
        'print value="bytes[3]"',
        'capability namespace=crypto operation=randomHex name=hex input="{ length: 4 }"',
        'print value="hex"',
      ]),
      { capabilities },
    );

    expect(stdout).toBe('123E4567-E89B-42D3-A456-426614174000\n4\n1\n4\n01020304\n');
  });

  test('fails closed when crypto randomUUID returns a non-v4 UUID string', () => {
    const capabilities: KernRunnerCapabilities = {
      crypto: createWebCryptoCapability({
        crypto: {
          randomUUID: () => 'not-a-uuid',
          getRandomValues: (array) => array,
        },
      }),
    };

    expect(() =>
      executeKernSource(mainProgram(['capability namespace=crypto operation=randomUUID name=id']), { capabilities }),
    ).toThrow(/UUID v4/);
  });

  test('fails closed when crypto capability is constructed without an explicit source', () => {
    expect(() => createWebCryptoCapability(undefined as never)).toThrow(/explicit crypto source/);
  });

  test('fails closed when crypto random byte input is outside the synchronous provider contract', () => {
    const capabilities: KernRunnerCapabilities = {
      crypto: createWebCryptoCapability({
        crypto: {
          randomUUID: () => '123e4567-e89b-42d3-a456-426614174000',
          getRandomValues: (array) => array,
        },
      }),
    };

    expect(() =>
      executeKernSource(
        mainProgram(['capability namespace=crypto operation=randomBytes name=bytes input="{ length: 10001 }"']),
        { capabilities },
      ),
    ).toThrow(/between 0 and 10000/);
  });

  test('fails closed when crypto random byte input is not a plain runtime record', () => {
    const provider = createWebCryptoCapability({
      crypto: {
        randomUUID: () => '123e4567-e89b-42d3-a456-426614174000',
        getRandomValues: (array) => array,
      },
    }) as { randomBytes: (call: { input: unknown }) => unknown };

    expect(() => provider.randomBytes({ input: new Uint8Array([4]) })).toThrow(/plain record/);
  });

  test('fails closed when a capability returns a Promise to the synchronous runner', () => {
    const retrieve = (() =>
      Promise.resolve([{ id: 'chunk-1', text: 'async', score: 1 }])) as unknown as RuntimeCapabilityHandler;
    const capabilities: KernRunnerCapabilities = { rag: { retrieve } };

    expect(() =>
      executeKernSource(
        mainProgram([
          'capability namespace=rag operation=retrieve name=chunks input="{ query: \\"refund\\" }"',
          'print value="chunks.length"',
        ]),
        { capabilities },
      ),
    ).toThrow(/async capabilities are not supported/);
  });

  test('async source executor delegates purely synchronous programs to the native runner', async () => {
    await expect(executeKernSourceAsync(mainProgram(['print value="1 + 2"']))).resolves.toBe('3\n');
  });

  test('async source executor delegates synchronous capability programs without invoking async adapters', async () => {
    let called = false;
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      net: {
        async fetch() {
          called = true;
          return { ok: true };
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'capability namespace=storage operation=get name=value input="{ key: \\"greeting\\" }"',
        'print value="value"',
      ]),
      {
        capabilities: { storage: createMemoryStorageCapability({ initial: { greeting: 'hello' } }) },
        providedCapabilities: ['storage.get'],
        asyncCapabilities,
      },
    );

    expect(stdout).toBe('hello\n');
    expect(called).toBe(false);
  });

  test('async source executor reports missing sync providers during preflight when ids are supplied', async () => {
    await expect(
      executeKernSourceAsync(
        mainProgram([
          'capability namespace=rag operation=retrieve name=chunks input="{ query: \\"refund\\", limit: 2 }"',
          'print value="chunks.length"',
        ]),
        { providedCapabilities: [] },
      ),
    ).rejects.toThrow(/missing sync providers: rag\.retrieve@3/);
  });

  test('async source executor reports missing async providers before execution', async () => {
    await expect(
      executeKernSourceAsync(
        mainProgram([
          'capability namespace=fs operation=readText name=body input="{ path: \\"README.md\\" }"',
          'print value="body"',
        ]),
        { providedAsyncCapabilities: [] },
      ),
    ).rejects.toThrow(/missing async providers: fs\.readText@3/);
  });

  test('async source executor reports missing async handlers before execution', async () => {
    await expect(
      executeKernSourceAsync(
        mainProgram([
          'capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
          'print value="response.status"',
        ]),
        { providedAsyncCapabilities: ['net.fetch'] },
      ),
    ).rejects.toThrow(/missing async capability handlers: net\.fetch@3/);

    await expect(
      executeKernSourceAsync(
        mainProgram([
          'print value="\\"before\\""',
          'capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
        ]),
        {
          asyncCapabilities: { net: {} },
          providedAsyncCapabilities: ['net.fetch'],
        },
      ),
    ).rejects.toThrow(/missing async capability handlers: net\.fetch@4/);
  });

  test('async source executor rejects unknown capability requirements during preflight', async () => {
    await expect(
      executeKernSourceAsync(mainProgram(['capability namespace=net operation=socket name=response'])),
    ).rejects.toThrow(/unknown capabilities: net\.socket@3/);
  });

  test('async source executor rejects malformed capability requirements during preflight', async () => {
    await expect(
      executeKernSourceAsync(mainProgram(['capability namespace=net.fetch operation=read name=response'])),
    ).rejects.toThrow(/malformed capability requirements: capability@\d+ .*namespace 'net\.fetch'/);
  });

  test('async source executor rejects unknown provided capability ids during preflight', async () => {
    await expect(
      executeKernSourceAsync(mainProgram(['print value="1"']), {
        providedCapabilities: ['storage.nope'],
      }),
    ).rejects.toThrow(/unknown provided capabilities: storage\.nope/);

    await expect(
      executeKernSourceAsync(mainProgram(['print value="1"']), {
        providedAsyncCapabilities: ['storage.get'],
      }),
    ).rejects.toThrow(/unknown provided async capabilities: storage\.get/);
  });

  test('async source executor awaits async fs, net, and llm capability providers', async () => {
    const calls: string[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      fs: {
        async readText(call) {
          calls.push(`fs:${String((call.input as { path?: unknown } | undefined)?.path)}`);
          return 'file-body';
        },
      },
      net: {
        async fetch(call) {
          calls.push(`net:${String((call.input as { url?: unknown } | undefined)?.url)}`);
          return { status: 201, body: 'created' };
        },
      },
      llm: {
        async complete(call) {
          calls.push(`llm:${String((call.input as { prompt?: unknown } | undefined)?.prompt)}`);
          return 'grounded answer';
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'capability namespace=fs operation=readText name=body input="{ path: \\"README.md\\" }"',
        'print value="body"',
        'capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
        'print value="response.status"',
        'capability namespace=llm operation=complete name=answer input="{ prompt: body }"',
        'print value="answer"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['fs.readText', 'net.fetch', 'llm.complete'],
      },
    );

    expect(stdout).toBe('file-body\n201\ngrounded answer\n');
    expect(calls).toEqual(['fs:README.md', 'net:https://example.test', 'llm:file-body']);
  });

  test('async source executor composes sync structured capability results into async input', async () => {
    const prompts: string[] = [];
    const capabilities: KernRunnerCapabilities = {
      rag: {
        promptContext(call) {
          return {
            text: `context for ${(call.input as { readonly chunks?: readonly unknown[] }).chunks?.length ?? 0}`,
            chunks: [],
          };
        },
        retrieve() {
          return [{ id: 'chunk-1', text: 'refunds are available', score: 0.98, source: 'docs/refunds.md' }];
        },
      },
    };
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete(call) {
          prompts.push(String((call.input as { readonly prompt?: unknown }).prompt));
          return 'grounded answer';
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'capability namespace=rag operation=retrieve name=chunks input="{ query: \\"refund\\" }"',
        'capability namespace=rag operation=promptContext name=context input="{ chunks: chunks }"',
        'capability namespace=llm operation=complete name=answer input="{ prompt: context.text }"',
        'print value="answer"',
      ]),
      {
        capabilities,
        providedCapabilities: ['rag.retrieve', 'rag.promptContext'],
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('grounded answer\n');
    expect(prompts).toEqual(['context for 1']);
  });

  test('async source executor fails closed when an async provider returns a non-portable value', async () => {
    await expect(
      executeKernSourceAsync(
        mainProgram([
          'capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
        ]),
        {
          asyncCapabilities: {
            net: {
              async fetch() {
                return new Date() as unknown as never;
              },
            },
          },
          providedAsyncCapabilities: ['net.fetch'],
        },
      ),
    ).rejects.toThrow(/non-portable value/);
  });

  test('async source executor awaits async capabilities across try, catch, and finally', async () => {
    const calls: string[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete(call) {
          const prompt = String((call.input as { readonly prompt?: unknown }).prompt);
          calls.push(prompt);
          await Promise.resolve();
          return `answer:${prompt}`;
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'try',
        '  capability namespace=llm operation=complete name=before input="{ prompt: \\"body\\" }"',
        '  print value="before"',
        '  throw value="new Error(\\"boom\\")"',
        '  catch name=e',
        '    capability namespace=llm operation=complete name=recovered input="{ prompt: e.message }"',
        '    print value="recovered"',
        '  finally',
        '    capability namespace=llm operation=complete name=cleanup input="{ prompt: \\"cleanup\\" }"',
        '    print value="cleanup"',
        'print value="\\"after\\""',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('answer:body\nanswer:boom\nanswer:cleanup\nafter\n');
    expect(calls).toEqual(['body', 'boom', 'cleanup']);
  });

  test('async source executor skips catch after normal async try body and still runs async finally', async () => {
    const calls: string[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete(call) {
          const prompt = String((call.input as { readonly prompt?: unknown }).prompt);
          calls.push(prompt);
          return prompt;
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'try',
        '  capability namespace=llm operation=complete name=body input="{ prompt: \\"body\\" }"',
        '  print value="body"',
        '  catch name=e',
        '    capability namespace=llm operation=complete name=unreached input="{ prompt: e.message }"',
        '    print value="unreached"',
        '  finally',
        '    capability namespace=llm operation=complete name=cleanup input="{ prompt: \\"cleanup\\" }"',
        '    print value="cleanup"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('body\ncleanup\n');
    expect(calls).toEqual(['body', 'cleanup']);
  });

  test('async source executor runs async finally before propagating a return completion', async () => {
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete(call) {
          return String((call.input as { readonly prompt?: unknown }).prompt);
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'try',
        '  capability namespace=llm operation=complete name=body input="{ prompt: \\"body\\" }"',
        '  print value="body"',
        '  return',
        '  finally',
        '    capability namespace=llm operation=complete name=cleanup input="{ prompt: \\"cleanup\\" }"',
        '    print value="cleanup"',
        'print value="\\"after\\""',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('body\ncleanup\n');
  });

  test('async source executor fails closed when async finally completes abruptly', async () => {
    await expect(
      executeKernSourceAsync(
        mainProgram([
          'try',
          '  capability namespace=llm operation=complete name=body input="{ prompt: \\"body\\" }"',
          '  finally',
          '    capability namespace=llm operation=complete name=cleanup input="{ prompt: \\"cleanup\\" }"',
          '    return value="1"',
        ]),
        {
          asyncCapabilities: {
            llm: {
              async complete() {
                return 'ok';
              },
            },
          },
          providedAsyncCapabilities: ['llm.complete'],
        },
      ),
    ).rejects.toThrow(/finally must complete normally/);
  });

  test('async source executor fails closed when async try body returns while catch is present', async () => {
    await expect(
      executeKernSourceAsync(
        mainProgram([
          'try',
          '  capability namespace=llm operation=complete name=body input="{ prompt: \\"body\\" }"',
          '  return',
          '  catch name=e',
          '    print value="e.message"',
        ]),
        {
          asyncCapabilities: {
            llm: {
              async complete() {
                return 'ok';
              },
            },
          },
          providedAsyncCapabilities: ['llm.complete'],
        },
      ),
    ).rejects.toThrow(/body return with catch/);
  });

  test('async source executor does not catch raw async provider exceptions as KERN errors', async () => {
    await expect(
      executeKernSourceAsync(
        mainProgram([
          'try',
          '  capability namespace=llm operation=complete name=answer input="{ prompt: \\"body\\" }"',
          '  catch name=e',
          '    print value="e.message"',
        ]),
        {
          asyncCapabilities: {
            llm: {
              async complete() {
                throw new Error('provider boom');
              },
            },
          },
          providedAsyncCapabilities: ['llm.complete'],
        },
      ),
    ).rejects.toThrow(/provider boom/);
  });

  test('async source executor runs async capabilities only in the selected if/else branch', async () => {
    const calls: string[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      net: {
        async fetch() {
          calls.push('net.fetch');
          return { ok: true, status: 200 };
        },
      },
      llm: {
        async complete() {
          calls.push('llm.complete');
          return 'fallback';
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'if cond="false"',
        '  capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
        '  print value="response.status"',
        'else',
        '  capability namespace=llm operation=complete name=answer input="{ prompt: \\"fallback\\" }"',
        '  print value="answer"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['net.fetch', 'llm.complete'],
      },
    );

    expect(stdout).toBe('fallback\n');
    expect(calls).toEqual(['llm.complete']);
  });

  test('async source executor awaits async capabilities only in the selected branch path', async () => {
    const calls: string[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete(call) {
          const prompt = String((call.input as { readonly prompt?: unknown }).prompt);
          calls.push(prompt);
          return `answer:${prompt}`;
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'let name=kind value="\\"paid\\""',
        'branch on="kind"',
        '  path value="paid"',
        '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"selected\\" }"',
        '    print value="answer"',
        '  path value="refund"',
        '    capability namespace=llm operation=complete name=skipped input="{ prompt: \\"skipped\\" }"',
        '    print value="skipped"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('answer:selected\n');
    expect(calls).toEqual(['selected']);
  });

  test('async source executor awaits async capabilities in a branch default path', async () => {
    const calls: string[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete(call) {
          const prompt = String((call.input as { readonly prompt?: unknown }).prompt);
          calls.push(prompt);
          return `default:${prompt}`;
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'branch on="\\"missing\\""',
        '  path value="paid"',
        '    capability namespace=llm operation=complete name=skipped input="{ prompt: \\"skipped\\" }"',
        '    print value="skipped"',
        '  path default=true',
        '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"fallback\\" }"',
        '    print value="answer"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('default:fallback\n');
    expect(calls).toEqual(['fallback']);
  });

  test('async source executor ignores async try work in an untaken branch path', async () => {
    const calls: string[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete() {
          calls.push('llm.complete');
          return 'selected';
        },
      },
      net: {
        async fetch() {
          calls.push('net.fetch');
          return { status: 200 };
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'branch on="\\"safe\\""',
        '  path value="safe"',
        '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"selected\\" }"',
        '    print value="answer"',
        '  path value="danger"',
        '    try',
        '      capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
        '      catch name=e',
        '        print value="e.message"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete', 'net.fetch'],
      },
    );

    expect(stdout).toBe('selected\n');
    expect(calls).toEqual(['llm.complete']);
  });

  test('async source executor ignores async try work in an unselected if arm inside a branch path', async () => {
    const calls: string[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete() {
          calls.push('llm.complete');
          return 'nested';
        },
      },
      net: {
        async fetch() {
          calls.push('net.fetch');
          return { status: 200 };
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'branch on="\\"safe\\""',
        '  path value="safe"',
        '    if cond="true"',
        '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"nested\\" }"',
        '      print value="answer"',
        '    else',
        '      try',
        '        capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
        '        catch name=e',
        '          print value="e.message"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete', 'net.fetch'],
      },
    );

    expect(stdout).toBe('nested\n');
    expect(calls).toEqual(['llm.complete']);
  });

  test('async source executor awaits async try work in a selected branch path', async () => {
    const calls: string[] = [];

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'branch on="\\"danger\\""',
        '  path value="danger"',
        '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"before\\" }"',
        '    print value="answer"',
        '    try',
        '      capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
        '      print value="response.status"',
        '      finally',
        '        capability namespace=llm operation=complete name=cleanup input="{ prompt: \\"cleanup\\" }"',
        '        print value="cleanup"',
      ]),
      {
        asyncCapabilities: {
          llm: {
            async complete(call) {
              const prompt = String((call.input as { readonly prompt?: unknown }).prompt);
              calls.push(`llm:${prompt}`);
              return prompt;
            },
          },
          net: {
            async fetch() {
              calls.push('net.fetch');
              return { status: 200 };
            },
          },
        },
        providedAsyncCapabilities: ['llm.complete', 'net.fetch'],
      },
    );

    expect(stdout).toBe('before\n200\ncleanup\n');
    expect(calls).toEqual(['llm:before', 'net.fetch', 'llm:cleanup']);
  });

  test('async source executor lets selected branch paths assign outer bindings across awaited capabilities', async () => {
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete() {
          return 'inner';
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'let kind=let name=out value="\\"outer\\""',
        'branch on="\\"selected\\""',
        '  path value="selected"',
        '    capability namespace=llm operation=complete name=local input="{ prompt: \\"value\\" }"',
        '    assign target=out value="local"',
        'print value="out"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('inner\n');
  });

  test('async source executor keeps selected branch path-local bindings scoped after awaited capabilities', async () => {
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete() {
          return 'inner';
        },
      },
    };

    await expect(
      executeKernSourceAsync(
        mainProgram([
          'branch on="\\"selected\\""',
          '  path value="selected"',
          '    capability namespace=llm operation=complete name=local input="{ prompt: \\"value\\" }"',
          'print value="local"',
        ]),
        {
          asyncCapabilities,
          providedAsyncCapabilities: ['llm.complete'],
        },
      ),
    ).rejects.toThrow(KernRunnerError);
  });

  test('async source executor propagates return completion from selected branch paths after awaited capabilities', async () => {
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete() {
          return 'before-return';
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'branch on="\\"selected\\""',
        '  path value="selected"',
        '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"value\\" }"',
        '    print value="answer"',
        '    return',
        'print value="\\"after\\""',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('before-return\n');
  });

  test('async source executor awaits async capabilities sequentially inside for loops', async () => {
    const calls: string[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete(call) {
          const prompt = Number((call.input as { readonly prompt?: unknown }).prompt);
          calls.push(`start:${prompt}`);
          await Promise.resolve();
          calls.push(`done:${prompt}`);
          return prompt * 10;
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'let kind=let name=total value="0"',
        'for name=i from="1" to="4"',
        '  capability namespace=llm operation=complete name=value input="{ prompt: i }"',
        '  assign target=total value="total + value"',
        'print value="total"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('60\n');
    expect(calls).toEqual(['start:1', 'done:1', 'start:2', 'done:2', 'start:3', 'done:3']);
  });

  test('async source executor awaits rag.ingest provider and binds its portable report', async () => {
    const calls: unknown[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      rag: {
        async ingest(call) {
          calls.push(call.input);
          await Promise.resolve();
          return {
            count: 1,
            action: 'reused',
            chunkCount: 2,
            indexes: [
              {
                indexName: 'DocsIndex',
                storeKind: 'local-persistent',
                status: 'fresh',
                action: 'reused',
                chunkCount: 2,
              },
            ],
          };
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'capability namespace=rag operation=ingest name=report input="{ statusOnly: true }"',
        'print value="report.count"',
        'print value="report.action"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['rag.ingest'],
      },
    );

    expect(stdout).toBe('1\nreused\n');
    expect(calls).toEqual([{ statusOnly: true }]);
  });

  test('async source executor awaits async capabilities sequentially inside each loops', async () => {
    const calls: number[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete(call) {
          const prompt = Number((call.input as { readonly prompt?: unknown }).prompt);
          calls.push(prompt);
          await Promise.resolve();
          return prompt * 10;
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'let name=items value="[1, 2, 3]"',
        'let kind=let name=total value="0"',
        'each name=item in=items',
        '  capability namespace=llm operation=complete name=value input="{ prompt: item }"',
        '  assign target=total value="total + value"',
        'print value="total"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('60\n');
    expect(calls).toEqual([1, 2, 3]);
  });

  test('async source executor preserves break and continue inside async for loops', async () => {
    const calls: number[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete(call) {
          const prompt = Number((call.input as { readonly prompt?: unknown }).prompt);
          calls.push(prompt);
          return prompt * 10;
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'let kind=let name=total value="0"',
        'for name=i from="0" to="4"',
        '  capability namespace=llm operation=complete name=value input="{ prompt: i }"',
        '  if cond="i == 1"',
        '    continue',
        '  if cond="i == 3"',
        '    break',
        '  assign target=total value="total + value"',
        'print value="total"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('20\n');
    expect(calls).toEqual([0, 1, 2, 3]);
  });

  test('async source executor awaits nested async for and each loops sequentially', async () => {
    const calls: number[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete(call) {
          const prompt = Number((call.input as { readonly prompt?: unknown }).prompt);
          calls.push(prompt);
          await Promise.resolve();
          return prompt;
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'let name=items value="[10, 20]"',
        'let kind=let name=total value="0"',
        'for name=i from="0" to="2"',
        '  each name=item in=items',
        '    capability namespace=llm operation=complete name=value input="{ prompt: item }"',
        '    assign target=total value="total + value"',
        'print value="total"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('60\n');
    expect(calls).toEqual([10, 20, 10, 20]);
  });

  test('async source executor awaits async capabilities sequentially inside while loops', async () => {
    const calls: number[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete(call) {
          const prompt = Number((call.input as { readonly prompt?: unknown }).prompt);
          calls.push(prompt);
          await Promise.resolve();
          return prompt * 10;
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'let kind=let name=n value="0"',
        'let kind=let name=total value="0"',
        'while cond="n < 3"',
        '  capability namespace=llm operation=complete name=value input="{ prompt: n }"',
        '  assign target=total value="total + value"',
        '  assign target=n value="n + 1"',
        'print value="total"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('30\n');
    expect(calls).toEqual([0, 1, 2]);
  });

  test('async source executor skips async while bodies when the condition is initially false', async () => {
    const calls: string[] = [];

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'let kind=let name=n value="3"',
        'while cond="n < 3"',
        '  capability namespace=llm operation=complete name=value input="{ prompt: n }"',
        'print value="\\"done\\""',
      ]),
      {
        asyncCapabilities: {
          llm: {
            async complete() {
              calls.push('llm.complete');
              return 'unreached';
            },
          },
        },
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('done\n');
    expect(calls).toEqual([]);
  });

  test('async source executor preserves break and continue inside async while loops', async () => {
    const calls: number[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete(call) {
          const prompt = Number((call.input as { readonly prompt?: unknown }).prompt);
          calls.push(prompt);
          return prompt * 10;
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'let kind=let name=n value="0"',
        'let kind=let name=total value="0"',
        'while cond="n < 5"',
        '  capability namespace=llm operation=complete name=value input="{ prompt: n }"',
        '  assign target=n value="n + 1"',
        '  if cond="n == 2"',
        '    continue',
        '  if cond="n == 4"',
        '    break',
        '  assign target=total value="total + value"',
        'print value="total"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('20\n');
    expect(calls).toEqual([0, 1, 2, 3]);
  });

  test('async source executor re-evaluates while conditions after continue completions', async () => {
    const calls: number[] = [];

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'let kind=let name=n value="0"',
        'while cond="n < 1"',
        '  capability namespace=llm operation=complete name=value input="{ prompt: n }"',
        '  assign target=n value="n + 1"',
        '  continue',
        'print value="n"',
      ]),
      {
        asyncCapabilities: {
          llm: {
            async complete(call) {
              const prompt = Number((call.input as { readonly prompt?: unknown }).prompt);
              calls.push(prompt);
              return prompt;
            },
          },
        },
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('1\n');
    expect(calls).toEqual([0]);
  });

  test('async source executor keeps while body-local bindings scoped per iteration', async () => {
    const stdout = await executeKernSourceAsync(
      mainProgram([
        'let kind=let name=n value="0"',
        'while cond="n < 2"',
        '  capability namespace=llm operation=complete name=value input="{ prompt: n }"',
        '  let name=temp value="value"',
        '  assign target=n value="n + 1"',
        'print value="n"',
      ]),
      {
        asyncCapabilities: {
          llm: {
            async complete(call) {
              return Number((call.input as { readonly prompt?: unknown }).prompt);
            },
          },
        },
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('2\n');
  });

  test('async source executor propagates return completions from async while loops', async () => {
    const stdout = await executeKernSourceAsync(
      mainProgram([
        'let kind=let name=n value="0"',
        'while cond="n < 3"',
        '  capability namespace=llm operation=complete name=value input="{ prompt: n }"',
        '  return',
        'print value="\\"unreached\\""',
      ]),
      {
        asyncCapabilities: {
          llm: {
            async complete() {
              return 'ok';
            },
          },
        },
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('');
  });

  test('async source executor awaits try with async capabilities inside while loops', async () => {
    const stdout = await executeKernSourceAsync(
      mainProgram([
        'let kind=let name=n value="0"',
        'while cond="n < 1"',
        '  try',
        '    capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
        '    print value="response.status"',
        '    catch name=e',
        '      print value="e.message"',
        '  assign target=n value="n + 1"',
      ]),
      {
        asyncCapabilities: {
          net: {
            async fetch() {
              return { status: 200 };
            },
          },
        },
        providedAsyncCapabilities: ['net.fetch'],
      },
    );

    expect(stdout).toBe('200\n');
  });

  test('async source executor ignores unsupported async control flow in an unselected if arm', async () => {
    const calls: string[] = [];

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'if cond="false"',
        '  while cond="true"',
        '    capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
        'else',
        '  print value="\\"fallback\\""',
      ]),
      {
        asyncCapabilities: {
          net: {
            async fetch() {
              calls.push('net.fetch');
              return { status: 200 };
            },
          },
        },
        providedAsyncCapabilities: ['net.fetch'],
      },
    );

    expect(stdout).toBe('fallback\n');
    expect(calls).toEqual([]);
  });

  test('async source executor does not validate unselected else-if conditions before execution', async () => {
    const stdout = await executeKernSourceAsync(
      mainProgram([
        'if cond="true"',
        '  capability namespace=llm operation=complete name=answer input="{ prompt: \\"ok\\" }"',
        '  print value="answer"',
        'else',
        '  if cond="missingFlag"',
        '    print value="\\"unreached\\""',
      ]),
      {
        asyncCapabilities: {
          llm: {
            async complete() {
              return 'ok';
            },
          },
        },
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('ok\n');
  });

  test('async source executor does not enter async try work inside empty loops', async () => {
    const calls: string[] = [];
    const cases: string[][] = [
      [
        'for name=i from="0" to="0"',
        '  try',
        '    capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
        '    catch name=e',
        '      print value="e.message"',
      ],
      [
        'let name=items value="[]"',
        'each name=item in=items',
        '  try',
        '    capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
        '    catch name=e',
        '      print value="e.message"',
      ],
    ];

    for (const body of cases) {
      await expect(
        executeKernSourceAsync(mainProgram(body), {
          asyncCapabilities: {
            net: {
              async fetch() {
                calls.push('net.fetch');
                return { status: 200 };
              },
            },
          },
          providedAsyncCapabilities: ['net.fetch'],
        }),
      ).resolves.toBe('');
    }
    expect(calls).toEqual([]);
  });

  test('async source executor awaits async capability calls inside try control flow', async () => {
    const stdout = await executeKernSourceAsync(
      mainProgram([
        'try',
        '  capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
        '  print value="response.status"',
        '  catch name=e',
        '    print value="e.message"',
      ]),
      {
        asyncCapabilities: {
          net: {
            async fetch() {
              return { status: 200 };
            },
          },
        },
        providedAsyncCapabilities: ['net.fetch'],
      },
    );

    expect(stdout).toBe('200\n');
  });

  test('async source executor dispatches sequential async capabilities before and inside try', async () => {
    const calls: string[] = [];

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'capability namespace=llm operation=complete name=answer input="{ prompt: \\"before\\" }"',
        'print value="answer"',
        'try',
        '  capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
        '  print value="response.status"',
        '  catch name=e',
        '    print value="e.message"',
      ]),
      {
        asyncCapabilities: {
          llm: {
            async complete() {
              calls.push('llm.complete');
              return 'before';
            },
          },
          net: {
            async fetch() {
              calls.push('net.fetch');
              return { status: 200 };
            },
          },
        },
        providedAsyncCapabilities: ['llm.complete', 'net.fetch'],
      },
    );

    expect(stdout).toBe('before\n200\n');
    expect(calls).toEqual(['llm.complete', 'net.fetch']);
  });

  test('async source executor awaits async capability calls inside same-file helper functions', async () => {
    const calls: string[] = [];
    const stdout = await executeKernSourceAsync(
      programWithFunctions(
        [
          [
            'fn name=remote returns=number',
            '  handler lang="kern"',
            '    capability namespace=llm operation=complete name=value input="{ prompt: \\"score\\" }"',
            '    return value="value"',
          ],
        ],
        ['print value="remote()"'],
      ),
      {
        asyncCapabilities: {
          llm: {
            async complete(call) {
              calls.push(String((call.input as { readonly prompt?: unknown }).prompt));
              return 7;
            },
          },
        },
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('7\n');
    expect(calls).toEqual(['score']);
  });

  test('async source executor awaits nested same-file helper calls', async () => {
    const calls: string[] = [];
    const stdout = await executeKernSourceAsync(
      programWithFunctions(
        [
          [
            'fn name=remote returns=number',
            '  handler lang="kern"',
            '    capability namespace=llm operation=complete name=value input="{ prompt: \\"base\\" }"',
            '    return value="value"',
          ],
          ['fn name=wrapped returns=number', '  handler lang="kern"', '    return value="remote() + 1"'],
        ],
        ['print value="wrapped()"'],
      ),
      {
        asyncCapabilities: {
          llm: {
            async complete(call) {
              calls.push(String((call.input as { readonly prompt?: unknown }).prompt));
              return 7;
            },
          },
        },
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('8\n');
    expect(calls).toEqual(['base']);
  });

  test('async source executor uses async helper results in later capability input records', async () => {
    const stored: unknown[] = [];
    const stdout = await executeKernSourceAsync(
      programWithFunctions(
        [
          [
            'fn name=remote returns=string',
            '  handler lang="kern"',
            '    capability namespace=llm operation=complete name=value input="{ prompt: \\"theme\\" }"',
            '    return value="value"',
          ],
        ],
        [
          'capability namespace=storage operation=set name=ok input="{ key: \\"theme\\", value: remote() }"',
          'print value="ok"',
        ],
      ),
      {
        capabilities: {
          storage: {
            set(call) {
              stored.push(call.input);
              return true;
            },
          },
        },
        providedCapabilities: ['storage.set'],
        asyncCapabilities: {
          llm: {
            async complete() {
              return 'dark';
            },
          },
        },
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('true\n');
    expect(stored).toEqual([{ key: 'theme', value: 'dark' }]);
  });

  test('async source executor rejects sync capability side effects inside helper expressions', async () => {
    const stored: unknown[] = [];
    await expect(
      executeKernSourceAsync(
        programWithFunctions(
          [
            [
              'fn name=mutate returns=boolean',
              '  handler lang="kern"',
              '    capability namespace=storage operation=set name=ok input="{ key: \\"theme\\", value: \\"dark\\" }"',
              '    return value="ok"',
            ],
          ],
          [
            'capability namespace=llm operation=complete name=answer input="{ prompt: \\"main\\" }"',
            'print value="mutate()"',
          ],
        ),
        {
          capabilities: {
            storage: {
              set(call) {
                stored.push(call.input);
                return true;
              },
            },
          },
          providedCapabilities: ['storage.set'],
          asyncCapabilities: {
            llm: {
              async complete() {
                return 'ok';
              },
            },
          },
          providedAsyncCapabilities: ['llm.complete'],
        },
      ),
    ).rejects.toThrow(/Preconditions failed for node type "print"/);
    expect(stored).toEqual([]);
  });

  test('async source executor awaits helper calls in async if and while conditions', async () => {
    const calls: number[] = [];
    const stdout = await executeKernSourceAsync(
      programWithFunctions(
        [
          [
            'fn name=keepGoing params="n:number" returns=boolean',
            '  handler lang="kern"',
            '    capability namespace=llm operation=complete name=ok input="{ prompt: n }"',
            '    return value="ok"',
          ],
        ],
        [
          'let kind=let name=n value="0"',
          'if cond="keepGoing(n)"',
          '  print value="\\"start\\""',
          'while cond="keepGoing(n)"',
          '  assign target=n value="n + 1"',
          'print value="n"',
        ],
      ),
      {
        asyncCapabilities: {
          llm: {
            async complete(call) {
              const prompt = Number((call.input as { readonly prompt?: unknown }).prompt);
              calls.push(prompt);
              return prompt < 2;
            },
          },
        },
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('start\n2\n');
    expect(calls).toEqual([0, 0, 1, 2]);
  });

  test('async source executor consumes continue before the next async while condition pass', async () => {
    const calls: number[] = [];
    const stdout = await executeKernSourceAsync(
      programWithFunctions(
        [
          [
            'fn name=keepGoing params="n:number" returns=boolean',
            '  handler lang="kern"',
            '    capability namespace=llm operation=complete name=ok input="{ prompt: n }"',
            '    return value="ok"',
          ],
        ],
        [
          'let kind=let name=n value="0"',
          'while cond="keepGoing(n)"',
          '  assign target=n value="n + 1"',
          '  if cond="n == 1"',
          '    continue',
          '  print value="n"',
        ],
      ),
      {
        asyncCapabilities: {
          llm: {
            async complete(call) {
              const prompt = Number((call.input as { readonly prompt?: unknown }).prompt);
              calls.push(prompt);
              return prompt < 2;
            },
          },
        },
        providedAsyncCapabilities: ['llm.complete'],
      },
    );

    expect(stdout).toBe('2\n');
    expect(calls).toEqual([0, 1, 2]);
  });

  test('async source executor reports missing async providers for called helper requirements', async () => {
    await expect(
      executeKernSourceAsync(
        programWithFunctions(
          [
            [
              'fn name=remote returns=number',
              '  handler lang="kern"',
              '    capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
              '    return value="response.status"',
            ],
          ],
          ['print value="remote()"'],
        ),
        { providedAsyncCapabilities: [] },
      ),
    ).rejects.toThrow(/missing async providers: net\.fetch/);
  });

  test('async source executor ignores uncalled helper functions with async capability calls', async () => {
    await expect(
      executeKernSourceAsync(
        programWithFunctions(
          [
            [
              'fn name=remote returns=number',
              '  handler lang="kern"',
              '    capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
              '    return value="response.status"',
            ],
          ],
          ['print value="1"'],
        ),
      ),
    ).resolves.toBe('1\n');
  });

  test('async source executor rejects uncalled helper async work when another async path enters preview mode', async () => {
    await expect(
      executeKernSourceAsync(
        programWithFunctions(
          [
            [
              'fn name=remote returns=number',
              '  handler lang="kern"',
              '    capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
              '    return value="1"',
            ],
          ],
          [
            'capability namespace=llm operation=complete name=answer input="{ prompt: \\"main\\" }"',
            'print value="answer"',
          ],
        ),
        {
          asyncCapabilities: {
            llm: {
              async complete() {
                return 'ok';
              },
            },
          },
          providedAsyncCapabilities: ['llm.complete', 'net.fetch'],
        },
      ),
    ).rejects.toThrow(/async source execution outside main handler is unsupported/);
  });

  test('fails closed when a capability returns a non-portable host object', () => {
    const capabilities: KernRunnerCapabilities = {
      crypto: {
        randomUUID() {
          return new Date() as unknown as never;
        },
      },
    };

    expect(() =>
      executeKernSource(mainProgram(['capability namespace=crypto operation=randomUUID name=id']), { capabilities }),
    ).toThrow(/non-portable value/);
  });

  test('does not dispatch inherited provider object properties as capabilities', () => {
    const capabilities: KernRunnerCapabilities = { rag: {} };

    expect(() =>
      executeKernSource(mainProgram(['capability namespace=rag operation=constructor name=value']), { capabilities }),
    ).toThrow(/rag\.constructor/);
  });

  test('does not dispatch inherited capability namespace properties as providers', () => {
    expect(() => executeKernSource(mainProgram(['capability namespace=toString operation=call name=value']))).toThrow(
      /toString\.call/,
    );
  });

  test('admits portable capability DAG values with shared object references', () => {
    const chunk = { id: 'chunk-1', text: 'shared', score: 1 };
    const capabilities: KernRunnerCapabilities = {
      rag: {
        retrieve() {
          return { first: chunk, second: chunk };
        },
      },
    };

    expect(() =>
      executeKernSource(mainProgram(['capability namespace=rag operation=retrieve name=result']), { capabilities }),
    ).not.toThrow();
  });

  test('fails closed when a capability returns sparse arrays or accessor records', () => {
    const sparse = [1, 2, 3];
    delete sparse[1];
    const accessor = {};
    Object.defineProperty(accessor, 'answer', {
      enumerable: true,
      get() {
        return 'host getter';
      },
    });

    expect(() =>
      executeKernSource(mainProgram(['capability namespace=rag operation=sparse name=result']), {
        capabilities: { rag: { sparse: () => sparse } },
      }),
    ).toThrow(/non-portable value/);
    expect(() =>
      executeKernSource(mainProgram(['capability namespace=rag operation=accessor name=result']), {
        capabilities: { rag: { accessor: () => accessor as never } },
      }),
    ).toThrow(/non-portable value/);
  });

  test('exposes main handler resolution for embedders that already parsed IR', () => {
    const { root } = parseDocumentWithDiagnostics(mainProgram(['print value="42"']));
    const handler = resolveKernMainHandler(root);

    expect(handler.type).toBe('handler');
    expect(handler.children?.map((node) => node.type)).toEqual(['print']);
  });

  test('recovers if an embedder clears the public contract registry between runs', () => {
    expect(executeKernSource(mainProgram(['print value="1"']))).toBe('1\n');
    CONTRACT_REGISTRY.clear();
    expect(executeKernSource(mainProgram(['print value="2"']))).toBe('2\n');
  });

  test('recovers if an embedder leaves the public contract registry partially populated', () => {
    expect(executeKernSource(mainProgram(['print value="1"']))).toBe('1\n');
    const custom = {
      nodeType: 'custom-test-contract',
      preconditions: () => true,
      effects: () => ({ events: [], completion: { kind: 'normal' as const } }),
      completion: () => ({ kind: 'normal' as const }),
      forbiddenRewrites: [],
      fixtures: [],
    };
    CONTRACT_REGISTRY.clear();
    CONTRACT_REGISTRY.set(custom.nodeType, custom);

    try {
      expect(executeKernSource(mainProgram(['print value="2"']))).toBe('2\n');
      expect(CONTRACT_REGISTRY.get(custom.nodeType)).toBe(custom);
    } finally {
      CONTRACT_REGISTRY.delete(custom.nodeType);
    }
  });
});
