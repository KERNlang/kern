/**
 * Regression coverage for the Ink transpiler's render-composed path.
 *
 * Prior to the fix, `packages/terminal/src/transpiler-ink.ts` looked only at
 * the first `handler` child of `render` and ignored `renderNode.props.wrapper`
 * plus any sibling `each` / `conditional` / `local` children. PR #97 shipped
 * the composed-mode logic in @kernlang/core but the Ink transpiler never
 * delegated to it — every `screen target=ink` using `render wrapper=...` or
 * declarative children silently emitted an empty body / wrong JSX.
 *
 * These tests run .kern source through `transpileInk` end-to-end (not just
 * `generateCoreNode`) so the Ink code path is exercised.
 */

describe('Ink transpiler — render composed mode', () => {
  test('emits wrapper tag + each child (PR #97 + T1 lift scenario)', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=BackgroundJobRail target=ink',
      '  prop name=jobs type="Job[]"',
      '  render wrapper="<Box paddingX={1}>"',
      '    each name=job in=jobs',
      '      handler <<<',
      '        <Text key={job.id}>{job.label}</Text>',
      '      >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);
    expect(result.code).toContain('<Box paddingX={1}>');
    expect(result.code).toContain('(jobs).map(');
    expect(result.code).toContain('<Text key={job.id}>');
    expect(result.code).toContain('</Box>');
    // Must NOT regress to the pre-fix "render null" branch.
    expect(result.code).not.toMatch(/return null;\s*}\s*$/);
  });

  test('emits Fragment (<>) + conditional child when no wrapper prop is set', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Status target=ink',
      '  prop name=online type=boolean',
      '  render',
      '    conditional if=online',
      '      handler <<<',
      '        <Text color="green">online</Text>',
      '      >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);
    expect(result.code).toContain('<>');
    expect(result.code).toContain('online');
    expect(result.code).toContain('</>');
  });

  test('hoists `local` children above the return statement', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Counter target=ink',
      '  prop name=items type="string[]"',
      '  render',
      '    local name=count expr="items.length"',
      '    handler <<<',
      '      <Text>{count}</Text>',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);
    // Local binding hoisted above the return.
    const countIdx = result.code.indexOf('const count');
    const returnIdx = result.code.indexOf('return (');
    expect(countIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(-1);
    expect(countIdx).toBeLessThan(returnIdx);
    expect(result.code).toContain('items.length');
  });

  test('auto-registers Ink imports for composed-mode Box/Text usage', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Wrapped target=ink',
      '  prop name=items type="string[]"',
      '  render wrapper="<Box flexDirection=\\"column\\">"',
      '    each name=item in=items',
      '      handler <<<',
      '        <Text key={item}>{item}</Text>',
      '      >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);
    // Both Box and Text must appear in the ink import list — core's emitRender
    // writes the wrapper + handler JSX verbatim and doesn't know about the Ink
    // import tracker, so the Ink transpiler scans the emitted body and
    // registers them.
    const inkImportLine = result.code.split('\n').find((l) => l.startsWith('import {') && l.includes("from 'ink'"));
    expect(inkImportLine).toBeDefined();
    expect(inkImportLine).toContain('Box');
    expect(inkImportLine).toContain('Text');
  });

  test('preserves the legacy handler-only path when no composed-mode trigger exists', async () => {
    // Plain `render` with only a handler child must still emit the handler
    // code verbatim (no wrapper, no Fragment) — the fix must not regress
    // simple screens.
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Simple target=ink',
      '  render',
      '    handler <<<',
      '      <Text>hi</Text>',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);
    expect(result.code).toContain('<Text>hi</Text>');
    // Should NOT wrap in Fragment when there's no composed-mode trigger.
    expect(result.code).not.toContain('<>');
  });
});
