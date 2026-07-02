import { parseDocumentWithDiagnostics } from '../src/parser.js';
import {
  analyzeKernSourceCapabilities,
  CONTRACT_REGISTRY,
  createMemoryStorageCapability,
  createWebCryptoCapability,
  executeKernEntrySource,
  executeKernEntrySourceAsync,
  executeKernSource,
  executeKernSourceAsync,
  type KernRunnerAsyncCapabilities,
  type KernRunnerCapabilities,
  KernRunnerError,
  makeEnv,
  type RuntimeCapabilityHandler,
  resolveKernEntryHandler,
  resolveKernMainHandler,
} from '../src/runner.js';

function mainProgram(bodyLines: string[]): string {
  return ['fn name=main returns=void', '  handler lang="kern"', ...bodyLines.map((line) => `    ${line}`)].join('\n');
}

function programWithFunctions(functions: string[][], mainBodyLines: string[]): string {
  return [...functions.map((lines) => lines.join('\n')), mainProgram(mainBodyLines)].join('\n');
}

function memoryModuleLoader(modules: Record<string, string>, options: { readonly rejectEscape?: boolean } = {}) {
  return {
    resolve(specifier: string, context: { readonly importer: string }): string | null {
      if (options.rejectEscape && specifier.startsWith('../')) {
        throw new KernRunnerError(`link error: import '${specifier}' escapes test root`);
      }
      const base = context.importer.slice(0, context.importer.lastIndexOf('/'));
      const parts = `${base}/${specifier.endsWith('.kern') ? specifier : `${specifier}.kern`}`.split('/');
      const resolved: string[] = [];
      for (const part of parts) {
        if (!part || part === '.') continue;
        if (part === '..') resolved.pop();
        else resolved.push(part);
      }
      const path = `/${resolved.join('/')}`;
      return Object.hasOwn(modules, path) ? path : null;
    },
    readSource(path: string): string {
      const source = modules[path];
      if (source === undefined) throw new KernRunnerError(`missing test module ${path}`);
      return source;
    },
  };
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

  test('executes the handler named by a descriptor entry instead of always using main', () => {
    const source = [
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"main\\""',
      'fn name=renderHome returns=void',
      '  handler lang="kern"',
      '    print value="\\"home\\""',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    print value="\\"answer\\""',
    ].join('\n');

    expect(executeKernEntrySource(source, { kind: 'view', name: 'Home', handler: 'renderHome' })).toBe('home\n');
    expect(executeKernEntrySource(source, { kind: 'route', name: 'Answer', handler: 'answerRoute' })).toBe('answer\n');
    expect(executeKernEntrySource(source, { kind: 'view', name: 'LegacyHome', handler: 'main' })).toBe('main\n');
  });

  test('fails closed for missing and duplicate descriptor handlers', () => {
    const missing = ['fn name=main returns=void', '  handler lang="kern"', '    print value="\\"main\\""'].join('\n');
    expect(() => executeKernEntrySource(missing, { kind: 'route', name: 'Answer', handler: 'answerRoute' })).toThrow(
      /route Answer references missing handler answerRoute/,
    );

    const duplicate = [
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    print value="\\"a\\""',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    print value="\\"b\\""',
    ].join('\n');
    expect(() => executeKernEntrySource(duplicate, { kind: 'route', name: 'Answer', handler: 'answerRoute' })).toThrow(
      /route Answer references duplicate handler answerRoute/,
    );
  });

  test('resolves descriptor handlers directly from parsed IR', () => {
    const { root } = parseDocumentWithDiagnostics(
      ['fn name=renderHome returns=void', '  handler lang="kern"', '    print value="\\"home\\""'].join('\n'),
    );

    expect(resolveKernEntryHandler(root, { kind: 'view', name: 'Home', handler: 'renderHome' }).type).toBe('handler');
  });

  test('executes async descriptor handlers through the named entry', async () => {
    const source = [
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"main\\""',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"refund\\" }"',
      '    print value="answer"',
    ].join('\n');

    await expect(
      executeKernEntrySourceAsync(
        source,
        { kind: 'route', name: 'Answer', handler: 'answerRoute' },
        {
          providedAsyncCapabilities: ['llm.complete'],
          asyncCapabilities: {
            llm: {
              complete() {
                return 'grounded';
              },
            },
          },
        },
      ),
    ).resolves.toBe('grounded\n');
  });

  test('async descriptor handlers bind records and arrays returned from pure helper functions', async () => {
    const source = [
      'fn name=makeInput params="prompt:string" returns=PromptInput',
      '  handler lang="kern"',
      '    return value="{ prompt: prompt, prefix: \\"answer:\\" }"',
      'fn name=markers returns=string[]',
      '  handler lang="kern"',
      "    return value=\"['before', 'after']\"",
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    let name=input value="makeInput(\'refund\')"',
      '    let name=labels value="markers()"',
      '    print value="labels[0]"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: input.prompt }"',
      '    print value="input.prefix"',
      '    print value="answer"',
      '    print value="labels[1]"',
    ].join('\n');

    await expect(
      executeKernEntrySourceAsync(
        source,
        { kind: 'route', name: 'Answer', handler: 'answerRoute' },
        {
          providedAsyncCapabilities: ['llm.complete'],
          asyncCapabilities: {
            llm: {
              complete(call) {
                return `ok ${call.input && typeof call.input === 'object' ? call.input.prompt : 'missing'}`;
              },
            },
          },
        },
      ),
    ).resolves.toBe('before\nanswer:\nok refund\nafter\n');
  });

  test('async descriptor preflight ignores sync capability requirements unreachable from the selected entry', async () => {
    const source = [
      'fn name=unused returns=void',
      '  handler lang="kern"',
      '    capability namespace=storage operation=get name=value input="{ key: \\"unused\\" }"',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"refund\\" }"',
      '    print value="answer"',
    ].join('\n');

    await expect(
      executeKernEntrySourceAsync(
        source,
        { kind: 'route', name: 'Answer', handler: 'answerRoute' },
        {
          providedCapabilities: [],
          providedAsyncCapabilities: ['llm.complete'],
          asyncCapabilities: {
            llm: {
              complete() {
                return 'grounded';
              },
            },
          },
        },
      ),
    ).resolves.toBe('grounded\n');
  });

  test('async descriptor preflight ignores async capability requirements unreachable from the selected entry', async () => {
    const source = [
      'fn name=unusedAsync returns=void',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"unused\\" }"',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    capability namespace=rag operation=retrieveAsync name=chunks input="{ query: \\"refund\\" }"',
      '    print value="chunks[0]"',
    ].join('\n');

    await expect(
      executeKernEntrySourceAsync(
        source,
        { kind: 'route', name: 'Answer', handler: 'answerRoute' },
        {
          providedAsyncCapabilities: ['rag.retrieveAsync'],
          asyncCapabilities: {
            rag: {
              retrieveAsync() {
                return ['policy'];
              },
            },
          },
        },
      ),
    ).resolves.toBe('policy\n');
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

  test('binds records and arrays returned from pure helper functions', () => {
    const stdout = executeKernSource(
      programWithFunctions(
        [
          [
            'fn name=makeSummary params="name:string,count:number" returns=Summary',
            '  handler lang="kern"',
            '    return value="{ name: name, count: count }"',
          ],
          [
            'fn name=makeLabels returns=string[]',
            '  handler lang="kern"',
            "    return value=\"['policy', 'receipt']\"",
          ],
        ],
        [
          'let name=summary value="makeSummary(\'refund\', 2)"',
          'print value="summary.name"',
          'print value="summary.count"',
          'let name=labels value="makeLabels()"',
          'print value="labels.length"',
          'print value="labels[0]"',
          'each name=label in=labels',
          '  print value="label"',
        ],
      ),
    );

    expect(stdout).toBe('refund\n2\n2\npolicy\npolicy\nreceipt\n');
  });

  test('aliases records, arrays, and class instances through let and helper arguments', () => {
    const stdout = executeKernSource(
      [
        'class name=Label',
        '  field name=value type=string',
        '  constructor',
        '    param name=value type=string',
        '    handler lang="kern"',
        '      assign target="this.value" value="value"',
        '  method name=read returns=string',
        '    handler lang="kern"',
        '      return value="this.value"',
        'fn name=summarize params="query:any,markers:any" returns=string',
        '  handler lang="kern"',
        '    return value="query.question + \':\' + markers[0]"',
        'fn name=labelOf params="label:any" returns=string',
        '  handler lang="kern"',
        '    return value="label.read()"',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    let name=query value="{ question: \\"refund\\" }"',
        '    let name=queryAlias value="query"',
        '    let name=markers value="[\'policy\']"',
        '    let name=markerAlias value="markers"',
        '    print value="summarize(queryAlias, markerAlias)"',
        '    let name=label value="new Label(\'ok\')"',
        '    let name=labelAlias value="label"',
        '    print value="labelOf(labelAlias)"',
      ].join('\n'),
    );

    expect(stdout).toBe('refund:policy\nok\n');
  });

  test('helper functions can return runner class instances through bindings', () => {
    const stdout = executeKernSource(
      [
        'class name=Label',
        '  field name=value type=string',
        '  constructor',
        '    param name=value type=string',
        '    handler lang="kern"',
        '      assign target="this.value" value="value"',
        '  method name=read returns=string',
        '    handler lang="kern"',
        '      return value="this.value"',
        'fn name=makeLabel params="value:string" returns=Label',
        '  handler lang="kern"',
        '    let name=label value="new Label(value)"',
        '    return value="label"',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    let name=label value="makeLabel(\'ok\')"',
        '    print value="label.read()"',
      ].join('\n'),
    );

    expect(stdout).toBe('ok\n');
  });

  test('rejects runner functions that mutate class instance arguments', () => {
    expect(() =>
      executeKernSource(
        [
          'class name=Label',
          '  field name=value type=string',
          '  constructor',
          '    param name=value type=string',
          '    handler lang="kern"',
          '      assign target="this.value" value="value"',
          '  method name=read returns=string',
          '    handler lang="kern"',
          '      return value="this.value"',
          'fn name=mutate params="label:any" returns=string',
          '  handler lang="kern"',
          '    assign target="label.value" value="\'bad\'"',
          '    return value="label.read()"',
          'fn name=main returns=void',
          '  handler lang="kern"',
          '    let name=label value="new Label(\'ok\')"',
          '    print value="mutate(label)"',
        ].join('\n'),
      ),
    ).toThrow(/Preconditions failed for node type "print"/);
  });

  test('rejects runner functions that mutate class instance argument aliases', () => {
    expect(() =>
      executeKernSource(
        [
          'class name=Label',
          '  field name=value type=string',
          '  constructor',
          '    param name=value type=string',
          '    handler lang="kern"',
          '      assign target="this.value" value="value"',
          '  method name=read returns=string',
          '    handler lang="kern"',
          '      return value="this.value"',
          'fn name=mutate params="label:any" returns=string',
          '  handler lang="kern"',
          '    let name=alias value="label"',
          '    assign target="alias.value" value="\'bad\'"',
          '    return value="alias.read()"',
          'fn name=main returns=void',
          '  handler lang="kern"',
          '    let name=label value="new Label(\'ok\')"',
          '    print value="mutate(label)"',
        ].join('\n'),
      ),
    ).toThrow(/Preconditions failed for node type "print"/);
  });

  test('allows runner functions to mutate local class instances', () => {
    const stdout = executeKernSource(
      [
        'class name=Label',
        '  field name=value type=string',
        '  constructor',
        '    param name=value type=string',
        '    handler lang="kern"',
        '      assign target="this.value" value="value"',
        '  method name=read returns=string',
        '    handler lang="kern"',
        '      return value="this.value"',
        'fn name=makeLabel returns=string',
        '  handler lang="kern"',
        '    let name=label value="new Label(\'ok\')"',
        '    assign target="label.value" value="\'local\'"',
        '    return value="label.read()"',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    print value="makeLabel()"',
      ].join('\n'),
    );

    expect(stdout).toBe('local\n');
  });

  test('allows local class instance mutation after a child scope shadows the same name with an argument alias', () => {
    const stdout = executeKernSource(
      [
        'class name=Label',
        '  field name=value type=string',
        '  constructor',
        '    param name=value type=string',
        '    handler lang="kern"',
        '      assign target="this.value" value="value"',
        '  method name=read returns=string',
        '    handler lang="kern"',
        '      return value="this.value"',
        'fn name=mutateLocal params="label:any" returns=string',
        '  handler lang="kern"',
        '    let name=alias value="new Label(\'local\')"',
        '    for name=i from="0" to="1"',
        '      let name=alias value="label"',
        '    assign target="alias.value" value="\'still-local\'"',
        '    return value="alias.read()"',
        'fn name=main returns=void',
        '  handler lang="kern"',
        '    let name=label value="new Label(\'ok\')"',
        '    print value="mutateLocal(label)"',
        '    print value="label.read()"',
      ].join('\n'),
    );

    expect(stdout).toBe('still-local\nok\n');
  });

  test('sync helper arguments accept record values returned by nested helpers', () => {
    const stdout = executeKernSource(
      programWithFunctions(
        [
          [
            'fn name=makeQuery params="question:string" returns=Query',
            '  handler lang="kern"',
            '    return value="{ question: question }"',
          ],
          [
            'fn name=questionText params="query:any" returns=string',
            '  handler lang="kern"',
            '    return value="query.question"',
          ],
        ],
        ['print value="questionText(makeQuery(\'refund\'))"'],
      ),
    );

    expect(stdout).toBe('refund\n');
  });

  test('async helpers accept record and array arguments from descriptor handlers', async () => {
    const source = [
      'fn name=promptText params="query:any,markers:any" returns=string',
      '  handler lang="kern"',
      '    return value="query.question + \':\' + markers[0]"',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    let name=query value="{ question: \\"refund\\" }"',
      '    let name=queryAlias value="query"',
      '    let name=markers value="[\'policy\']"',
      '    let name=markerAlias value="markers"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: promptText(queryAlias, markerAlias) }"',
      '    print value="answer"',
    ].join('\n');

    await expect(
      executeKernEntrySourceAsync(
        source,
        { kind: 'route', name: 'Answer', handler: 'answerRoute' },
        {
          providedAsyncCapabilities: ['llm.complete'],
          asyncCapabilities: {
            llm: {
              complete(call) {
                return String(call.input && typeof call.input === 'object' ? call.input.prompt : 'missing');
              },
            },
          },
        },
      ),
    ).resolves.toBe('refund:policy\n');
  });

  test('async descriptor handlers await helper calls used as class method arguments', async () => {
    const source = [
      'class name=Sink',
      '  method name=accept returns=string',
      '    param name=value type=string',
      '    handler lang="kern"',
      '      return value="value"',
      'fn name=remote returns=string',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"member\\" }"',
      '    return value="answer"',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    let name=sink value="new Sink()"',
      '    print value="sink.accept(remote())"',
    ].join('\n');

    await expect(
      executeKernEntrySourceAsync(
        source,
        { kind: 'route', name: 'Answer', handler: 'answerRoute' },
        {
          providedAsyncCapabilities: ['llm.complete'],
          asyncCapabilities: {
            llm: {
              complete() {
                return 'ok';
              },
            },
          },
        },
      ),
    ).resolves.toBe('ok\n');
  });

  test('async descriptor handlers fail closed for capability calls inside class methods', async () => {
    const source = [
      'class name=RemoteLabel',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"method\\" }"',
      '      return value="answer"',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    let name=label value="new RemoteLabel()"',
      '    print value="label.read()"',
    ].join('\n');

    let calls = 0;
    await expect(
      executeKernEntrySourceAsync(
        source,
        { kind: 'route', name: 'Answer', handler: 'answerRoute' },
        {
          providedAsyncCapabilities: ['llm.complete'],
          asyncCapabilities: {
            llm: {
              complete() {
                calls += 1;
                return 'ok';
              },
            },
          },
        },
      ),
    ).rejects.toThrow(KernRunnerError);
    expect(calls).toBe(0);
  });

  test('async descriptor handlers fail closed for capability calls inside constructors', async () => {
    const source = [
      'class name=RemoteLabel',
      '  field name=value type=string',
      '  constructor',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"constructor\\" }"',
      '      assign target="this.value" value="answer"',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      return value="this.value"',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    let name=label value="new RemoteLabel()"',
      '    print value="label.read()"',
    ].join('\n');

    let calls = 0;
    await expect(
      executeKernEntrySourceAsync(
        source,
        { kind: 'route', name: 'Answer', handler: 'answerRoute' },
        {
          providedAsyncCapabilities: ['llm.complete'],
          asyncCapabilities: {
            llm: {
              complete() {
                calls += 1;
                return 'ok';
              },
            },
          },
        },
      ),
    ).rejects.toThrow(KernRunnerError);
    expect(calls).toBe(0);
  });

  test('async descriptor handlers fail closed for async class field and super initializer paths', async () => {
    const source = [
      'class name=BaseLabel',
      '  field name=value type=string',
      '  constructor',
      '    param name=value type=string',
      '    handler lang="kern"',
      '      assign target="this.value" value="value"',
      'class name=RemoteLabel extends=BaseLabel',
      '  field name=mode type=string value="remoteValue()"',
      '  constructor',
      '    handler lang="kern"',
      '      do value="super(remoteValue())"',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      return value="this.value + \':\' + this.mode"',
      'fn name=remoteValue returns=string',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"class-init\\" }"',
      '    return value="answer"',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    let name=label value="new RemoteLabel()"',
      '    print value="label.read()"',
    ].join('\n');

    let calls = 0;
    await expect(
      executeKernEntrySourceAsync(
        source,
        { kind: 'route', name: 'Answer', handler: 'answerRoute' },
        {
          providedAsyncCapabilities: ['llm.complete'],
          asyncCapabilities: {
            llm: {
              complete() {
                calls += 1;
                return 'ok';
              },
            },
          },
        },
      ),
    ).rejects.toThrow(KernRunnerError);
    expect(calls).toBe(0);
  });

  test('async helper functions await nested helper arguments and can return class instances', async () => {
    const source = [
      'class name=Label',
      '  field name=value type=string',
      '  constructor',
      '    param name=value type=string',
      '    handler lang="kern"',
      '      assign target="this.value" value="value"',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      return value="this.value"',
      'fn name=remote returns=string',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"nested\\" }"',
      '    return value="answer"',
      'fn name=wrap params="value:string" returns=string',
      '  handler lang="kern"',
      '    return value="value"',
      'fn name=makeLabel returns=Label',
      '  handler lang="kern"',
      '    let name=label value="new Label(wrap(remote()))"',
      '    return value="label"',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    let name=label value="makeLabel()"',
      '    print value="label.read()"',
    ].join('\n');

    await expect(
      executeKernEntrySourceAsync(
        source,
        { kind: 'route', name: 'Answer', handler: 'answerRoute' },
        {
          providedAsyncCapabilities: ['llm.complete'],
          asyncCapabilities: {
            llm: {
              complete() {
                return 'ok';
              },
            },
          },
        },
      ),
    ).resolves.toBe('ok\n');
  });

  test('async helper functions reject class instance argument mutation', async () => {
    const source = [
      'class name=Label',
      '  field name=value type=string',
      '  constructor',
      '    param name=value type=string',
      '    handler lang="kern"',
      '      assign target="this.value" value="value"',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      return value="this.value"',
      'fn name=mutate params="label:any" returns=string',
      '  handler lang="kern"',
      '    assign target="label.value" value="\'bad\'"',
      '    return value="label.read()"',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    let name=label value="new Label(\'ok\')"',
      '    print value="mutate(label)"',
    ].join('\n');

    await expect(
      executeKernEntrySourceAsync(source, { kind: 'route', name: 'Answer', handler: 'answerRoute' }),
    ).rejects.toThrow(/Preconditions failed for node type "print"/);
  });

  test('async helper functions reject class instance argument alias mutation', async () => {
    const source = [
      'class name=Label',
      '  field name=value type=string',
      '  constructor',
      '    param name=value type=string',
      '    handler lang="kern"',
      '      assign target="this.value" value="value"',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      return value="this.value"',
      'fn name=mutate params="label:any" returns=string',
      '  handler lang="kern"',
      '    let name=alias value="label"',
      '    assign target="alias.value" value="\'bad\'"',
      '    return value="alias.read()"',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    let name=label value="new Label(\'ok\')"',
      '    print value="mutate(label)"',
    ].join('\n');

    await expect(
      executeKernEntrySourceAsync(source, { kind: 'route', name: 'Answer', handler: 'answerRoute' }),
    ).rejects.toThrow(/Preconditions failed for node type "print"/);
  });

  test('async helper functions allow local class instance mutation', async () => {
    const source = [
      'class name=Label',
      '  field name=value type=string',
      '  constructor',
      '    param name=value type=string',
      '    handler lang="kern"',
      '      assign target="this.value" value="value"',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      return value="this.value"',
      'fn name=makeLabel returns=string',
      '  handler lang="kern"',
      '    let name=label value="new Label(\'ok\')"',
      '    assign target="label.value" value="\'local\'"',
      '    return value="label.read()"',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    print value="makeLabel()"',
    ].join('\n');

    await expect(
      executeKernEntrySourceAsync(source, { kind: 'route', name: 'Answer', handler: 'answerRoute' }),
    ).resolves.toBe('local\n');
  });

  test('async helper functions allow local mutation after child-scope alias shadowing', async () => {
    const source = [
      'class name=Label',
      '  field name=value type=string',
      '  constructor',
      '    param name=value type=string',
      '    handler lang="kern"',
      '      assign target="this.value" value="value"',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      return value="this.value"',
      'fn name=mutateLocal params="label:any" returns=string',
      '  handler lang="kern"',
      '    let name=alias value="new Label(\'local\')"',
      '    for name=i from="0" to="1"',
      '      let name=alias value="label"',
      '    assign target="alias.value" value="\'still-local\'"',
      '    return value="alias.read()"',
      'fn name=answerRoute returns=void',
      '  handler lang="kern"',
      '    let name=label value="new Label(\'ok\')"',
      '    print value="mutateLocal(label)"',
      '    print value="label.read()"',
    ].join('\n');

    await expect(
      executeKernEntrySourceAsync(source, { kind: 'route', name: 'Answer', handler: 'answerRoute' }),
    ).resolves.toBe('still-local\nok\n');
  });

  test('fails closed when a helper returns a record into a scalar-only expression context', () => {
    expect(() =>
      executeKernSource(
        programWithFunctions(
          [
            [
              'fn name=makeSummary returns=Summary',
              '  handler lang="kern"',
              '    return value="{ name: \\"refund\\" }"',
            ],
          ],
          ['print value="makeSummary()"'],
        ),
      ),
    ).toThrow(KernRunnerError);
  });

  test('executes native runner classes with constructors, methods, inheritance, and super dispatch', () => {
    const source = [
      'class name=BaseLabel',
      '  field name=prefix type=string',
      '  constructor',
      '    param name=prefix type=string',
      '    handler lang="kern"',
      '      assign target="this.prefix" value="prefix"',
      '  method name=label returns=string',
      '    handler lang="kern"',
      '      return value="this.prefix"',
      'class name=ChildLabel extends=BaseLabel',
      '  constructor',
      '    param name=prefix type=string',
      '    handler lang="kern"',
      '      do value="super(prefix)"',
      '  method name=label returns=string',
      '    handler lang="kern"',
      '      return value="super.label() + \'/child\'"',
      'fn name=describe params="prefix:string" returns=string',
      '  handler lang="kern"',
      '    let name=label value="new ChildLabel(prefix)"',
      '    return value="label.label()"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="new ChildLabel(\'x\')"',
      '    print value="label.label()"',
      '    print value="describe(\'y\')"',
    ].join('\n');

    expect(executeKernSource(source)).toBe('x/child\ny/child\n');
  });

  test('fails closed for invalid native runner class registries', () => {
    expect(() =>
      executeKernSource(
        [
          'class name=Duplicate',
          'class name=Duplicate',
          'fn name=main returns=void',
          '  handler lang="kern"',
          '    print value="1"',
        ].join('\n'),
      ),
    ).toThrow(/duplicate runner class 'Duplicate'/);

    expect(() =>
      executeKernSource(
        [
          'class name=ChildLabel extends=MissingBase',
          'fn name=main returns=void',
          '  handler lang="kern"',
          '    print value="1"',
        ].join('\n'),
      ),
    ).toThrow(/runner class 'ChildLabel' extends unknown class 'MissingBase'/);

    expect(() =>
      executeKernSource(
        [
          'class name=A extends=B',
          'class name=B extends=A',
          'fn name=main returns=void',
          '  handler lang="kern"',
          '    print value="1"',
        ].join('\n'),
      ),
    ).toThrow(/runner class 'A' has cyclic inheritance/);

    expect(() =>
      executeKernSource(
        [
          'class name=buildLabel',
          'fn name=buildLabel returns=string',
          '  handler lang="kern"',
          '    return value="\'x\'"',
          'fn name=main returns=void',
          '  handler lang="kern"',
          '    print value="buildLabel()"',
        ].join('\n'),
      ),
    ).toThrow(/runner class 'buildLabel' conflicts with runner function 'buildLabel'/);

    expect(() =>
      executeKernSource(
        [
          'class name=DuplicateMember',
          '  method name=label returns=string',
          '    handler lang="kern"',
          '      return value="\'a\'"',
          '  method name=label returns=string',
          '    handler lang="kern"',
          '      return value="\'b\'"',
          'fn name=main returns=void',
          '  handler lang="kern"',
          '    print value="1"',
        ].join('\n'),
      ),
    ).toThrow(/runner class 'DuplicateMember' has duplicate method 'label'/);

    expect(() =>
      executeKernSource(
        [
          'class name=BaseLabel',
          '  field name=prefix type=string',
          '  constructor',
          '    param name=prefix type=string',
          '    handler lang="kern"',
          '      assign target="this.prefix" value="prefix"',
          'class name=ChildLabel extends=BaseLabel',
          '  constructor',
          '    param name=prefix type=string',
          '    handler lang="kern"',
          '      do value="super(prefix)"',
          '  method name=bad returns=string',
          '    handler lang="kern"',
          '      let name=ignored value="super(\'bad\')"',
          '      return value="this.prefix"',
          'fn name=main returns=void',
          '  handler lang="kern"',
          '    let name=label value="new ChildLabel(\'x\')"',
          '    print value="label.bad()"',
        ].join('\n'),
      ),
    ).toThrow(KernRunnerError);
  });

  test('keeps runner class instances isolated when semantic envs are cloned', () => {
    const instance = {
      __kernRunnerClassInstance: true as const,
      className: 'Box',
      fields: { value: 'original' },
    };
    const original = makeEnv({ bindings: new Map([['box', instance]]) });
    const cloned = makeEnv(original);

    const clonedBox = cloned.bindings.get('box') as typeof instance;
    clonedBox.fields.value = 'clone';

    expect(instance.fields.value).toBe('original');
    expect(clonedBox.fields.value).toBe('clone');
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

  // Milestone 5.1b — same-file recursion (direct self-calls and mutual/indirect
  // cycles) is now SUPPORTED, with an explicit call-depth limit (512) as the
  // only fail-closed fence against runaway/infinite recursion. This test used
  // to assert that ANY recursive call was rejected outright; it now asserts
  // the more precise behavior — unbounded mutual recursion with no base case
  // still fails closed, but only once it exceeds the depth limit, not on the
  // first re-entry.
  test('fails closed once unbounded mutual recursion exceeds the call-depth limit', () => {
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

  test('calls a self-recursive helper with a base case (factorial)', () => {
    const stdout = executeKernSource(
      programWithFunctions(
        [
          [
            'fn name=factorial params="n:number" returns=number',
            '  handler lang="kern"',
            '    if cond="n <= 1"',
            '      return value="1"',
            '    return value="n * factorial(n - 1)"',
          ],
        ],
        ['print value="factorial(5)"'],
      ),
    );

    expect(stdout).toBe('120\n');
  });

  test('calls mutually recursive helpers with a base case (even/odd)', () => {
    const stdout = executeKernSource(
      programWithFunctions(
        [
          [
            'fn name=isEven params="n:number" returns=boolean',
            '  handler lang="kern"',
            '    if cond="n == 0"',
            '      return value="true"',
            '    return value="isOdd(n - 1)"',
          ],
          [
            'fn name=isOdd params="n:number" returns=boolean',
            '  handler lang="kern"',
            '    if cond="n == 0"',
            '      return value="false"',
            '    return value="isEven(n - 1)"',
          ],
        ],
        ['print value="isEven(10)"', 'print value="isOdd(10)"'],
      ),
    );

    expect(stdout).toBe('true\nfalse\n');
  });

  test('supports recursion up to and including the 512-deep call limit', () => {
    const stdout = executeKernSource(
      programWithFunctions(
        [
          [
            'fn name=countdown params="n:number" returns=number',
            '  handler lang="kern"',
            '    if cond="n <= 0"',
            '      return value="0"',
            '    return value="1 + countdown(n - 1)"',
          ],
        ],
        ['print value="countdown(511)"'],
      ),
    );

    expect(stdout).toBe('511\n');
  });

  test('fails closed with a controlled error once recursion exceeds the 512-deep call limit', () => {
    expect(() =>
      executeKernSource(
        programWithFunctions(
          [
            [
              'fn name=countdown params="n:number" returns=number',
              '  handler lang="kern"',
              '    if cond="n <= 0"',
              '        return value="0"',
              '    return value="1 + countdown(n - 1)"',
            ],
          ],
          ['print value="countdown(600)"'],
        ),
      ),
    ).toThrow(KernRunnerError);
  });

  test('appends to an array with `do value="xs.push(...)"` and reads the result back', () => {
    const stdout = executeKernSource(
      mainProgram([
        'let name=xs value="[1,2]"',
        'do value="xs.push(3)"',
        'print value="xs[2]"',
        'print value="xs.length"',
      ]),
    );

    expect(stdout).toBe('3\n3\n');
  });

  test('builds a result list across a loop via repeated `do value="xs.push(...)"`', () => {
    const stdout = executeKernSource(
      mainProgram([
        'let name=results value="[]"',
        'for name=i from="0" to="3"',
        '  do value="results.push(i * 2)"',
        'print value="results[0]"',
        'print value="results[1]"',
        'print value="results[2]"',
        'print value="results.length"',
      ]),
    );

    expect(stdout).toBe('0\n2\n4\n3\n');
  });

  test('fails closed pushing onto a non-array binding', () => {
    expect(() =>
      executeKernSource(mainProgram(['let name=n value="1"', 'do value="n.push(1)"', 'print value="1"'])),
    ).toThrow(KernRunnerError);
  });

  test('reads List.length(xs) and builds/reads a Map via new Map()/Map.set/Map.get/Map.has', () => {
    const stdout = executeKernSource(
      mainProgram([
        'let name=xs value="[10,20,30]"',
        'print value="List.length(xs)"',
        'let name=m value="new Map()"',
        'do value="Map.set(m, \\"a\\", 1)"',
        'print value="Map.get(m, \\"a\\")"',
        'print value="Map.has(m, \\"a\\")"',
        'print value="Map.has(m, \\"missing\\")"',
      ]),
    );

    expect(stdout).toBe('3\n1\ntrue\nfalse\n');
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

  test('async source executor awaits rag.retrieveAsync provider and binds portable chunks', async () => {
    const calls: unknown[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      rag: {
        async retrieveAsync(call) {
          calls.push(call.input);
          await Promise.resolve();
          return [
            {
              id: 'chunk-1',
              text: 'refund policy money back within thirty days',
              score: 0.99,
              source: 'docs/refunds.md',
              citationUri: 'docs/refunds.md',
              citationLocator: null,
            },
          ];
        },
      },
    };

    const stdout = await executeKernSourceAsync(
      mainProgram([
        'capability namespace=rag operation=retrieveAsync name=chunks input="{ question: \\"refund\\", retrieval: \\"FindDocs\\" }"',
        'print value="chunks.length"',
        'each name=chunk in=chunks',
        '  print value="chunk.source"',
      ]),
      {
        asyncCapabilities,
        providedAsyncCapabilities: ['rag.retrieveAsync'],
      },
    );

    expect(stdout).toBe('1\ndocs/refunds.md\n');
    expect(calls).toEqual([{ question: 'refund', retrieval: 'FindDocs' }]);
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

  test('async source executor fails closed during preflight for async helpers called from unsupported expression slots', async () => {
    await expect(
      executeKernSourceAsync(
        programWithFunctions(
          [
            [
              'fn name=remote returns=string',
              '  handler lang="kern"',
              '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"helper\\" }"',
              '    return value="answer"',
            ],
          ],
          ['branch on="remote()"', '  path value="ok"', '    print value="\\"ok\\""'],
        ),
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
    ).rejects.toThrow(/unsupported async executions: llm\.complete/);
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
    ).rejects.toThrow(/unsupported async executions: net\.fetch/);
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

describe('@kernlang/core/runner module linking', () => {
  test('executes imported pure helper functions and classes by explicit alias', () => {
    const modules = {
      '/app/math.kern': [
        'fn name=double params="x:number" returns=number export=true',
        '  handler lang="kern"',
        '    return value="x * 2"',
        'class name=Box export=true',
        '  field name=value value="10"',
        '  method name=read returns=number',
        '    handler lang="kern"',
        '      return value="this.value"',
      ].join('\n'),
    };
    const root = [
      'use path="./math"',
      '  from name=double kind=fn as=twice',
      '  from name=Box kind=class as=ImportedBox',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="twice(21)"',
      '    let name=box value="new ImportedBox()"',
      '    print value="box.read()"',
    ].join('\n');

    expect(
      executeKernSource(root, {
        sourcePath: '/app/main.kern',
        moduleLoader: memoryModuleLoader(modules),
      }),
    ).toBe('42\n10\n');
  });

  test('capability preflight aggregates imported module requirements', () => {
    const modules = {
      '/app/helper.kern': [
        'fn name=readConfig returns=string export=true',
        '  handler lang="kern"',
        '    capability namespace=fs operation=readText name=text input="{ path: \\"config.txt\\" }"',
        '    return value="text"',
      ].join('\n'),
    };
    const root = [
      'use path="./helper"',
      '  from name=readConfig kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"root\\""',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(root, {
      sourcePath: '/app/main.kern',
      moduleLoader: memoryModuleLoader(modules),
      providedCapabilities: [],
      providedAsyncCapabilities: [],
    });

    expect(analysis.requirements.map((requirement) => requirement.id)).toEqual(['fs.readText']);
    expect(analysis.plannedCapabilities.map((requirement) => requirement.id)).toEqual(['fs.readText']);
  });

  test('missing export rejects before stdout', () => {
    const root = [
      'use path="./helper"',
      '  from name=missing kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"unreached\\""',
    ].join('\n');
    expect(() =>
      executeKernSource(root, {
        sourcePath: '/app/main.kern',
        moduleLoader: memoryModuleLoader({ '/app/helper.kern': '' }),
      }),
    ).toThrow(/does not export 'missing'/);
  });

  test('export=true re-export is additive: the module can call the symbol locally', () => {
    const modules = {
      '/app/base.kern': [
        'fn name=double returns=number export=true',
        '  param name=n type=number',
        '  handler lang="kern"',
        '    return value="n * 2"',
      ].join('\n'),
      '/app/mid.kern': [
        'use path="./base"',
        '  from name=double kind=fn export=true',
        'fn name=quad returns=number export=true',
        '  param name=n type=number',
        '  handler lang="kern"',
        '    return value="double(double(n))"',
      ].join('\n'),
    };
    const root = [
      'use path="./mid"',
      '  from name=quad kind=fn',
      '  from name=double kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="quad(3)"',
      '    print value="double(5)"',
    ].join('\n');

    expect(
      executeKernSource(root, { sourcePath: '/app/main.kern', moduleLoader: memoryModuleLoader(modules) }),
    ).toBe('12\n10\n');
  });

  test('module loader returning non-string source fails closed as a link error', () => {
    const root = [
      'use path="./helper"',
      '  from name=helper kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"unreached\\""',
    ].join('\n');
    const loader = {
      resolve: (specifier: string) => (specifier.startsWith('./helper') ? '/app/helper.kern' : null),
      readSource: () => 42 as unknown as string,
    };
    expect(() =>
      executeKernSource(root, { sourcePath: '/app/main.kern', moduleLoader: loader }),
    ).toThrow(/source is unavailable/);
  });

  test('async executor delegates sync-only multi-file programs with the module loader intact', async () => {
    const modules = {
      '/app/helper.kern': [
        'fn name=double returns=number export=true',
        '  param name=n type=number',
        '  handler lang="kern"',
        '    return value="n * 2"',
      ].join('\n'),
    };
    const root = [
      'use path="./helper"',
      '  from name=double kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="double(21)"',
    ].join('\n');

    await expect(
      executeKernSourceAsync(root, { sourcePath: '/app/main.kern', moduleLoader: memoryModuleLoader(modules) }),
    ).resolves.toBe('42\n');
  });

  test('duplicate imported aliases reject at link time', () => {
    const root = [
      'use path="./helper"',
      '  from name=a kind=fn as=same',
      '  from name=b kind=fn as=same',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"unreached\\""',
    ].join('\n');
    const helper = [
      'fn name=a returns=number export=true',
      '  handler lang="kern"',
      '    return value="1"',
      'fn name=b returns=number export=true',
      '  handler lang="kern"',
      '    return value="2"',
    ].join('\n');
    expect(() =>
      executeKernSource(root, {
        sourcePath: '/app/main.kern',
        moduleLoader: memoryModuleLoader({ '/app/helper.kern': helper }),
      }),
    ).toThrow(/duplicate imported alias 'same'/);
  });

  test('runtime import cycles reject fail-closed', () => {
    const modules = {
      '/app/a.kern': [
        'use path="./b"',
        '  from name=b kind=fn',
        'fn name=a returns=number export=true',
        '  handler lang="kern"',
        '    return value="1"',
      ].join('\n'),
      '/app/b.kern': [
        'use path="./a"',
        '  from name=a kind=fn',
        'fn name=b returns=number export=true',
        '  handler lang="kern"',
        '    return value="2"',
      ].join('\n'),
    };
    const root = [
      'use path="./a"',
      '  from name=a kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="a()"',
    ].join('\n');
    expect(() =>
      executeKernSource(root, {
        sourcePath: '/app/main.kern',
        moduleLoader: memoryModuleLoader(modules),
      }),
    ).toThrow(/import cycle/);
  });

  test('fn main in imported files rejects at link time', () => {
    const root = [
      'use path="./helper"',
      '  from name=helper kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"unreached\\""',
    ].join('\n');
    const helper = [
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"bad\\""',
      'fn name=helper returns=number export=true',
      '  handler lang="kern"',
      '    return value="1"',
    ].join('\n');
    expect(() =>
      executeKernSource(root, {
        sourcePath: '/app/main.kern',
        moduleLoader: memoryModuleLoader({ '/app/helper.kern': helper }),
      }),
    ).toThrow(/must not declare fn main/);
  });

  test('host path containment errors reject before execution', () => {
    const root = [
      'use path="../outside"',
      '  from name=helper kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"unreached\\""',
    ].join('\n');
    expect(() =>
      executeKernSource(root, {
        sourcePath: '/app/main.kern',
        moduleLoader: memoryModuleLoader({}, { rejectEscape: true }),
      }),
    ).toThrow(/escapes test root/);
  });

  // ── Finding 3: modules are singletons with their OWN scope ─────────────────
  // Imported symbols are references into the defining module's environment, not
  // copies flattened into the root callable namespace.

  test('exported helper can call a PRIVATE same-module helper through an import', () => {
    const modules = {
      '/app/m.kern': [
        'fn name=priv params="x:number" returns=number',
        '  handler lang="kern"',
        '    return value="x + 100"',
        'fn name=pub params="x:number" returns=number export=true',
        '  handler lang="kern"',
        '    return value="priv(x)"',
      ].join('\n'),
    };
    const root = [
      'use path="./m"',
      '  from name=pub kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="pub(5)"',
    ].join('\n');
    expect(executeKernSource(root, { sourcePath: '/app/main.kern', moduleLoader: memoryModuleLoader(modules) })).toBe(
      '105\n',
    );
  });

  test('two-level transitive imports (A imports B, B imports C) link and execute', () => {
    const modules = {
      '/app/a.kern': [
        'use path="./b"',
        '  from name=b kind=fn',
        'fn name=a returns=number export=true',
        '  handler lang="kern"',
        '    return value="b() + 1"',
      ].join('\n'),
      '/app/b.kern': [
        'use path="./c"',
        '  from name=c kind=fn',
        'fn name=b returns=number export=true',
        '  handler lang="kern"',
        '    return value="c() + 10"',
      ].join('\n'),
      '/app/c.kern': ['fn name=c returns=number export=true', '  handler lang="kern"', '    return value="100"'].join(
        '\n',
      ),
    };
    const root = [
      'use path="./a"',
      '  from name=a kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="a()"',
    ].join('\n');
    expect(executeKernSource(root, { sourcePath: '/app/main.kern', moduleLoader: memoryModuleLoader(modules) })).toBe(
      '111\n',
    );
  });

  test('imported class constructed and used inside its own module exported helper', () => {
    const modules = {
      '/app/widget.kern': [
        'class name=Widget',
        '  field name=size value="7"',
        '  method name=describe returns=number',
        '    handler lang="kern"',
        '      return value="this.size * 2"',
        'fn name=makeLabel returns=number export=true',
        '  handler lang="kern"',
        '    let name=w value="new Widget()"',
        '    return value="w.describe()"',
      ].join('\n'),
    };
    const root = [
      'use path="./widget"',
      '  from name=makeLabel kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="makeLabel()"',
    ].join('\n');
    expect(executeKernSource(root, { sourcePath: '/app/main.kern', moduleLoader: memoryModuleLoader(modules) })).toBe(
      '14\n',
    );
  });

  test('imported helper resolves ITS module private foo, not a root foo of the same name', () => {
    const modules = {
      '/app/mod.kern': [
        'fn name=foo returns=number',
        '  handler lang="kern"',
        '    return value="999"',
        'fn name=bar returns=number export=true',
        '  handler lang="kern"',
        '    return value="foo()"',
      ].join('\n'),
    };
    const root = [
      'use path="./mod"',
      '  from name=bar kind=fn',
      'fn name=foo returns=number',
      '  handler lang="kern"',
      '    return value="1"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="bar()"',
      '    print value="foo()"',
    ].join('\n');
    // bar() must use mod's foo (999); root's foo() must remain 1 (no shared-cache collision).
    expect(executeKernSource(root, { sourcePath: '/app/main.kern', moduleLoader: memoryModuleLoader(modules) })).toBe(
      '999\n1\n',
    );
  });

  // ── Finding 1: capability preflight readiness parity across module boundaries ─

  test('preflight reports a missing SYNC provider for a capability in an imported helper', () => {
    const modules = {
      '/app/helper.kern': [
        'fn name=readCfg returns=string export=true',
        '  handler lang="kern"',
        '    capability namespace=storage operation=get name=v input="{ key: \\"k\\" }"',
        '    return value="v"',
      ].join('\n'),
    };
    const root = [
      'use path="./helper"',
      '  from name=readCfg kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="readCfg()"',
    ].join('\n');
    const analysis = analyzeKernSourceCapabilities(root, {
      sourcePath: '/app/main.kern',
      moduleLoader: memoryModuleLoader(modules),
      providedCapabilities: [],
      providedAsyncCapabilities: [],
    });
    expect(analysis.executableRequirements.map((r) => r.id)).toEqual(['storage.get']);
    expect(analysis.missingProviders.map((r) => r.id)).toEqual(['storage.get']);
  });

  test('preflight requires the async boundary + reports a missing ASYNC provider for an imported helper capability', () => {
    const modules = {
      '/app/helper.kern': [
        'fn name=fetchIt returns=string export=true',
        '  handler lang="kern"',
        '    capability namespace=fs operation=readText name=t input="{ path: \\"a.txt\\" }"',
        '    return value="t"',
      ].join('\n'),
    };
    const root = [
      'use path="./helper"',
      '  from name=fetchIt kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="fetchIt()"',
    ].join('\n');
    const analysis = analyzeKernSourceCapabilities(root, {
      sourcePath: '/app/main.kern',
      moduleLoader: memoryModuleLoader(modules),
      providedCapabilities: [],
      providedAsyncCapabilities: [],
    });
    expect(analysis.executableAsyncPlannedCapabilities.map((r) => r.id)).toEqual(['fs.readText']);
    expect(analysis.asyncBoundaryRequired).toBe(true);
    expect(analysis.missingAsyncProviders.map((r) => r.id)).toEqual(['fs.readText']);
  });

  // ── Finding 4: preflight and executor reject/accept identical import graphs ──

  test('duplicate imported alias is rejected by BOTH preflight and executor with matching shape', () => {
    const helper = [
      'fn name=a returns=number export=true',
      '  handler lang="kern"',
      '    return value="1"',
      'fn name=b returns=number export=true',
      '  handler lang="kern"',
      '    return value="2"',
    ].join('\n');
    const root = [
      'use path="./helper"',
      '  from name=a kind=fn as=same',
      '  from name=b kind=fn as=same',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="same()"',
    ].join('\n');
    const opts = { sourcePath: '/app/main.kern', moduleLoader: memoryModuleLoader({ '/app/helper.kern': helper }) };
    const expected = /duplicate imported alias 'same'/;

    const analysis = analyzeKernSourceCapabilities(root, { ...opts, providedCapabilities: [] });
    const preflightError = analysis.parseDiagnostics.find((d) => d.severity === 'error' && expected.test(d.message));
    expect(preflightError).toBeDefined();
    expect(() => executeKernSource(root, opts)).toThrow(expected);
  });

  test('kind mismatch is rejected by BOTH preflight and executor with matching shape', () => {
    const helper = ['fn name=a returns=number export=true', '  handler lang="kern"', '    return value="1"'].join('\n');
    const root = [
      'use path="./helper"',
      '  from name=a kind=class',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"x\\""',
    ].join('\n');
    const opts = { sourcePath: '/app/main.kern', moduleLoader: memoryModuleLoader({ '/app/helper.kern': helper }) };
    const expected = /import 'a' from '[^']+' expected kind 'class' but found 'fn'/;

    const analysis = analyzeKernSourceCapabilities(root, { ...opts, providedCapabilities: [] });
    expect(analysis.parseDiagnostics.some((d) => d.severity === 'error' && expected.test(d.message))).toBe(true);
    expect(() => executeKernSource(root, opts)).toThrow(expected);
  });

  test('a re-exported symbol is accepted by BOTH preflight and executor', () => {
    const modules = {
      '/app/base.kern': ['fn name=orig returns=number export=true', '  handler lang="kern"', '    return value="7"'].join(
        '\n',
      ),
      '/app/mid.kern': ['use path="./base"', '  from name=orig kind=fn export=true'].join('\n'),
    };
    const root = [
      'use path="./mid"',
      '  from name=orig kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="orig()"',
    ].join('\n');
    const opts = { sourcePath: '/app/main.kern', moduleLoader: memoryModuleLoader(modules) };

    const analysis = analyzeKernSourceCapabilities(root, { ...opts, providedCapabilities: [] });
    expect(analysis.parseDiagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(executeKernSource(root, opts)).toBe('7\n');
  });

  // ── Finding 2: broken imported module fails closed, never crashes ──────────

  test('importing a syntactically broken module fails closed with diagnostics, no crash', () => {
    const modules = {
      '/app/broken.kern': ['fn name=helper returns=number export=true', '  handler lang="kern"', '    return value="'].join(
        '\n',
      ),
    };
    const root = [
      'use path="./broken"',
      '  from name=helper kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"root\\""',
    ].join('\n');
    let analysis: ReturnType<typeof analyzeKernSourceCapabilities> | undefined;
    expect(() => {
      analysis = analyzeKernSourceCapabilities(root, {
        sourcePath: '/app/main.kern',
        moduleLoader: memoryModuleLoader(modules),
        providedCapabilities: [],
      });
    }).not.toThrow();
    expect(analysis?.hasParseErrors).toBe(true);
    expect(analysis?.parseDiagnostics.some((d) => d.severity === 'error')).toBe(true);
    // The executor likewise fails closed (never a raw TypeError).
    expect(() =>
      executeKernSource(root, { sourcePath: '/app/main.kern', moduleLoader: memoryModuleLoader(modules) }),
    ).toThrow(KernRunnerError);
  });

  test('a loader returning a non-string source fails closed with a link error, not a TypeError', () => {
    const nonStringLoader = {
      resolve(_specifier: string, _context: { readonly importer: string }): string | null {
        return '/app/broken.kern';
      },
      readSource(_path: string): string {
        return undefined as unknown as string;
      },
    };
    const root = [
      'use path="./broken"',
      '  from name=helper kind=fn',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"root\\""',
    ].join('\n');
    let analysis: ReturnType<typeof analyzeKernSourceCapabilities> | undefined;
    expect(() => {
      analysis = analyzeKernSourceCapabilities(root, {
        sourcePath: '/app/main.kern',
        moduleLoader: nonStringLoader,
        providedCapabilities: [],
      });
    }).not.toThrow();
    expect(analysis?.hasParseErrors).toBe(true);
    expect(analysis?.parseDiagnostics.some((d) => d.severity === 'error' && /source is unavailable/.test(d.message))).toBe(
      true,
    );
  });
});
