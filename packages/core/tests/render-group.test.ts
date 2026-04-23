/**
 * Tests for the `group` node — nested JSX structural composition inside a
 * `render` block. Lets authors wrap a subset of sibling JSX pieces in an
 * inner tag without dropping into a raw handler IIFE (the T6 FileRail
 * pattern in agon's PR 8 test matrix).
 *
 * Contract:
 *   - `group` carries its own `wrapper="<Tag attrs>"` prop (required).
 *   - Allowed children mirror render's JSX-composable set: `handler`, `each`,
 *     `conditional`, and nested `group`.
 *   - `group` outside of a `render` ancestor is a semantic-validation error.
 *   - `group` inside `render` composes uniformly via the same piece collector
 *     as the render root — each / conditional / handler / group all nest.
 */

import { generateCoreNode } from '../src/codegen-core.js';
import { KernCodegenError } from '../src/errors.js';
import { parse } from '../src/parser.js';
import { validateSemantics } from '../src/semantic-validator.js';
import type { IRNode } from '../src/types.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

function screenWithRender(renderProps: Record<string, unknown>, renderChildren: IRNode[]): IRNode {
  return mk('screen', { name: 'S', target: 'ink' }, [
    mk('prop', { name: 'items', type: 'Item[]' }),
    mk('render', renderProps, renderChildren),
  ]);
}

describe('group node — nested wrapper inside render', () => {
  it('emits <Tag>…</Tag> around a single handler child', () => {
    const s = screenWithRender({ wrapper: '<Box flexDirection="column">' }, [
      mk('handler', { code: '<Header />' }),
      mk('group', { wrapper: '<Box paddingLeft={2}>' }, [mk('handler', { code: '<Text>body</Text>' })]),
    ]);
    const code = generateCoreNode(s).join('\n');

    expect(code).toContain('<Box flexDirection="column">');
    expect(code).toContain('<Header />');
    expect(code).toContain('<Box paddingLeft={2}>');
    expect(code).toContain('<Text>body</Text>');
    expect(code).toContain('</Box>');
    // Two `</Box>` closures — one for the outer render wrapper, one for the group.
    expect(code.match(/<\/Box>/g)?.length).toBe(2);
  });

  it('composes handler + each inside a group (T6 FileRail shape)', () => {
    const s = screenWithRender({ wrapper: '<Box flexDirection="column">' }, [
      mk('handler', { code: '<Text>Files</Text>' }),
      mk('group', { wrapper: '<Box paddingLeft={2}>' }, [
        mk('each', { name: 'item', in: 'items' }, [mk('handler', { code: '<Text>{item.path}</Text>' })]),
      ]),
    ]);
    const code = generateCoreNode(s).join('\n');

    expect(code).toContain('<Text>Files</Text>');
    expect(code).toContain('<Box paddingLeft={2}>');
    expect(code).toContain('(items).map((item, __i) =>');
    expect(code).toContain('<Text>{item.path}</Text>');
    // The group's closing tag appears before the render's.
    const groupCloseIdx = code.indexOf('</Box>');
    const renderCloseIdx = code.lastIndexOf('</Box>');
    expect(groupCloseIdx).toBeGreaterThan(-1);
    expect(renderCloseIdx).toBeGreaterThan(groupCloseIdx);
  });

  it('nests group inside group — multi-level composition', () => {
    const s = screenWithRender({ wrapper: '<Box>' }, [
      mk('group', { wrapper: '<Section>' }, [
        mk('handler', { code: '<Title />' }),
        mk('group', { wrapper: '<Row>' }, [mk('handler', { code: '<Cell />' })]),
      ]),
    ]);
    const code = generateCoreNode(s).join('\n');

    expect(code).toContain('<Box>');
    expect(code).toContain('<Section>');
    expect(code).toContain('<Title />');
    expect(code).toContain('<Row>');
    expect(code).toContain('<Cell />');
    expect(code).toContain('</Row>');
    expect(code).toContain('</Section>');
    expect(code).toContain('</Box>');
    // Ordering: inner group closes before outer group.
    expect(code.indexOf('</Row>')).toBeLessThan(code.indexOf('</Section>'));
    expect(code.indexOf('</Section>')).toBeLessThan(code.indexOf('</Box>'));
  });

  it('allows conditional children inside a group', () => {
    const s = screenWithRender({}, [
      mk('group', { wrapper: '<Box>' }, [
        mk('conditional', { if: 'loading' }, [mk('handler', { code: '<Spinner />' })]),
      ]),
    ]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('<Box>');
    expect(code).toContain('{loading && (');
    expect(code).toContain('<Spinner />');
    expect(code).toContain('</Box>');
  });

  it('triggers composed mode even when `group` is the only render child', () => {
    // Without `group` being in RENDER_JSX_CHILD_TYPES, a render with only a
    // group child would fall through to the raw-handler passthrough.
    const s = screenWithRender({}, [mk('group', { wrapper: '<Box>' }, [mk('handler', { code: '<Text>hi</Text>' })])]);
    const code = generateCoreNode(s).join('\n');
    // Composed mode: a Fragment wraps the group, then the group wraps the text.
    expect(code).toContain('<>');
    expect(code).toContain('<Box>');
    expect(code).toContain('<Text>hi</Text>');
    expect(code).toContain('</Box>');
    expect(code).toContain('</>');
  });

  it('throws KernCodegenError when group has no wrapper prop (during codegen fallback)', () => {
    // Schema validation would normally catch this, but the codegen is
    // defensive — assert it throws rather than emitting broken JSX.
    const s = screenWithRender({}, [mk('group', {}, [mk('handler', { code: '<X />' })])]);
    expect(() => generateCoreNode(s)).toThrow(KernCodegenError);
    expect(() => generateCoreNode(s)).toThrow(/wrapper/);
  });

  it('throws when wrapper is not a recognizable opening tag', () => {
    const s = screenWithRender({}, [mk('group', { wrapper: 'not a tag' }, [mk('handler', { code: '<X />' })])]);
    expect(() => generateCoreNode(s)).toThrow(/not a recognizable opening tag/);
  });
});

describe('group node — semantic validation', () => {
  it('flags a group at top level (no render ancestor)', () => {
    const orphan = mk('group', { wrapper: '<Box>' }, [mk('handler', { code: '<X />' })]);
    const violations = validateSemantics(orphan);
    expect(violations.some((v) => v.rule === 'group-must-be-inside-render')).toBe(true);
  });

  it('throws at codegen if a group is dispatched at statement scope (validator bypass)', () => {
    // OpenCode review finding: previously `case 'group'` returned [] silently,
    // so a misplaced group in a tree that skipped semantic validation would
    // vanish at codegen. Now it raises `KernCodegenError`.
    const orphan = mk('group', { wrapper: '<Box>' }, [mk('handler', { code: '<X />' })]);
    expect(() => generateCoreNode(orphan)).toThrow(KernCodegenError);
    expect(() => generateCoreNode(orphan)).toThrow(/must be a direct child of `render`/);
  });

  it('accepts a group as a child of render', () => {
    const s = screenWithRender({}, [mk('group', { wrapper: '<Box>' }, [mk('handler', { code: '<X />' })])]);
    const violations = validateSemantics(s);
    expect(violations.some((v) => v.rule === 'group-must-be-inside-render')).toBe(false);
  });

  it('accepts a nested group (render > group > group)', () => {
    const s = screenWithRender({}, [
      mk('group', { wrapper: '<Outer>' }, [mk('group', { wrapper: '<Inner>' }, [mk('handler', { code: '<X />' })])]),
    ]);
    const violations = validateSemantics(s);
    expect(violations.some((v) => v.rule === 'group-must-be-inside-render')).toBe(false);
  });

  it('flags a group inside an each (render > each > group silently drops at codegen)', () => {
    // Codex-review catch: `ancestry.includes("render")` alone would accept
    // this shape, but `generateEachJSX` does not recurse into group children
    // — the wrapper would vanish at codegen. Require render/group as the
    // direct parent so this fails validation instead.
    const s = screenWithRender({}, [
      mk('each', { name: 'x', in: 'xs' }, [
        mk('handler', { code: '<X />' }),
        mk('group', { wrapper: '<Row>' }, [mk('handler', { code: '<Cell />' })]),
      ]),
    ]);
    const violations = validateSemantics(s);
    expect(violations.some((v) => v.rule === 'group-must-be-inside-render')).toBe(true);
  });

  it('flags a group inside a conditional branch (same silent-drop reason)', () => {
    const s = screenWithRender({}, [
      mk('conditional', { if: 'cond' }, [
        mk('handler', { code: '<X />' }),
        mk('group', { wrapper: '<Row>' }, [mk('handler', { code: '<Cell />' })]),
      ]),
    ]);
    const violations = validateSemantics(s);
    expect(violations.some((v) => v.rule === 'group-must-be-inside-render')).toBe(true);
  });
});

describe('group node — edge cases', () => {
  it('handles an empty group (no JSX children) without throwing', () => {
    const s = screenWithRender({}, [mk('group', { wrapper: '<Box>' }, [])]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('<Box>');
    expect(code).toContain('</Box>');
  });
});

describe('group node — parser recognition', () => {
  it('parses `group` from .kern source without UNKNOWN_NODE_TYPE diagnostics', () => {
    // Codex-review catch: `group` must be listed in `spec.ts::NODE_TYPES`
    // or the parser emits an unknown-node warning on any real source file.
    const source = [
      'screen name=Demo target=ink',
      '  render wrapper="<Box>"',
      '    group wrapper="<Inner>"',
      '      handler <<<',
      '        <Text>hi</Text>',
      '      >>>',
      '',
    ].join('\n');
    const ast = parse(source);
    const node = ast.type === 'screen' ? ast : (ast.children?.find((c) => c.type === 'screen') as IRNode);
    const render = node.children?.find((c) => c.type === 'render') as IRNode;
    const group = render.children?.find((c) => c.type === 'group') as IRNode;
    expect(group).toBeDefined();
    expect(group.type).toBe('group');
    expect(group.props?.wrapper).toBe('<Inner>');
  });
});
