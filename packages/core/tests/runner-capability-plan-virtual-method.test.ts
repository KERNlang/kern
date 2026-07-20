import { analyzeKernSourceCapabilities } from '../src/runner.js';

describe('@kernlang/core/runner virtual-method capability preflight', () => {
  test('owns exact virtual overrides while preserving nested super ancestry in capability planning', () => {
    const source = [
      'class name=Base',
      '  method name=render returns=string',
      '    handler lang="kern"',
      '      return value="this.value()"',
      '  method name=value returns=string',
      '    handler lang="kern"',
      '      capability namespace=storage operation=get name=base input="{ key: \\"base\\" }"',
      '      return value="base"',
      'class name=Derived extends=Base',
      '  method name=value returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"derived\\" }"',
      '      let name=base value="super.value()"',
      '      return value="base + answer"',
      'class name=Unrelated',
      '  method name=value returns=string',
      '    handler lang="kern"',
      '      capability namespace=crypto operation=randomHex name=noise input="{ length: 4 }"',
      '      return value="noise"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=item value="new Derived()"',
      '    print value="item.render()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedCapabilities: ['storage.get'],
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.executableRequirements.map((requirement) => requirement.id)).toEqual([
      'storage.get',
      'llm.complete',
    ]);
    expect(analysis.missingProviders).toEqual([]);
    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('keeps shared base constructors distinct for two concrete virtual receivers', () => {
    const source = [
      'class name=Base',
      '  constructor',
      '    handler lang="kern"',
      '      let name=value value="this.load()"',
      '  method name=load returns=string',
      '    handler lang="kern"',
      '      return value="\\"base\\""',
      'class name=FromStorage extends=Base',
      '  method name=load returns=string',
      '    handler lang="kern"',
      '      capability namespace=storage operation=get name=value input="{ key: \\"mode\\" }"',
      '      return value="value"',
      'class name=FromLlm extends=Base',
      '  method name=load returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=value input="{ prompt: \\"mode\\" }"',
      '      return value="value"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=stored value="new FromStorage()"',
      '    let name=generated value="new FromLlm()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedCapabilities: ['storage.get'],
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.executableRequirements.map((requirement) => requirement.id)).toEqual([
      'storage.get',
      'llm.complete',
    ]);
    expect(analysis.missingProviders).toEqual([]);
    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });
});
