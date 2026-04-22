/**
 * Tests for the `fmt` node — declarative string interpolation primitive.
 *
 * `fmt name=label template="${count} files"` lowers to a plain `const` bound
 * to a JS template literal. Added in PR 4 to cover the ~15-20% of handler
 * volume that was previously dedicated to f-string-style formatting in agon.
 */

import { generateCoreNode, generateFmt, isCoreNode } from '../src/codegen-core.js';
import { KernCodegenError } from '../src/errors.js';
import { parse } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function makeNode(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

describe('Ground Layer: fmt', () => {
  it('emits a const bound to a template literal with interpolations preserved', () => {
    const node = makeNode('fmt', { name: 'label', template: '${count} files' });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('export const label = `${count} files`;');
  });

  it('supports multiple interpolations and literal text segments', () => {
    const node = makeNode('fmt', {
      name: 'summary',
      template: '${count} files over ${totalMb.toFixed(1)} MB',
    });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('export const summary = `${count} files over ${totalMb.toFixed(1)} MB`;');
  });

  it('applies an optional type annotation', () => {
    const node = makeNode('fmt', { name: 'label', template: '${count}', type: 'string' });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('export const label: string = `${count}`;');
  });

  it('honours export=false', () => {
    const node = makeNode('fmt', { name: 'internal', template: 'hi', export: 'false' });
    const code = generateFmt(node).join('\n');
    expect(code).not.toContain('export');
    expect(code).toBe('const internal = `hi`;');
  });

  it('escapes raw backticks in the template so authors cannot close the literal', () => {
    const node = makeNode('fmt', { name: 'msg', template: 'he said `boo`' });
    const code = generateFmt(node).join('\n');
    // Raw backticks inside the template become escaped \` — the emitted literal
    // is still a single, well-formed template string.
    expect(code).toBe('export const msg = `he said \\`boo\\``;');
  });

  it('throws when the template prop is missing', () => {
    const node = makeNode('fmt', { name: 'label' });
    expect(() => generateFmt(node)).toThrow(KernCodegenError);
    expect(() => generateFmt(node)).toThrow(/template/);
  });

  it('throws when name is invalid (routes through emitIdentifier)', () => {
    const node = makeNode('fmt', { name: 'bad-ident!', template: '${x}' });
    expect(() => generateFmt(node)).toThrow(KernCodegenError);
  });
});

describe('Ground Layer: fmt with return=true (return-position form)', () => {
  it('emits `return `...`;` when return=true and no name', () => {
    const node = makeNode('fmt', { template: '${ms}ms', return: 'true' });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('return `${ms}ms`;');
  });

  it('accepts boolean-true return prop (as opposed to string "true")', () => {
    const node = makeNode('fmt', { template: 'hi', return: true });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('return `hi`;');
  });

  it('treats return="false" as binding form (requires name)', () => {
    const node = makeNode('fmt', { name: 'msg', template: 'x', return: 'false' });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('export const msg = `x`;');
  });

  it('escapes backticks in return-position form just like binding form', () => {
    const node = makeNode('fmt', { template: 'he said `boo`', return: 'true' });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('return `he said \\`boo\\``;');
  });

  it('throws when return=true is combined with a name prop', () => {
    const node = makeNode('fmt', { name: 'label', template: 'x', return: 'true' });
    expect(() => generateFmt(node)).toThrow(KernCodegenError);
    expect(() => generateFmt(node)).toThrow(/return=true/);
  });
});

describe('Integration: generateCoreNode dispatches fmt', () => {
  it('dispatches fmt through the core dispatcher', () => {
    const code = generateCoreNode(makeNode('fmt', { name: 'x', template: '${a}' })).join('\n');
    expect(code).toContain('const x = `${a}`;');
  });

  it('registers fmt as a core node type', () => {
    expect(isCoreNode('fmt')).toBe(true);
  });
});

describe('Full pipeline — parse .kern source then generate TSX', () => {
  it('parses and emits fmt as a sibling of derive inside a function body', () => {
    const source = [
      'fn name=summarize params="count: number, totalMb: number" returns=string',
      '  handler <<<',
      '    return label;',
      '  >>>',
      '  fmt name=label template="${count} files / ${totalMb} MB"',
      '',
    ].join('\n');

    const ast = parse(source);
    const fn = ast.type === 'fn' ? ast : ast.children?.find((c) => c.type === 'fn');
    expect(fn).toBeDefined();
    const fmt = (fn as IRNode).children?.find((c) => c.type === 'fmt');
    expect(fmt).toBeDefined();
    expect((fmt as IRNode).props?.name).toBe('label');
    expect((fmt as IRNode).props?.template).toBe('${count} files / ${totalMb} MB');
  });
});
