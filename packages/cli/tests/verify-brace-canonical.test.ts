/** W2 — `isBraceOnlyDelta` is the safety boundary for the opt-in
 *  `--canonicalize-braces` migration verify. A false-accept silently
 *  miscompiles user code, so the negative matrix is the important half: every
 *  non-brace change (operator, rename, reorder, inserted/dropped statement,
 *  moved `else`, removed brace, comment delta) MUST reject. */

import { isBraceOnlyDelta } from '../src/verify-brace-canonical.js';

describe('isBraceOnlyDelta — accepts brace-only deltas', () => {
  test('byte-identical', () => {
    expect(isBraceOnlyDelta('return x;', 'return x;')).toBe(true);
  });

  test('if non-block then', () => {
    expect(isBraceOnlyDelta('if (x > 0) return x;', 'if (x > 0) {\n  return x;\n}')).toBe(true);
  });

  test('if non-block then + else', () => {
    expect(isBraceOnlyDelta('if (x) a(); else b();', 'if (x) {\n  a();\n} else {\n  b();\n}')).toBe(true);
  });

  test('while non-block', () => {
    expect(isBraceOnlyDelta('while (n < 3) n += 1;', 'while (n < 3) {\n  n += 1;\n}')).toBe(true);
  });

  test('for-of non-block', () => {
    expect(isBraceOnlyDelta('for (const x of xs) f(x);', 'for (const x of xs) {\n  f(x);\n}')).toBe(true);
  });

  test('else-if chain', () => {
    expect(isBraceOnlyDelta('if (a) x(); else if (b) y();', 'if (a) {\n  x();\n} else if (b) {\n  y();\n}')).toBe(true);
  });

  test('dangling else — correct binding (else stays with inner if)', () => {
    // `else` binds to the inner `if (b)` in both forms.
    expect(
      isBraceOnlyDelta('if (a) if (b) x(); else y();', 'if (a) {\n  if (b) {\n    x();\n  } else {\n    y();\n  }\n}'),
    ).toBe(true);
  });

  test('surrounding statements unchanged, only one body braced', () => {
    expect(
      isBraceOnlyDelta('const k = 1;\nif (a) f();\nreturn k;', 'const k = 1;\nif (a) {\n  f();\n}\nreturn k;'),
    ).toBe(true);
  });

  test('a preserved inline comment round-trips', () => {
    expect(isBraceOnlyDelta('if (x) f(); // note', 'if (x) {\n  f(); // note\n}')).toBe(true);
  });
});

describe('isBraceOnlyDelta — rejects any non-brace drift', () => {
  test('operator / value change inside the body', () => {
    expect(isBraceOnlyDelta('if (x) return x;', 'if (x) {\n  return y;\n}')).toBe(false);
  });

  test('condition change', () => {
    expect(isBraceOnlyDelta('if (x > 0) f();', 'if (x >= 0) {\n  f();\n}')).toBe(false);
  });

  test('inserted statement in the braced body', () => {
    expect(isBraceOnlyDelta('if (x) a();', 'if (x) {\n  a();\n  b();\n}')).toBe(false);
  });

  test('dangling else — WRONG binding (else moved to the outer if)', () => {
    // The migrated form re-binds `else` to the outer `if (a)` — a real
    // semantic change that must reject.
    expect(
      isBraceOnlyDelta('if (a) if (b) x(); else y();', 'if (a) {\n  if (b) {\n    x();\n  }\n} else {\n  y();\n}'),
    ).toBe(false);
  });

  test('brace REMOVED (reverse direction is not a valid canonicalization)', () => {
    expect(isBraceOnlyDelta('if (x) {\n  a();\n}', 'if (x) a();')).toBe(false);
  });

  test('dropped trailing comment', () => {
    expect(isBraceOnlyDelta('if (x) a(); // note', 'if (x) {\n  a();\n}')).toBe(false);
  });

  test('changed comment text', () => {
    expect(isBraceOnlyDelta('if (x) a(); // one', 'if (x) {\n  a(); // two\n}')).toBe(false);
  });

  test('unrelated statement changed elsewhere in the file', () => {
    expect(isBraceOnlyDelta('const k = 1;\nif (a) b();', 'const k = 2;\nif (a) {\n  b();\n}')).toBe(false);
  });

  test('a bare block is not equivalent to its unwrapped statement', () => {
    expect(isBraceOnlyDelta('{\n  a();\n}', 'a();')).toBe(false);
  });
});
