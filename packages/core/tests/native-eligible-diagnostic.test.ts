/** Native KERN eligibility diagnostic — slice 5a integration tests
 *  (slice α-4 update: severity promoted to `warning`).
 *
 *  Verifies that parseDocumentWithDiagnostics emits a NATIVE_KERN_ELIGIBLE
 *  warning-severity diagnostic on raw `<<<…>>>` handler bodies that pass the
 *  classifier, and stays silent on bodies that do not. */

import { parseDocumentWithDiagnostics } from '../src/parser.js';
import { collectNativeEligibleHints } from '../src/parser-validate-native-eligible.js';
import type { IRNode } from '../src/types.js';

function diagnostics(source: string) {
  return parseDocumentWithDiagnostics(source).diagnostics;
}

function nativeHints(source: string) {
  return diagnostics(source).filter((d) => d.code === 'NATIVE_KERN_ELIGIBLE');
}

describe('NATIVE_KERN_ELIGIBLE diagnostic — emission', () => {
  test('emits warning hint on raw handler with eligible body', () => {
    const src = ['fn name="add" type=int', '  handler <<<', '    return 1 + 2;', '  >>>'].join('\n');
    const hints = nativeHints(src);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.severity).toBe('warning');
    expect(hints[0]?.message).toMatch(/lang="kern"/);
  });

  test('hint message includes the migration suggestion', () => {
    const src = ['fn name="g" type=int', '  handler <<<', '    return 42;', '  >>>'].join('\n');
    const hints = nativeHints(src);
    expect(hints[0]?.suggestion).toMatch(/let\/return/);
  });
});

describe('NATIVE_KERN_ELIGIBLE diagnostic — lang=kern skip (direct validator)', () => {
  // The parser does not accept `lang="kern" <<< raw >>>` (the `<<<` becomes
  // a stray token, no `props.code` is attached), so the lang-skip branch
  // can't be exercised end-to-end. Slice 5a pre-push review (codex) flagged
  // that the prior parser-driven test passed vacuously. Drive the validator
  // directly with hand-built IR to actually prove the skip.

  function handler(props: Record<string, unknown>): IRNode {
    return {
      type: 'handler',
      props,
      children: [],
      loc: { line: 1, col: 1, endLine: 1, endCol: 5 },
    };
  }
  function doc(children: IRNode[]): IRNode {
    return { type: 'document', props: {}, children, loc: { line: 1, col: 1 } };
  }

  test('handler with code + lang=kern emits no hint', () => {
    const root = doc([handler({ code: 'return 1 + 2;', lang: 'kern' })]);
    expect(collectNativeEligibleHints(root)).toHaveLength(0);
  });

  test('handler with code + no lang emits hint', () => {
    const root = doc([handler({ code: 'return 1 + 2;' })]);
    const diagnostics = collectNativeEligibleHints(root);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('NATIVE_KERN_ELIGIBLE');
  });

  test('handler with code + lang="other" still emits hint', () => {
    // Only `lang === "kern"` skips. Other lang values shouldn't suppress —
    // those handlers are still raw-body candidates.
    const root = doc([handler({ code: 'return 1 + 2;', lang: 'other' })]);
    expect(collectNativeEligibleHints(root)).toHaveLength(1);
  });

  test('handler with no code prop emits no hint', () => {
    const root = doc([handler({ lang: 'kern' })]);
    expect(collectNativeEligibleHints(root)).toHaveLength(0);
  });

  test('handler with code + ineligible body emits no hint', () => {
    const root = doc([handler({ code: 'for (const x of xs) y += x; return y;' })]);
    expect(collectNativeEligibleHints(root)).toHaveLength(0);
  });
});

describe('NATIVE_KERN_ELIGIBLE diagnostic — silence cases', () => {
  test('no hint when raw body has a disqualifier (for-loop)', () => {
    const src = [
      'fn name="sum" type=int',
      '  handler <<<',
      '    let total = 0;',
      '    for (const x of xs) total += x;',
      '    return total;',
      '  >>>',
    ].join('\n');
    expect(nativeHints(src)).toHaveLength(0);
  });

  test('no hint when raw body uses arrow function', () => {
    const src = ['fn name="dbl" type=any', '  handler <<<', '    return xs.map(x => x * 2);', '  >>>'].join('\n');
    expect(nativeHints(src)).toHaveLength(0);
  });

  test('no hint on documents without handlers', () => {
    const src = ['fn name="x" type=int value=42'].join('\n');
    expect(nativeHints(src)).toHaveLength(0);
  });
});

describe('NATIVE_KERN_ELIGIBLE diagnostic — slice 4d coverage', () => {
  // Confirm that bodies using slice-4c+4d features (try/catch, throw, ??,
  // new, object spread) are flagged as eligible — these were ineligible
  // under the slice-4b baseline.

  test('emits hint on body using try/catch', () => {
    const src = [
      'fn name="safe" type=any',
      '  handler <<<',
      '    try {',
      '      return parse(s);',
      '    } catch (e) {',
      '      return null;',
      '    }',
      '  >>>',
    ].join('\n');
    expect(nativeHints(src)).toHaveLength(1);
  });

  test('emits hint on body using ??', () => {
    const src = ['fn name="def"', '  handler <<<', '    return name ?? "anon";', '  >>>'].join('\n');
    expect(nativeHints(src)).toHaveLength(1);
  });

  test('emits hint on body using throw', () => {
    const src = ['fn name="boom"', '  handler <<<', '    throw new Error("nope");', '  >>>'].join('\n');
    expect(nativeHints(src)).toHaveLength(1);
  });
});

describe('NATIVE_KERN_ELIGIBLE diagnostic — multi-handler walk', () => {
  test('emits one hint per eligible raw handler in the document', () => {
    const src = [
      'fn name="a" type=int',
      '  handler <<<',
      '    return 1;',
      '  >>>',
      'fn name="b" type=int',
      '  handler <<<',
      '    return 2;',
      '  >>>',
      'fn name="c" type=any',
      '  handler <<<',
      '    return xs.map(x => x);', // disqualified by =>
      '  >>>',
    ].join('\n');
    expect(nativeHints(src)).toHaveLength(2);
  });
});
