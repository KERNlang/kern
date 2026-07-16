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

  test('keeps helper and class composition unsupported before provider dispatch', () => {
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

    expect(analyzeKernSourceCapabilities(source, provided).unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({ id: 'llm.complete', reason: 'unsupported' }),
    ]);
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

  test('keeps an imported class frame unsupported even when its capability is reachable', () => {
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

    expect(analysis.executableAsyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(analysis.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({ id: 'llm.complete', reason: 'unsupported' }),
    ]);
  });
});
