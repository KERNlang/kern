/**
 * Tests for the `fmt` inline-JSX form — `fmt template="..."` with no `name`
 * and no `return=true` emits `{\`${template}\`}` as a JSX piece when placed
 * as a direct child of `render`/`group`.
 *
 * Agon scan (2026-04-23): ~1316 template-literal sites inside handlers. Most
 * common shape is `<Text>{`${x} files`}</Text>` which required a full
 * handler block. The inline form lets the wrapping `<Text>` collapse to a
 * `group wrapper="<Text>"` with a single `fmt` child.
 */

import { generateCoreNode, generateFmt } from '../src/codegen-core.js';
import { KernCodegenError } from '../src/errors.js';
import { validateSemantics } from '../src/semantic-validator.js';
import type { IRNode } from '../src/types.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

function screenWithRender(renderProps: Record<string, unknown>, renderChildren: IRNode[]): IRNode {
  return mk('screen', { name: 'S', target: 'ink' }, [
    mk('prop', { name: 'count', type: 'number' }),
    mk('render', renderProps, renderChildren),
  ]);
}

describe('fmt inline-JSX form — codegen', () => {
  it('emits `{`...`}` when fmt is a direct child of render (no name, no return=true)', () => {
    const s = screenWithRender({ wrapper: '<Text>' }, [mk('fmt', { template: '${count} files' })]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('<Text>');
    expect(code).toContain('{`${count} files`}');
    expect(code).toContain('</Text>');
    // Must NOT emit a statement form — no `const formatted = ...;` leaks through.
    expect(code).not.toMatch(/const\s+formatted\s*=/);
  });

  it('emits the inline form when fmt is a direct child of group', () => {
    const s = screenWithRender({ wrapper: '<Box>' }, [
      mk('group', { wrapper: '<Text>' }, [mk('fmt', { template: '${count} files' })]),
    ]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('<Box>');
    expect(code).toContain('<Text>');
    expect(code).toContain('{`${count} files`}');
    expect(code).toContain('</Text>');
    expect(code).toContain('</Box>');
  });

  it('composes inline fmt alongside handler + each siblings', () => {
    const s = screenWithRender({ wrapper: '<Box flexDirection="column">' }, [
      mk('handler', { code: '<Header />' }),
      mk('fmt', { template: '${count} files' }),
      mk('each', { name: 'x', in: 'items' }, [mk('handler', { code: '<Text>{x}</Text>' })]),
    ]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('<Header />');
    expect(code).toContain('{`${count} files`}');
    expect(code).toContain('(items).map((x, __i) =>');
  });

  it('escapes raw backticks in the template so the literal cannot be closed', () => {
    const s = screenWithRender({ wrapper: '<Text>' }, [mk('fmt', { template: 'he said `boo`' })]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('{`he said \\`boo\\``}');
  });

  it('triggers composed mode when a lone inline fmt is the only render child (no wrapper)', () => {
    const s = screenWithRender({}, [mk('fmt', { template: '${count} files' })]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('<>');
    expect(code).toContain('{`${count} files`}');
    expect(code).toContain('</>');
  });

  it('throws when fmt inline-form has no template prop', () => {
    const s = screenWithRender({ wrapper: '<Text>' }, [mk('fmt', {})]);
    expect(() => generateCoreNode(s)).toThrow(KernCodegenError);
    expect(() => generateCoreNode(s)).toThrow(/template/);
  });

  it('throws when fmt inline-form is dispatched at statement scope (not inside render/group)', () => {
    // Author drops a nameless fmt at top level — no consumer will read it.
    const node = mk('fmt', { template: '${x}' });
    expect(() => generateFmt(node)).toThrow(KernCodegenError);
    expect(() => generateFmt(node)).toThrow(/inline-JSX form/);
  });

  it('throws when a non-inline fmt (binding form) is a direct child of render', () => {
    // Binding-form fmt inside a composed-JSX walk has no consumer. Previously
    // silently dropped; now a clear error (OpenCode review finding).
    const s = screenWithRender({}, [mk('fmt', { name: 'label', template: '${x}' })]);
    expect(() => generateCoreNode(s)).toThrow(KernCodegenError);
    expect(() => generateCoreNode(s)).toThrow(/inline-JSX form/);
  });

  it('throws when a non-inline fmt (return form) is a direct child of group', () => {
    const s = screenWithRender({}, [
      mk('group', { wrapper: '<Text>' }, [mk('fmt', { template: '${x}', return: 'true' })]),
    ]);
    expect(() => generateCoreNode(s)).toThrow(KernCodegenError);
    expect(() => generateCoreNode(s)).toThrow(/inline-JSX form/);
  });

  it('composes an inline fmt deep inside nested groups (render > group > group > fmt)', () => {
    const s = screenWithRender({ wrapper: '<Box>' }, [
      mk('group', { wrapper: '<Section>' }, [
        mk('group', { wrapper: '<Text>' }, [mk('fmt', { template: '${label}' })]),
      ]),
    ]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('<Box>');
    expect(code).toContain('<Section>');
    expect(code).toContain('<Text>');
    expect(code).toContain('{`${label}`}');
    expect(code.indexOf('</Text>')).toBeLessThan(code.indexOf('</Section>'));
    expect(code.indexOf('</Section>')).toBeLessThan(code.indexOf('</Box>'));
  });
});

describe('fmt inline-JSX form — existing forms still work', () => {
  it('binding form (name=X) still emits `const X = `...`;`', () => {
    const node = mk('fmt', { name: 'label', template: '${count} files' });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('export const label = `${count} files`;');
  });

  it('return form (return=true) still emits `return `...`;`', () => {
    const node = mk('fmt', { template: '${ms}ms', return: 'true' });
    const code = generateFmt(node).join('\n');
    expect(code).toBe('return `${ms}ms`;');
  });
});

describe('fmt inline-JSX form — semantic validation', () => {
  it('flags inline fmt at top level (no render ancestor)', () => {
    const orphan = mk('fmt', { template: '${x}' });
    const violations = validateSemantics(orphan);
    expect(violations.some((v) => v.rule === 'fmt-inline-must-be-inside-render')).toBe(true);
  });

  it('accepts inline fmt as a direct child of render', () => {
    const s = screenWithRender({}, [mk('fmt', { template: '${x}' })]);
    const violations = validateSemantics(s);
    expect(violations.some((v) => v.rule === 'fmt-inline-must-be-inside-render')).toBe(false);
  });

  it('accepts inline fmt as a direct child of group', () => {
    const s = screenWithRender({}, [mk('group', { wrapper: '<Text>' }, [mk('fmt', { template: '${x}' })])]);
    const violations = validateSemantics(s);
    expect(violations.some((v) => v.rule === 'fmt-inline-must-be-inside-render')).toBe(false);
  });

  it('flags inline fmt inside an each (would silently drop at codegen)', () => {
    const s = screenWithRender({}, [
      mk('each', { name: 'x', in: 'xs' }, [
        mk('handler', { code: '<Text>{x}</Text>' }),
        mk('fmt', { template: '${x}' }),
      ]),
    ]);
    const violations = validateSemantics(s);
    expect(violations.some((v) => v.rule === 'fmt-inline-must-be-inside-render')).toBe(true);
  });

  it('does not flag a binding-form fmt at top level (name=X is legal anywhere)', () => {
    const node = mk('fmt', { name: 'msg', template: '${x}' });
    const violations = validateSemantics(node);
    expect(violations.some((v) => v.rule === 'fmt-inline-must-be-inside-render')).toBe(false);
  });
});
