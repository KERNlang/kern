import { analyzeKernSourceCapabilities } from '../src/runner-capability-plan.js';

const provided = { providedAsyncCapabilities: ['llm.complete'] } as const;

describe('M3.31a class-frame capability planning', () => {
  test('clears unsupported only when the selected entry owns the class frame', () => {
    const source = [
      'class name=RemoteLabel',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"method\\" }"',
      '      return value="answer"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="new RemoteLabel()"',
      '    print value="label.read()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, provided);

    expect(analysis.executableAsyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('owns same-root pure helpers called from an admitted class frame', () => {
    const source = [
      'fn name=decorate returns=string',
      '  param name=value type=string',
      '  handler lang="kern"',
      '    return value="value"',
      'class name=RemoteLabel',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"method\\" }"',
      '      return value="decorate(answer)"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="new RemoteLabel()"',
      '    print value="label.read()"',
    ].join('\n');

    expect(analyzeKernSourceCapabilities(source, provided).unsupportedAsyncExecutions).toEqual([]);
  });

  test('owns a root-reached pre-super capability while helper continuations stay separate', () => {
    const source = [
      'class name=Base',
      '  field name=value type=string',
      '  constructor',
      '    param name=value type=string',
      '    handler lang="kern"',
      '      assign target="this.value" value="value"',
      'class name=RemoteLabel extends=Base',
      '  constructor',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"pre-super\\" }"',
      '      do value="super(answer)"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="new RemoteLabel()"',
      '    print value="label.value"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, provided);

    expect(analysis.executableAsyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('requires a caller-owned budget before planning a class-body loop as owned', () => {
    const source = [
      'class name=RemoteLabel',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"method\\" }"',
      '      let name=index value="0"',
      '      while cond="index < 2"',
      '        assign target="index" value="index + 1"',
      '      return value="answer"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="new RemoteLabel()"',
      '    print value="label.read()"',
    ].join('\n');

    expect(analyzeKernSourceCapabilities(source, provided).unsupportedAsyncExecutions).toHaveLength(1);
    expect(
      analyzeKernSourceCapabilities(source, { ...provided, iterationBudget: 2 }).unsupportedAsyncExecutions,
    ).toEqual([]);
  });

  test('preserves root capability reachability when machine structure admission rejects', () => {
    const source = [
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    try',
      '      capability namespace=llm operation=complete name=body input="{ prompt: \\"body\\" }"',
      '      finally',
      '        capability namespace=llm operation=complete name=cleanup input="{ prompt: \\"cleanup\\" }"',
      '        return value="1"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, provided);

    expect(analysis.executableAsyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual([
      'llm.complete',
      'llm.complete',
    ]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('owns an imported class frame when its capability is reachable', () => {
    const remoteSource = [
      'class name=RemoteLabel export=true',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"remote\\" }"',
      '      return value="answer"',
    ].join('\n');
    const rootSource = [
      'use path="./remote"',
      '  from name=RemoteLabel kind=class',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="new RemoteLabel()"',
      '    print value="label.read()"',
    ].join('\n');
    const analysis = analyzeKernSourceCapabilities(rootSource, {
      ...provided,
      sourcePath: '/app/main.kern',
      moduleLoader: {
        resolve: (specifier) => (specifier === './remote' ? '/app/remote.kern' : null),
        readSource: (path) => {
          if (path !== '/app/remote.kern') throw new Error(`unexpected module: ${path}`);
          return remoteSource;
        },
      },
    });

    expect(analysis.parseDiagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(analysis.executableAsyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('owns an imported helper called from a local class frame', () => {
    const remoteSource = [
      'fn name=decorate export=true returns=string',
      '  param name=value type=string',
      '  handler lang="kern"',
      '    return value="value"',
    ].join('\n');
    const rootSource = [
      'use path="./remote"',
      '  from name=decorate kind=fn',
      'class name=RemoteLabel',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"remote\\" }"',
      '      return value="decorate(answer)"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="new RemoteLabel()"',
      '    print value="label.read()"',
    ].join('\n');
    const analysis = analyzeKernSourceCapabilities(rootSource, {
      ...provided,
      sourcePath: '/app/main.kern',
      moduleLoader: {
        resolve: (specifier) => (specifier === './remote' ? '/app/remote.kern' : null),
        readSource: (path) => {
          if (path !== '/app/remote.kern') throw new Error(`unexpected module: ${path}`);
          return remoteSource;
        },
      },
    });

    expect(analysis.executableAsyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('follows an imported helper into its defining module private class', () => {
    const remoteSource = [
      'class name=PrivateLabel',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"private\\" }"',
      '      return value="answer"',
      'fn name=readRemote export=true returns=string',
      '  handler lang="kern"',
      '    let name=label value="new PrivateLabel()"',
      '    return value="label.read()"',
    ].join('\n');
    const rootSource = [
      'use path="./remote"',
      '  from name=readRemote kind=fn as=readPrivate',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="readPrivate()"',
    ].join('\n');
    const analysis = analyzeKernSourceCapabilities(rootSource, {
      ...provided,
      sourcePath: '/app/main.kern',
      moduleLoader: {
        resolve: (specifier) => (specifier === './remote' ? '/app/remote.kern' : null),
        readSource: (path) => {
          if (path !== '/app/remote.kern') throw new Error(`unexpected module: ${path}`);
          return remoteSource;
        },
      },
    });

    expect(analysis.executableAsyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('keeps class identity through an aliased additive re-export', () => {
    const modules = new Map([
      [
        '/app/leaf.kern',
        [
          'class name=RemoteLabel export=true',
          '  method name=read returns=string',
          '    handler lang="kern"',
          '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"leaf\\" }"',
          '      return value="answer"',
        ].join('\n'),
      ],
      [
        '/app/bridge.kern',
        ['use path="./leaf"', '  from name=RemoteLabel kind=class as=Forwarded export=true'].join('\n'),
      ],
    ]);
    const rootSource = [
      'use path="./bridge"',
      '  from name=Forwarded kind=class as=ImportedLabel',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="new ImportedLabel()"',
      '    print value="label.read()"',
    ].join('\n');
    const analysis = analyzeKernSourceCapabilities(rootSource, {
      ...provided,
      sourcePath: '/app/main.kern',
      moduleLoader: {
        resolve: (specifier) => {
          if (specifier === './bridge') return '/app/bridge.kern';
          if (specifier === './leaf') return '/app/leaf.kern';
          return null;
        },
        readSource: (path) => {
          const source = modules.get(path);
          if (!source) throw new Error(`unexpected module: ${path}`);
          return source;
        },
      },
    });

    expect(analysis.executableAsyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('does not plan an unused effectful member on an imported class', () => {
    const remoteSource = [
      'class name=RemoteLabel export=true',
      '  method name=local returns=string',
      '    handler lang="kern"',
      '      return value="\\"local\\""',
      '  method name=remote returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"remote\\" }"',
      '      return value="answer"',
    ].join('\n');
    const rootSource = [
      'use path="./remote"',
      '  from name=RemoteLabel kind=class as=ImportedLabel',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="new ImportedLabel()"',
      '    print value="label.local()"',
    ].join('\n');
    const analysis = analyzeKernSourceCapabilities(rootSource, {
      ...provided,
      sourcePath: '/app/main.kern',
      moduleLoader: {
        resolve: (specifier) => (specifier === './remote' ? '/app/remote.kern' : null),
        readSource: (path) => {
          if (path !== '/app/remote.kern') throw new Error(`unexpected module: ${path}`);
          return remoteSource;
        },
      },
    });

    expect(analysis.executableAsyncPlannedCapabilities).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({ id: 'llm.complete', reason: 'outside-main' }),
    ]);
  });

  test('owns an effectful class reached from a helper', () => {
    const source = [
      'class name=RemoteWidget',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"remote\\" }"',
      '      return value="answer"',
      'fn name=readRemote returns=string',
      '  handler lang="kern"',
      '    let name=item value="new RemoteWidget()"',
      '    return value="item.read()"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="readRemote()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, provided);

    expect(analysis.executableAsyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('does not plan an unused effectful member on a helper-local class', () => {
    const source = [
      'class name=MixedWidget',
      '  method name=local returns=string',
      '    handler lang="kern"',
      '      return value="\\"local\\""',
      '  method name=remote returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"remote\\" }"',
      '      return value="answer"',
      'fn name=readLocal returns=string',
      '  handler lang="kern"',
      '    let name=item value="new MixedWidget()"',
      '    return value="item.local()"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="readLocal()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, provided);

    expect(analysis.executableAsyncPlannedCapabilities).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({ id: 'llm.complete', reason: 'outside-main' }),
    ]);
  });
});
