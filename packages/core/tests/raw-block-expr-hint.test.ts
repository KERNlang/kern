/** SPEC — express DX fix ③: sharpen the diagnostic when a raw `<<<…>>>` block
 * lands inside an expression value (e.g. `return <<< … >>>` under a plain
 * `handler`).
 *
 * Today this surfaces as the opaque `INVALID_EXPRESSION: … Unexpected token lt
 * ('<')`, which gives no hint that raw blocks must be a statement-line handler
 * body (`handler lang="ts" <<<…>>>`). The diagnostic must point the author at
 * the real cause and the fix.
 */

import { parseDocumentWithDiagnostics } from '../src/parser.js';

const SRC = [
  'server name=X port=3000',
  '  route method=get path=/a',
  '    handler',
  '      return <<< res.json(x) >>>',
].join('\n');

describe('raw <<< block inside an expression value yields an actionable hint', () => {
  test('the diagnostic names the raw-block cause and the lang= fix', () => {
    const { diagnostics } = parseDocumentWithDiagnostics(SRC);
    const diag = diagnostics.find((d) => d.message.includes('<<<') || /raw (code )?block/i.test(d.message));
    expect(diag).toBeDefined();
    const msg = diag!.message;
    // mentions the offending delimiter
    expect(msg).toContain('<<<');
    // tells the author raw blocks belong on a statement-line handler with lang=
    expect(msg).toMatch(/lang=/);
    expect(msg).toMatch(/handler/);
  });

  test('the bare "Unexpected token lt" message is no longer the whole story', () => {
    const { diagnostics } = parseDocumentWithDiagnostics(SRC);
    const exprDiag = diagnostics.find((d) => d.code === 'INVALID_EXPRESSION');
    // The fix may keep INVALID_EXPRESSION but it must carry the hint, OR replace
    // it with a dedicated raw-block diagnostic. Either way an actionable hint exists.
    const hinted = diagnostics.some((d) => d.message.includes('<<<') && /lang=/.test(d.message));
    expect(hinted).toBe(true);
    if (exprDiag) expect(exprDiag.message).toMatch(/<<</);
  });
});
