/**
 * Tests for PR 2: `let` — iteration-scoped bindings inside `each` callbacks.
 *
 * The JSX form of `each` (introduced in PR 1) could only hold raw JSX in its
 * handler, forcing authors into handler-local `.map` calls when they needed
 * per-item computed values (e.g. `const idx = start + i;`). PR 2 adds `let`
 * as a declarative iteration-scoped binding that codegen threads into the
 * `.map` callback as a plain `const` — hook-safe by construction (unlike
 * `derive` which compiles to `useMemo` and violates Rules of Hooks inside
 * a `.map` callback).
 */

import { generateCoreNode } from '../src/codegen-core.js';
import { decompile } from '../src/decompiler.js';
import { parse } from '../src/parser.js';
import { validateSemantics } from '../src/semantic-validator.js';
import type { IRNode } from '../src/types.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

function screenWithLet(lets: IRNode[], handlerBody: string, eachExtra: Record<string, unknown> = {}): IRNode {
  return mk('screen', { name: 'List', target: 'ink' }, [
    mk('prop', { name: 'items', type: 'Item[]' }),
    mk('render', {}, [
      mk('each', { name: 'f', in: 'items', ...eachExtra }, [...lets, mk('handler', { code: handlerBody })]),
    ]),
  ]);
}

describe('each inside render — `let` iteration-scoped bindings', () => {
  it('switches to block-arrow form when any `let` child is present', () => {
    const screen = screenWithLet([mk('let', { name: 'idx', expr: 'start + __i' })], '<Text>{idx}</Text>');
    const code = generateCoreNode(screen).join('\n');

    // Block-arrow form
    expect(code).toContain('(items).map((f, __i) => {');
    expect(code).toContain('const idx = start + __i;');
    expect(code).toContain('return (');
    expect(code).toContain(
      '<React.Fragment key={(f as { id?: React.Key; key?: React.Key }).id ?? (f as { id?: React.Key; key?: React.Key }).key ?? __i}>',
    );
    expect(code).toContain('<Text>{idx}</Text>');
    expect(code).toContain('</React.Fragment>');
    // Block-arrow end: `})}`
    expect(code).toContain('})}');
  });

  it('threads multiple `let` bindings in declaration order', () => {
    const screen = screenWithLet(
      [mk('let', { name: 'idx', expr: 'start + i' }), mk('let', { name: 'isSel', expr: 'focused && idx === sel' })],
      '<Text bold={isSel}>{f.path}</Text>',
      { index: 'i' },
    );
    const code = generateCoreNode(screen).join('\n');

    const idxLine = code.indexOf('const idx = start + i;');
    const selLine = code.indexOf('const isSel = focused && idx === sel;');
    expect(idxLine).toBeGreaterThan(-1);
    expect(selLine).toBeGreaterThan(-1);
    // Second let may legitimately reference the first — declaration order matters.
    expect(idxLine).toBeLessThan(selLine);
  });

  it('honours a `type` annotation on the let binding', () => {
    const screen = screenWithLet(
      [mk('let', { name: 'idx', expr: 'start + __i', type: 'number' })],
      '<Text>{idx}</Text>',
    );
    const code = generateCoreNode(screen).join('\n');
    expect(code).toContain('const idx: number = start + __i;');
  });

  it('keeps the expression-arrow form when no `let` children are declared', () => {
    const screen = screenWithLet([], '<Text>{f.path}</Text>');
    const code = generateCoreNode(screen).join('\n');

    expect(code).toContain('(items).map((f, __i) => (');
    expect(code).not.toContain('(items).map((f, __i) => {');
    // Block-arrow tail `})}` only appears in the let form.
    expect(code).not.toContain('})}');
    // The expression-arrow tail is `))}`.
    expect(code).toContain('))}');
  });

  it('does NOT fire the derive-inside-render-each rule for a `let` sibling', () => {
    const screen = screenWithLet([mk('let', { name: 'idx', expr: '__i' })], '<Text>{idx}</Text>');
    const violations = validateSemantics(screen);
    expect(violations.filter((v) => v.rule === 'no-derive-inside-render-each')).toHaveLength(0);
  });
});

describe('statement-position `each` with `let` children (for...of form)', () => {
  // Gemini PR 2 review finding: without special handling in generateEach,
  // `let` children were silently dropped when `each` was used outside a
  // render block (statement context). Iteration-scoped semantics apply to
  // both JSX `.map` and `for...of` — codegen now emits `const` lines at the
  // top of the loop body in both cases.
  it('emits `let` bindings as `const` at the top of the for...of body', () => {
    const node = mk('each', { name: 'f', in: 'files' }, [
      mk('let', { name: 'stem', expr: "f.path.split('/').pop()" }),
      mk('let', { name: 'size', expr: 'f.size ?? 0', type: 'number' }),
    ]);
    const code = generateCoreNode(node).join('\n');
    expect(code).toContain('for (const f of files)');
    expect(code).toContain("const stem = f.path.split('/').pop();");
    expect(code).toContain('const size: number = f.size ?? 0;');
    // Declaration order preserved
    expect(code.indexOf('const stem')).toBeLessThan(code.indexOf('const size'));
  });

  it('still emits `let` as `const` when using index form', () => {
    const node = mk('each', { name: 'item', in: 'xs', index: 'i' }, [mk('let', { name: 'doubled', expr: 'item * 2' })]);
    const code = generateCoreNode(node).join('\n');
    expect(code).toContain('for (const [i, item] of (xs).entries())');
    expect(code).toContain('const doubled = item * 2;');
  });
});

describe('semantic-validator — `let` must be a direct child of `each`', () => {
  it('flags `let` at render scope (not inside each)', () => {
    const screen = mk('screen', { name: 'Bad', target: 'ink' }, [
      mk('render', {}, [mk('let', { name: 'x', expr: '1' }), mk('handler', { code: '<Text/>' })]),
    ]);
    const violations = validateSemantics(screen);
    const letViolations = violations.filter((v) => v.rule === 'let-must-be-inside-each');
    expect(letViolations).toHaveLength(1);
  });

  it('flags `let` at top level', () => {
    const root = mk('module', {}, [mk('let', { name: 'x', expr: '1' })]);
    const violations = validateSemantics(root);
    expect(violations.filter((v) => v.rule === 'let-must-be-inside-each')).toHaveLength(1);
  });

  it('allows `let` directly under `each`', () => {
    const screen = screenWithLet([mk('let', { name: 'x', expr: '1' })], '<Text/>');
    const violations = validateSemantics(screen);
    expect(violations.filter((v) => v.rule === 'let-must-be-inside-each')).toHaveLength(0);
  });
});

describe('identifier/type validation — codex review finding', () => {
  // Codex PR 2 review: without going through emitIdentifier, `let name=is-selected`
  // would have spliced as `const is-selected = ...;` (invalid JS). Name and type
  // now route through emitIdentifier / emitTypeAnnotation which throw loudly on
  // invalid inputs.
  it('rejects invalid `let.name` in the JSX path (KernCodegenError)', () => {
    const screen = screenWithLet([mk('let', { name: 'is-selected', expr: 'true' })], '<Text>{isSelected}</Text>');
    expect(() => generateCoreNode(screen)).toThrow(/Invalid identifier/);
  });

  it('rejects invalid `let.name` in the statement path (KernCodegenError)', () => {
    const node = mk('each', { name: 'f', in: 'xs' }, [mk('let', { name: 'is-selected', expr: 'true' })]);
    expect(() => generateCoreNode(node)).toThrow(/Invalid identifier/);
  });

  it('accepts a valid camelCase `let.name`', () => {
    const screen = screenWithLet([mk('let', { name: 'isSelected', expr: 'true' })], '<Text>{isSelected}</Text>');
    const code = generateCoreNode(screen).join('\n');
    expect(code).toContain('const isSelected = true;');
  });
});

describe('decompiler — `let` canonical grammar', () => {
  it('emits `let name=X expr="..."` with optional type', () => {
    const node = mk('let', { name: 'idx', expr: 'start + i', type: 'number' });
    const { code } = decompile(node);
    expect(code).toContain('let name=idx');
    expect(code).toContain('expr="start + i"');
    expect(code).toContain('type=number');
    expect(code).not.toMatch(/^Let\b/);
  });

  it('parses a real .kern source with let+each and codegens valid TSX (file-rail shape)', () => {
    // This mirrors the agon file-rail.kern visible.map pattern end-to-end:
    // per-item index and selection-state computations live as `let` bindings
    // rather than inline JS inside the handler.
    const src = [
      'screen name=FileRail target=ink',
      '  prop name=files type="FileEntry[]"',
      '  prop name=start type=number',
      '  prop name=sel type=number',
      '  prop name=focused type=boolean',
      '  render',
      '    each name=f in=files index=i key="f.path"',
      '      let name=idx expr="start + i"',
      '      let name=isSel expr="focused && idx === sel"',
      '      handler <<<',
      "        <Box><Text color={isSel ? '#22d3ee' : 'gray'}>{f.relPath}</Text></Box>",
      '      >>>',
      '',
    ].join('\n');

    const ast = parse(src);
    const screen = ast.type === 'screen' ? ast : ast.children?.find((c) => c.type === 'screen');
    expect(screen).toBeDefined();

    const code = generateCoreNode(screen as IRNode).join('\n');
    // Block-arrow form because let children exist
    expect(code).toContain('(files).map((f, i) => {');
    // Both let bindings threaded into the callback
    expect(code).toContain('const idx = start + i;');
    expect(code).toContain('const isSel = focused && idx === sel;');
    // User-supplied key honoured
    expect(code).toContain('<React.Fragment key={f.path}>');
    // Handler body embedded verbatim
    expect(code).toContain("<Box><Text color={isSel ? '#22d3ee' : 'gray'}>{f.relPath}</Text></Box>");
  });

  it('round-trips an `each` with two `let` children through parse → decompile', () => {
    const source = mk('each', { name: 'f', in: 'items' }, [
      mk('let', { name: 'idx', expr: 'start + i' }),
      mk('let', { name: 'isSel', expr: 'focused && idx === sel' }),
      mk('handler', { code: '<Text>{idx}</Text>' }),
    ]);
    const { code } = decompile(source);
    // Both let lines appear before the handler.
    const idxAt = code.indexOf('let name=idx');
    const selAt = code.indexOf('let name=isSel');
    expect(idxAt).toBeGreaterThan(-1);
    expect(selAt).toBeGreaterThan(-1);
    expect(idxAt).toBeLessThan(selAt);
  });
});
