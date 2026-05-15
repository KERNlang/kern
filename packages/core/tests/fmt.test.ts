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

  it('preserves already-escaped backticks without double-escaping', () => {
    // Template body `a\`b` is the raw TS source for a literal backtick (already
    // escaped). emitFmtTemplate must NOT add another `\` (which would produce
    // `a\\\`b` and break the round-trip). Lookbehind logic: only bare backticks
    // (preceded by an even number of `\`) get escaped.
    const node = makeNode('fmt', { name: 'msg', template: 'a\\`b' });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('export const msg = `a\\`b`;');
  });

  it('preserves backslash escape sequences verbatim (no double-escape)', () => {
    // The `template=` body is raw TS template-literal source. Escapes like
    // `\n`, `\t`, `\xNN`, `\${` must pass through unchanged — re-escaping the
    // `\` would turn `\n` (newline escape) into `\\n` (literal `\n`).
    const node = makeNode('fmt', { name: 'msg', template: 'line1\\nline2\\tcol' });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('export const msg = `line1\\nline2\\tcol`;');
  });

  it('preserves literal `\\${` escape (TS-source escape for literal $)', () => {
    const node = makeNode('fmt', { name: 'msg', template: 'price: \\${cost}' });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('export const msg = `price: \\${cost}`;');
  });

  it('escapes a backtick preceded by an even backslash run (literal `\\\\` then bare `)', () => {
    // Body `a\\\`b` = literal backslash + literal backtick. Run of `\` ending
    // at the backtick is length 2 (even) → backtick is "bare" → escape it.
    const node = makeNode('fmt', { name: 'msg', template: 'a\\\\`b' });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('export const msg = `a\\\\\\`b`;');
  });

  it('preserves backtick preceded by an odd backslash run > 1 (literal `\\\\` then `\\`)', () => {
    // Body `a\\\\\`b` = 2 literal backslashes + an already-escaped backtick.
    // Run length is 3 (odd) → backtick is already TS-escaped → leave alone.
    // (Gemini impl-review explicit coverage.)
    const node = makeNode('fmt', { name: 'msg', template: 'a\\\\\\`b' });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('export const msg = `a\\\\\\`b`;');
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
