/**
 * Tests for `each` inside render blocks — JSX-expression codegen path.
 *
 * Statement-position `each` (for...of) is tested in ground-layer.test.ts.
 * This suite covers the JSX-context behaviour added for PR 1:
 *   - `each` as a child of `render` emits `.map()` with <React.Fragment key=...>
 *   - auto-key falls back through `name.id ?? name.key ?? index`
 *   - explicit `key=` prop is honoured
 *   - `derive` child of render-nested `each` triggers a semantic-validator diagnostic
 *   - decompiler round-trips `each` with canonical grammar
 */

import { generateCoreNode } from '../src/codegen-core.js';
import { decompile } from '../src/decompiler.js';
import { parse } from '../src/parser.js';
import { validateSemantics } from '../src/semantic-validator.js';
import type { IRNode } from '../src/types.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

function screenWithRenderEach(eachProps: Record<string, unknown>, handlerBody: string): IRNode {
  return mk('screen', { name: 'List', target: 'ink' }, [
    mk('prop', { name: 'items', type: 'Item[]' }),
    mk('render', {}, [mk('each', eachProps, [mk('handler', { code: handlerBody })])]),
  ]);
}

describe('each inside render — JSX-expression codegen', () => {
  it('emits items.map(...) wrapped in a React.Fragment with auto-key', () => {
    const screen = screenWithRenderEach({ name: 'f', in: 'items' }, '<Text>{f.path}</Text>');
    const code = generateCoreNode(screen).join('\n');

    expect(code).toContain('(items).map((f, __i) =>');
    expect(code).toContain('<React.Fragment key={f.id ?? f.key ?? __i}>');
    expect(code).toContain('<Text>{f.path}</Text>');
    expect(code).toContain('</React.Fragment>');
    // Still wrapped in a return (<> ... </>) from emitRenderComposed.
    expect(code).toContain('return (');
  });

  it('honours an explicit `key=` prop over the auto-key', () => {
    const screen = screenWithRenderEach({ name: 'f', in: 'items', key: 'f.path' }, '<Text>{f.path}</Text>');
    const code = generateCoreNode(screen).join('\n');
    expect(code).toContain('<React.Fragment key={f.path}>');
    expect(code).not.toContain('f.id ??');
  });

  it('uses a user-supplied `index=` binding in both the map call and auto-key', () => {
    const screen = screenWithRenderEach({ name: 'f', in: 'items', index: 'idx' }, '<Text>{f.path}</Text>');
    const code = generateCoreNode(screen).join('\n');
    expect(code).toContain('(items).map((f, idx) =>');
    expect(code).toContain('<React.Fragment key={f.id ?? f.key ?? idx}>');
  });

  it('leaves statement-position `each` untouched (still emits for...of)', () => {
    // Not inside a render — top-level / fn body context.
    const node = mk('each', { name: 'x', in: 'xs' }, [mk('derive', { name: 'y', expr: 'x + 1' })]);
    const code = generateCoreNode(node).join('\n');
    expect(code).toContain('for (const x of xs)');
    expect(code).not.toContain('.map(');
  });

  it('does NOT enter composed mode for renders with only metadata + handler children', () => {
    // Regression for codex review finding: `doc` (or any non-JSX child) must
    // not force composed mode, which would re-embed the handler body inside
    // a fragment and produce invalid `return` statements in JSX.
    const screen = mk('screen', { name: 'Plain', target: 'ink' }, [
      mk('render', {}, [
        mk('doc', { text: 'static render block' }),
        mk('handler', { code: 'return <Box><Text>hi</Text></Box>;' }),
      ]),
    ]);
    const code = generateCoreNode(screen).join('\n');
    // Passthrough path is untouched: the raw return lands at function scope, not inside <>...</>
    expect(code).toContain('return <Box><Text>hi</Text></Box>;');
    expect(code).not.toContain('<>');
  });

  it('in composed mode, strips `return (...);` wrapper from handler JSX so it embeds cleanly', () => {
    const screen = mk('screen', { name: 'Mixed', target: 'ink' }, [
      mk('render', {}, [
        mk('handler', { code: 'return (<Header />);' }),
        mk('each', { name: 'f', in: 'files' }, [mk('handler', { code: '<Text>{f.path}</Text>' })]),
      ]),
    ]);
    const code = generateCoreNode(screen).join('\n');
    // Handler's JSX lands inside the fragment with no `return` statement.
    expect(code).toContain('<Header />');
    expect(code.match(/return\s*\(/g)?.length).toBe(1); // only the outer emitRenderComposed return
  });
});

describe('semantic-validator — no-derive-inside-render-each', () => {
  it('flags a `derive` child of `each` when that each is inside a render block', () => {
    const screen = mk('screen', { name: 'Bad', target: 'ink' }, [
      mk('render', {}, [
        mk('each', { name: 'f', in: 'items' }, [
          mk('derive', { name: 'label', expr: 'f.path' }),
          mk('handler', { code: '<Text>{label}</Text>' }),
        ]),
      ]),
    ]);
    const violations = validateSemantics(screen);
    const hookViolations = violations.filter((v) => v.rule === 'no-derive-inside-render-each');
    expect(hookViolations).toHaveLength(1);
    expect(hookViolations[0].message).toContain('useMemo');
  });

  it('does NOT flag `derive` under a statement-position `each` (no render ancestor)', () => {
    const node = mk('fn', { name: 'compute' }, [
      mk('each', { name: 'x', in: 'xs' }, [mk('derive', { name: 'y', expr: 'x + 1' })]),
    ]);
    const violations = validateSemantics(node);
    expect(violations.filter((v) => v.rule === 'no-derive-inside-render-each')).toHaveLength(0);
  });
});

describe('decompiler — each canonical grammar', () => {
  it('emits canonical `each name=X in="Y"` instead of debug shape', () => {
    const node = mk('each', { name: 'item', in: 'items' });
    const { code } = decompile(node);
    expect(code).toContain('each name=item');
    expect(code).toContain('in="items"');
    // No debug-shape capitalized "Each" fallthrough.
    expect(code).not.toMatch(/^Each\b/);
  });

  it('includes optional index= and key= props when set', () => {
    const node = mk('each', {
      name: 'item',
      in: 'items',
      index: 'i',
      key: 'item.id',
    });
    const { code } = decompile(node);
    expect(code).toContain('index=i');
    expect(code).toContain('key="item.id"');
  });

  it('round-trips through parse — decompiled each is re-parseable', () => {
    const src = 'each name=item in=items';
    const ast = parse(src);
    // Decompile the each child (parse wraps in a synthetic root).
    const eachNode = ast.type === 'each' ? ast : ast.children?.find((c) => c.type === 'each');
    expect(eachNode).toBeDefined();
    const { code: decompiled } = decompile(eachNode as IRNode);
    const reparsed = parse(decompiled);
    const reparsedEach = reparsed.type === 'each' ? reparsed : reparsed.children?.find((c) => c.type === 'each');
    expect(reparsedEach).toBeDefined();
    expect((reparsedEach as IRNode).props?.name).toBe('item');
  });
});

describe('full pipeline — parse .kern source then generate TSX', () => {
  // This is the agon-style integration check. We author a minimal screen whose
  // render block uses `each` as a first-class KERN child (not a handler) and
  // verify the parser → schema → codegen chain produces valid React/Ink TSX.
  const source = [
    'screen name=FileList target=ink',
    '  prop name=files type="FileEntry[]"',
    '  render',
    '    each name=f in=files key="f.path"',
    '      handler <<<',
    '        <Text>{f.path}</Text>',
    '      >>>',
    '',
  ].join('\n');

  it('parses a screen with `render → each → handler` shape', () => {
    const ast = parse(source);
    const screen = ast.type === 'screen' ? ast : ast.children?.find((c) => c.type === 'screen');
    expect(screen).toBeDefined();
    const render = (screen as IRNode).children?.find((c) => c.type === 'render');
    expect(render).toBeDefined();
    const eachNode = (render as IRNode).children?.find((c) => c.type === 'each');
    expect(eachNode).toBeDefined();
    expect((eachNode as IRNode).props?.name).toBe('f');
    expect((eachNode as IRNode).props?.key).toBe('f.path');
  });

  it('emits a function whose render composes `.map()` with the user-supplied key', () => {
    const ast = parse(source);
    const screen = ast.type === 'screen' ? ast : ast.children?.find((c) => c.type === 'screen');
    const code = generateCoreNode(screen as IRNode).join('\n');

    // Component skeleton
    expect(code).toContain('function FileList({ files }');
    // Composed render block
    expect(code).toContain('return (');
    expect(code).toContain('<>');
    // JSX-each output
    expect(code).toContain('(files).map((f, __i) =>');
    expect(code).toContain('<React.Fragment key={f.path}>');
    expect(code).toContain('<Text>{f.path}</Text>');
    // No stray for...of from the statement form
    expect(code).not.toContain('for (const f of');
  });
});
