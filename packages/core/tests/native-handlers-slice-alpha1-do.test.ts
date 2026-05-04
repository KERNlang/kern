/** Native KERN handler bodies — slice α-1: `do` body-statement node.
 *
 *  `do value="<expr>"` maps a TS bare-call ExpressionStatement (`reg.load(x);`,
 *  `arr.push(y);`) to a body-statement form whose return value is discarded.
 *  Closes the single largest AST-rejection bucket in the slice 5b migrator
 *  (39.3% of regex-eligible-but-AST-rejected bodies on agon, 2026-05-04).
 *
 *  See project_alpha_migrator_ast_plan.md memory for the empirical histogram. */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { parseDocumentWithDiagnostics } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: Array<{ type: string; props?: Record<string, unknown> }>): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children: children.map((c) => ({ ...c, props: c.props ?? {} })) };
}

describe('do body-statement — TS codegen', () => {
  test('lowers to bare expression statement', () => {
    const handler = makeHandler([{ type: 'do', props: { value: 'reg.load(engDir)' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('reg.load(engDir);');
  });

  test('handles method-chained call', () => {
    const handler = makeHandler([{ type: 'do', props: { value: 'arr.push(item)' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('arr.push(item);');
  });

  test('empty value emits nothing (no-op `do`)', () => {
    const handler = makeHandler([{ type: 'do', props: {} }]);
    expect(emitNativeKernBodyTS(handler)).toBe('');
  });

  test('composes with surrounding let/return statements', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'reg', value: 'new EngineRegistry()' } },
      { type: 'do', props: { value: 'reg.load(engDir)' } },
      { type: 'return', props: { value: 'reg' } },
    ]);
    expect(emitNativeKernBodyTS(handler)).toBe(
      ['const reg = new EngineRegistry();', 'reg.load(engDir);', 'return reg;'].join('\n'),
    );
  });

  test('propagation `?` discards the value, preserves the err-branch', () => {
    const handler = makeHandler([{ type: 'do', props: { value: 'mayFail()?' } }]);
    // Body is the same hoisted-tmp + err-propagate pattern as `let`/`return`/`throw`,
    // minus the value-side bind. The user wrote `do mayFail()?` to "run for
    // effect AND propagate err if it fails."
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = mayFail();');
    expect(out).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    // Crucially, no value-side bind line follows — that's what distinguishes
    // `do` from `let`.
    expect(out).not.toMatch(/const\s+\w+\s+=\s+__k_t1\.value/);
  });
});

describe('do body-statement — parser + validator', () => {
  test('valid inside handler lang="kern"', () => {
    const src = ['fn name=ok returns=void', '  handler lang="kern"', '    do value="run()"'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  test('rejected outside native-body scope', () => {
    const src = ['fn name=ok returns=void', '  do value="run()"'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const errs = diagnostics.filter(
      (d) => d.severity === 'error' && d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER',
    );
    expect(errs.length).toBeGreaterThan(0);
  });

  test('round-trip: parse handler with `do` child preserves shape through codegen', () => {
    const src = [
      'fn name=ok returns=number',
      '  handler lang="kern"',
      '    let name=reg value="new EngineRegistry()"',
      '    do value="reg.load(\\"x\\")"',
      '    return value="reg.size"',
    ].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const fn = root.children?.find((c: IRNode) => c.type === 'fn' && c.props?.name === 'ok');
    const handler = fn?.children?.find((c: IRNode) => c.type === 'handler' && c.props?.lang === 'kern');
    expect(handler).toBeDefined();
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toBe(['const reg = new EngineRegistry();', 'reg.load("x");', 'return reg.size;'].join('\n'));
  });
});
