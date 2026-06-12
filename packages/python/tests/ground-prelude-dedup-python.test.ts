import { parseDocumentWithDiagnostics } from '../../core/src/parser.js';
import { generatePythonCoreNode } from '../src/codegen-python.js';

/**
 * Ground expression helper/import preludes are surfaced per-statement by
 * `groundExpressionPrelude`. When two ground statements in the SAME emitted
 * module need the same runtime helper block (e.g. `def _kern_js_fill`), the
 * block must appear EXACTLY ONCE in the assembled module — emitted before its
 * first use — not duplicated per statement.
 */
describe('Python Ground Layer: per-module helper prelude dedup', () => {
  function emitModule(lines: string[]): string {
    const moduleNode = parseDocumentWithDiagnostics(lines.join('\n')).root.children?.[0];
    return moduleNode ? generatePythonCoreNode(moduleNode).join('\n') : '';
  }

  test('emits a shared Array.fill helper block exactly once across two ground statements', () => {
    const output = emitModule([
      'module name=demo',
      "  firstTruthy name=a values=\"arr.fill(v), 'x'\"",
      "  firstTruthy name=b values=\"arr2.fill(w), 'y'\"",
    ]);

    // The helper def must appear once, not once per statement.
    expect(output.match(/^def _kern_js_fill\(/gmu) ?? []).toHaveLength(1);
    // Supporting helper blocks that ship alongside it must also be de-duped.
    expect(output.match(/^_KERN_JS_FILL_ABSENT = object\(\)$/gmu) ?? []).toHaveLength(1);
    expect(output.match(/^def _kern_js_relative_index\(/gmu) ?? []).toHaveLength(1);

    // Both statements still emit, and each uses the (single) helper.
    expect(output).toContain('a = _kern_js_fill(arr, v, 0, _KERN_JS_FILL_ABSENT) or "x"');
    expect(output).toContain('b = _kern_js_fill(arr2, w, 0, _KERN_JS_FILL_ABSENT) or "y"');

    // Determinism + scope: the single helper def precedes its first use.
    expect(output.indexOf('def _kern_js_fill(')).toBeLessThan(output.indexOf('a ='));
  });

  test('keeps a single ground statement that needs a helper unchanged (no dedup regression)', () => {
    const output = emitModule(['module name=solo', "  firstTruthy name=a values=\"arr.fill(v), 'x'\""]);

    expect(output.match(/^def _kern_js_fill\(/gmu) ?? []).toHaveLength(1);
    expect(output).toContain('a = _kern_js_fill(arr, v, 0, _KERN_JS_FILL_ABSENT) or "x"');
    expect(output.indexOf('def _kern_js_fill(')).toBeLessThan(output.indexOf('a ='));
  });
});
