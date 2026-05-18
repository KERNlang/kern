/** Parser — multi-line `value={{ ... }}` expression blocks.
 *
 *  Pre-change: tokeniser scanned one line at a time and rejected any `{{ ... }}`
 *  whose closing `}}` wasn't on the same line with `UNCLOSED_EXPR`. Authors had
 *  to flatten 5+ line expressions onto a single line or fall back to a raw
 *  `handler <<<...>>>` block.
 *
 *  Now: scanLineState tracks unclosed `{{` depth across lines, and the parseLines
 *  stitching loop (parser-core.ts) absorbs subsequent lines until the matching
 *  `}}` closes — mirroring the existing multi-line quoted-string behaviour.
 *
 *  Tests verify:
 *    - multi-line {{ ... }} parses as a single `expr` token, content preserved
 *    - depth counting handles nested {{ }} across line boundaries
 *    - unclosed multi-line {{ still emits UNCLOSED_EXPR at end-of-file
 *    - single-line {{ }} behaviour is unchanged (regression)
 *    - structural lines (comments, `<<<` openers) halt stitching defensively
 */

import { parseDocumentWithDiagnostics, parseWithDiagnostics, tokenizeLine } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function findNode(root: IRNode, type: string): IRNode | null {
  if (root.type === type) return root;
  for (const child of root.children ?? []) {
    const hit = findNode(child, type);
    if (hit) return hit;
  }
  return null;
}

describe('multi-line {{ ... }} expression blocks', () => {
  // Expression props store as `{ __expr: true, code: '...' }` per parser-core.ts:187.
  function exprCode(propValue: unknown): string {
    if (typeof propValue === 'object' && propValue !== null && '__expr' in propValue) {
      return (propValue as { code: string }).code;
    }
    return String(propValue);
  }

  test('two-line {{ ... }} parses cleanly and preserves the inner expression', () => {
    const src = ['button label="Submit" disabled={{', '  formState.isSubmitting || !formState.isValid', '}}'].join(
      '\n',
    );
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const button = findNode(root, 'button');
    expect(exprCode(button?.props?.disabled)).toBe('formState.isSubmitting || !formState.isValid');
  });

  test('5+ line {{ ... }} (the original friction case) parses cleanly', () => {
    const src = [
      'button label="Submit" disabled={{',
      '  formState.isSubmitting ||',
      '  !formState.isValid ||',
      '  formState.errors.length > 0 ||',
      '  remainingQuota <= 0',
      '}}',
    ].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const button = findNode(root, 'button');
    // Inner is the joined-and-trimmed expression body; whitespace between
    // tokens is preserved verbatim (TS accepts the multi-line form directly).
    const code = exprCode(button?.props?.disabled);
    expect(code).toContain('formState.isSubmitting');
    expect(code).toContain('remainingQuota <= 0');
  });

  test('nested {{ }} across line boundaries — depth counting works', () => {
    const src = ['text value={{', '  outer({{', '    inner', '  }})', '}}'].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const text = findNode(root, 'text');
    // The outer `{{ ... }}` captured the entire nested expression as one value.
    const code = exprCode(text?.props?.value);
    expect(code).toContain('outer(');
    expect(code).toContain('inner');
  });

  test('unclosed multi-line {{ still emits UNCLOSED_EXPR at end of file', () => {
    const src = ['text value={{', '  formState.isValid', '  // no closing }}'].join('\n');
    const { diagnostics } = parseWithDiagnostics(src);
    const unclosed = diagnostics.find((d) => d.code === 'UNCLOSED_EXPR');
    expect(unclosed).toBeDefined();
  });

  test('single-line {{ }} behaviour is unchanged (regression)', () => {
    const tokens = tokenizeLine('button disabled={{isLoading}}');
    const exprToken = tokens.find((t) => t.kind === 'expr');
    expect(exprToken?.value).toBe('isLoading');
  });

  test('structural lines (comment-starting) halt stitching defensively', () => {
    // A `#`-starting line is a file-level comment in the outer parse loop.
    // The stitcher must refuse to absorb it into a runaway {{ block, the same
    // defensive guard the multi-line quoted-string stitcher already has.
    const src = ['text value={{', '# this is a top-level comment', '}}'].join('\n');
    const { diagnostics } = parseWithDiagnostics(src);
    // Either UNCLOSED_EXPR fires on the orphan {{ or the }} line is rejected —
    // the key invariant is the # line itself isn't silently absorbed.
    expect(diagnostics.some((d) => d.code === 'UNCLOSED_EXPR' || d.severity === 'error')).toBe(true);
  });

  test('`handler <<<` opener halts stitching defensively', () => {
    const src = ['text value={{', '  handler <<<', '    return 1', '  >>>'].join('\n');
    const { diagnostics } = parseWithDiagnostics(src);
    // Stitcher refuses to swallow the `handler <<<` opener.
    expect(diagnostics.some((d) => d.code === 'UNCLOSED_EXPR' || d.severity === 'error')).toBe(true);
  });
});
