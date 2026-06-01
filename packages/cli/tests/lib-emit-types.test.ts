import type { KernTarget } from '@kernlang/core';
import { parseDocument, resolveConfig } from '@kernlang/core';
import { transpileForTarget } from '../src/shared.js';

function compile(src: string, target: KernTarget = 'lib', emit?: string): string {
  const ast = parseDocument(src);
  const cfg = resolveConfig({ target });
  if (emit) {
    cfg.emit = emit;
  }
  return transpileForTarget(ast, cfg).code;
}

describe('lib target --emit=types (Types-Only Projection)', () => {
  test('emits interfaces, types, events, models and unions under emit=types', () => {
    const code = compile(
      [
        'interface name=User export=true',
        '  field name=id type=string',
        '',
        'type name=Role values="admin|user|guest"',
        '',
        'event name=UserCreated',
        '  field name=userId type=string',
        '',
        'model name=Product table=products',
        '  column name=sku type=string',
        '',
        'fn name=greet params="u: User" returns=string',
        '  handler <<<',
        '    return `Hello ${u.id}`;',
        '  >>>',
      ].join('\n'),
      'lib',
      'types',
    );

    // Should include core models and types
    expect(code).toContain('export interface User');
    expect(code).toContain('export type Role =');
    expect(code).toContain('export interface UserCreated');
    // For models, should generate class or interface
    expect(code).toContain('export interface Product');

    // Should suppress functions
    expect(code).not.toContain('greet');
    expect(code).not.toContain('return `Hello');
  });
});
