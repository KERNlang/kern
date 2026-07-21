import type { KernTarget, TranspileResult } from '@kernlang/core';
import { parseDocument, resolveConfig } from '@kernlang/core';
import { transpileForTarget } from '../src/shared.js';

function compile(source: string, target: KernTarget): TranspileResult {
  return transpileForTarget(parseDocument(source), resolveConfig({ target }));
}

describe('checked-power target binding safety', () => {
  test('rejects an Ink callback that captures the generated power helper', () => {
    const source = [
      'screen name=Power',
      '  callback name=__kern_pow_int',
      '    handler lang="kern"',
      '      return value="2 ** 53"',
    ].join('\n');

    expect(() => compile(source, 'ink')).toThrow(/reserved.*power helper/i);
  });

  test('rejects an Express path parameter that captures the generated power helper', () => {
    const source = [
      'server name=Api',
      '  route method=get path=/power/:__kern_pow_int',
      '    handler lang="kern"',
      '      return value="2 ** 53"',
    ].join('\n');

    expect(() => compile(source, 'express')).toThrow(/reserved.*power helper/i);
  });

  test('injects the generated helper only into an artifact that calls it', () => {
    const source = [
      'server name=Api',
      '  route method=get path=/power/:base',
      '    handler lang="kern"',
      '      return value="base ** 2"',
    ].join('\n');
    const result = compile(source, 'express');
    const route = result.artifacts?.find((artifact) => artifact.type === 'route');

    expect(result.code).not.toContain('const __kern_pow_int = (');
    expect(route?.content.match(/const __kern_pow_int = \(/g)).toHaveLength(1);
    expect(route?.content).toContain('return __kern_pow_int([base, 2]);');
  });

  test.each([
    '(__kern_pow_int as any) = replacement;',
    '__kern_pow_int! = replacement;',
    '(__kern_pow_int satisfies any) = replacement;',
    '(<any>__kern_pow_int) = replacement;',
    '[__kern_pow_int = replacement] = replacements;',
    '({ value: __kern_pow_int = replacement } = source);',
  ])('rejects a raw TypeScript handler that wraps a write to the generated helper: %s', (write) => {
    const source = [
      'fn name=replaceHelper params="replacement:any" returns=void export=true',
      '  handler <<<',
      `    ${write}`,
      '  >>>',
      'fn name=power params="base:number" returns=number export=true',
      '  handler lang="kern"',
      '    return value="base ** 2"',
    ].join('\n');

    expect(() => compile(source, 'lib')).toThrow(/reserved.*power helper/i);
  });

  test('analyzes a deeply nested raw handler before injecting the power helper', () => {
    const chain = new Array(5_000).fill('1').join(' + ');
    const source = [
      'fn name=deepRaw returns=number export=true',
      '  handler <<<',
      `    return ${chain};`,
      '  >>>',
      'fn name=power params="base:number" returns=number export=true',
      '  handler lang="kern"',
      '    return value="base ** 2"',
    ].join('\n');

    const result = compile(source, 'lib');
    expect(result.code).toContain('const __kern_pow_int = (');
    expect(result.code).toContain('return __kern_pow_int([base, 2]);');
  });

  test.each(['return "__kern_pow_int([fake])";', '// __kern_pow_int([fake])\n    return "safe";'])(
    'does not inject the generated helper for an inert raw-handler mention: %s',
    (body) => {
      const source = ['fn name=inert returns=string export=true', '  handler <<<', `    ${body}`, '  >>>'].join('\n');

      expect(compile(source, 'lib').code).not.toContain('const __kern_pow_int = (');
    },
  );
});
