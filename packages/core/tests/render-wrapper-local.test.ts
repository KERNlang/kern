/**
 * Tests for `render wrapper="<Tag>"` + `local name=X expr="..."` — the
 * composition primitives that unblock agon's triaged screens per the
 * 2026-04-21 PR 8 test matrix (T1/T3/T4).
 *
 * Scope contract (from agon spec):
 *   - Only `render` gets the `wrapper=` prop.
 *   - `local` is expression-only; no handler-bodied derives at render scope.
 *   - One wrapper per render — no nested wrappers.
 */

import { generateCoreNode } from '../src/codegen-core.js';
import { KernCodegenError } from '../src/errors.js';
import { parse } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

function screen(renderProps: Record<string, unknown>, renderChildren: IRNode[]): IRNode {
  return mk('screen', { name: 'S', target: 'ink' }, [
    mk('prop', { name: 'items', type: 'Item[]' }),
    mk('prop', { name: 'jobs', type: 'Job[]' }),
    mk('render', renderProps, renderChildren),
  ]);
}

describe('render wrapper=', () => {
  it('replaces the default <>...</> fragment with the wrapper tag', () => {
    const s = screen({ wrapper: '<Box paddingX={1}>' }, [mk('handler', { code: '<Text>hi</Text>' })]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('return (');
    expect(code).toContain('<Box paddingX={1}>');
    expect(code).toContain('<Text>hi</Text>');
    expect(code).toContain('</Box>');
    expect(code).not.toContain('<>');
    expect(code).not.toContain('</>');
  });

  it('extracts the tag name correctly for multi-attribute wrappers', () => {
    const s = screen({ wrapper: '<Box flexDirection="column" paddingLeft={2}>' }, [
      mk('handler', { code: '<Text>x</Text>' }),
    ]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('<Box flexDirection="column" paddingLeft={2}>');
    expect(code).toContain('</Box>');
  });

  it('composes wrapper around `each` and `conditional` children', () => {
    const s = screen({ wrapper: '<Box paddingX={1}>' }, [
      mk('conditional', { if: 'jobs.length === 0' }, [mk('handler', { code: 'return null;' })]),
      mk('handler', { code: '<Text dimColor>jobs: </Text>' }),
      mk('each', { name: 'job', in: 'jobs' }, [mk('handler', { code: '<Text key={job.id}>{job.label}</Text>' })]),
    ]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('<Box paddingX={1}>');
    expect(code).toContain('{jobs.length === 0 && (');
    expect(code).toContain('<Text dimColor>jobs: </Text>');
    expect(code).toContain('(jobs).map((job, __i) =>');
    expect(code).toContain('</Box>');
  });

  it('falls back to <>...</> when wrapper is absent (no regression on existing tests)', () => {
    const s = screen({}, [mk('each', { name: 'i', in: 'items' }, [mk('handler', { code: '<Text>{i}</Text>' })])]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('<>');
    expect(code).toContain('</>');
  });
});

describe('local name=X expr=...', () => {
  it('hoists `const name = expr;` bindings above the return statement', () => {
    const s = screen({ wrapper: '<Box>' }, [
      mk('local', { name: 'visible', expr: 'items.slice(0, 5)' }),
      mk('local', { name: 'count', expr: 'visible.length' }),
      mk('handler', { code: '<Text>{count}</Text>' }),
    ]);
    const code = generateCoreNode(s).join('\n');

    // Both locals land BEFORE the return.
    const visibleLine = code.indexOf('const visible = items.slice(0, 5);');
    const countLine = code.indexOf('const count = visible.length;');
    const returnLine = code.indexOf('return (');
    expect(visibleLine).toBeGreaterThan(-1);
    expect(countLine).toBeGreaterThan(visibleLine);
    expect(returnLine).toBeGreaterThan(countLine);
    // Source order is preserved.
  });

  it('applies an optional type annotation', () => {
    const s = screen({ wrapper: '<Box>' }, [
      mk('local', { name: 'count', expr: 'items.length', type: 'number' }),
      mk('handler', { code: '<Text>{count}</Text>' }),
    ]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('const count: number = items.length;');
  });

  it('works without a wrapper (local still triggers composed mode)', () => {
    const s = screen({}, [
      mk('local', { name: 'label', expr: '`count: ${items.length}`' }),
      mk('handler', { code: '<Text>{label}</Text>' }),
    ]);
    const code = generateCoreNode(s).join('\n');
    expect(code).toContain('const label = `count: ${items.length}`;');
    expect(code).toContain('<Text>{label}</Text>');
    // No wrapper → default fragment.
    expect(code).toContain('<>');
  });

  it('throws when a local node is missing its expr prop', () => {
    const s = screen({ wrapper: '<Box>' }, [
      mk('local', { name: 'broken' }),
      mk('handler', { code: '<Text>x</Text>' }),
    ]);
    expect(() => generateCoreNode(s)).toThrow(KernCodegenError);
    expect(() => generateCoreNode(s)).toThrow(/local .* 'expr' prop/);
  });

  it('throws when a local node has an invalid name (routes through emitIdentifier)', () => {
    const s = screen({ wrapper: '<Box>' }, [
      mk('local', { name: 'bad-name!', expr: 'items.length' }),
      mk('handler', { code: '<Text>x</Text>' }),
    ]);
    expect(() => generateCoreNode(s)).toThrow(KernCodegenError);
  });
});

describe('full pipeline — agon T1/T4 acceptance shape', () => {
  it('T1 BackgroundJobRail — wrapper + conditional + handler + each', () => {
    const source = [
      'screen name=BackgroundJobRail target=ink',
      '  prop name=jobs type="Job[]"',
      '  render wrapper="<Box paddingX={1}>"',
      '    conditional if="jobs.length === 0"',
      '      handler <<<',
      '        return null;',
      '      >>>',
      '    handler <<<',
      '      <Text dimColor>jobs: </Text>',
      '    >>>',
      '    each name=job in=jobs',
      '      handler <<<',
      '        <Text key={job.id}>{job.label}</Text>',
      '      >>>',
      '',
    ].join('\n');

    const ast = parse(source);
    const screenNode = ast.type === 'screen' ? ast : ast.children?.find((c) => c.type === 'screen');
    expect(screenNode).toBeDefined();
    const code = generateCoreNode(screenNode as IRNode).join('\n');
    expect(code).toContain('function BackgroundJobRail({ jobs }');
    expect(code).toContain('<Box paddingX={1}>');
    expect(code).toContain('{jobs.length === 0 && (');
    expect(code).toContain('<Text dimColor>jobs: </Text>');
    expect(code).toContain('(jobs).map((job, __i) =>');
    expect(code).toContain('</Box>');
  });

  it('T4 PlanExecutionView shape — locals + wrapper + each (no let)', () => {
    const source = [
      'screen name=PlanExecutionView target=ink',
      '  prop name=steps type="Step[]"',
      '  render wrapper="<Box flexDirection=\\"column\\" paddingLeft={2}>"',
      '    local name=doneSteps expr="steps.filter(s => s.done).length"',
      '    local name=pct expr="steps.length === 0 ? 0 : doneSteps / steps.length"',
      '    handler <<<',
      '      <Text>progress: {pct}</Text>',
      '    >>>',
      '    each name=s in=steps',
      '      handler <<<',
      '        <Text key={s.id}>{s.label}</Text>',
      '      >>>',
      '',
    ].join('\n');

    const ast = parse(source);
    const screenNode = ast.type === 'screen' ? ast : ast.children?.find((c) => c.type === 'screen');
    const code = generateCoreNode(screenNode as IRNode).join('\n');

    expect(code).toContain('function PlanExecutionView({ steps }');
    // Locals hoist above the return.
    expect(code).toContain('const doneSteps = steps.filter(s => s.done).length;');
    expect(code).toContain('const pct = steps.length === 0 ? 0 : doneSteps / steps.length;');
    // Wrapper tag present with attributes.
    expect(code).toContain('<Box flexDirection="column" paddingLeft={2}>');
    // Pieces compose.
    expect(code).toContain('<Text>progress: {pct}</Text>');
    expect(code).toContain('(steps).map((s, __i) =>');
    expect(code).toContain('</Box>');
  });
});
