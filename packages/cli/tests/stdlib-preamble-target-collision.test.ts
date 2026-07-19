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

    expect(result.code).not.toContain('function __kern_pow_int(');
    expect(route?.content.match(/function __kern_pow_int\(/g)).toHaveLength(1);
    expect(route?.content).toContain('return __kern_pow_int([base, 2]);');
  });
});
