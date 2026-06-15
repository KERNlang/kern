/** regex-normalize CLASS-/ESCAPE-AWARENESS — DISCRIMINATING tests (both targets).
 *
 *  `normalizeRegexClasses` rewrites the shorthand classes `\d \w \s` to explicit
 *  ASCII classes on BOTH targets (the Slice-1 parity contract). The original
 *  implementation was a BLIND `replaceAll`, which had two real correctness bugs:
 *
 *    1. INSIDE a `[...]` set, `\d` must expand to the BARE range `0-9` (no
 *       brackets) — the blind replace turned `/[\d_]/` into the INVALID nested
 *       class `[[0-9]_]`.
 *    2. An ESCAPED `\\d` (a literal backslash + the letter `d`, NOT the digit
 *       shorthand) was wrongly rewritten to `[0-9]`.
 *
 *  The fix walks the pattern with `classDepth` + escape bookkeeping: out of a
 *  class `\d`→`[0-9]`, in a class `\d`→`0-9`, and an escaped `\\d` stays verbatim.
 *  Each row pins the EXACT emitted TS literal AND the EXACT emitted Python
 *  `re.compile(...)`, so the old blind impl FAILS them (revert-check rows noted).
 *
 *  ESCAPE-ASYMMETRY NOTE (the parity risk this fix had to clear): the TS emitter
 *  calls `normalizeRegexClasses(node.pattern)` on the RAW literal source while the
 *  Python emitter calls it on `unescaped = node.pattern.replace(/\\\//g, '/')`
 *  (only `\/`→`/`). That un-escape touches ONLY the forward slash — never a
 *  `d`/`w`/`s`/`[`/`]` and never the escape-parity of a following shorthand — so
 *  the shorthand expansion is byte-identical across targets. The byte-parity rows
 *  below assert this directly (the Python pattern, un-escaped back, equals the TS
 *  pattern modulo that documented `\/`→`/` collapse).
 */

import { emitExpression, parseExpression } from '@kernlang/core';
import { emitPyExpression } from '../src/codegen-body-python.js';

const ts = (src: string): string => emitExpression(parseExpression(src));
const py = (src: string): string => emitPyExpression(parseExpression(src));

/** The raw regex pattern between the TS literal's slashes (drops `/…/flags`). */
const tsPattern = (src: string): string => {
  const m = ts(src).match(/^\/(.*)\/[a-z]*$/s);
  if (m === null) throw new Error(`not a TS regex literal: ${ts(src)}`);
  return m[1];
};

/** The decoded (JSON-unescaped) pattern string the Python emitter passed to
 *  `__k_re.compile("…", …)`. */
const pyPattern = (src: string): string => {
  const m = py(src).match(/__k_re\.compile\((".*?")/s);
  if (m === null) throw new Error(`not a Python re.compile: ${py(src)}`);
  return JSON.parse(m[1]) as string;
};

describe('normalizeRegexClasses — in-class shorthand expands to BARE range (nested-class bug fix)', () => {
  // REVERT-CHECK: the blind replaceAll emitted the INVALID nested class
  // `[[0-9]_]`. The fix emits the bare `0-9` inside the existing class.
  test('/[\\d_]/ → [0-9_] (in-class bare, NOT [[0-9]_]) on both targets', () => {
    expect(ts('/[\\d_]/')).toBe('/[0-9_]/');
    expect(py('/[\\d_]/')).toBe('__k_re.compile("[0-9_]", __k_re.ASCII)');
  });

  // Out-of-class behavior is UNCHANGED (bracketed expansion) — regression guard.
  test('/\\d+/ → [0-9]+ (out-of-class bracketed, unchanged) on both targets', () => {
    expect(ts('/\\d+/')).toBe('/[0-9]+/');
    expect(py('/\\d+/')).toBe('__k_re.compile("[0-9]+", __k_re.ASCII)');
  });

  // Negated class: the leading `^` is a negation marker, `\d` still expands bare.
  test('/[^\\d]/ → [^0-9] (negated class) on both targets', () => {
    expect(ts('/[^\\d]/')).toBe('/[^0-9]/');
    expect(py('/[^\\d]/')).toBe('__k_re.compile("[^0-9]", __k_re.ASCII)');
  });

  // Shorthand between literal members — bare expansion keeps the class valid.
  test('/[a\\dz]/ → [a0-9z] (shorthand between literals) on both targets', () => {
    expect(ts('/[a\\dz]/')).toBe('/[a0-9z]/');
    expect(py('/[a\\dz]/')).toBe('__k_re.compile("[a0-9z]", __k_re.ASCII)');
  });

  // Two consecutive in-class shorthands both expand BARE (would be doubly-nested
  // `[[0-9][A-Za-z0-9_]]` under the blind impl).
  test('/[\\d\\w]/ → [0-9A-Za-z0-9_] (consecutive shorthands) on both targets', () => {
    expect(ts('/[\\d\\w]/')).toBe('/[0-9A-Za-z0-9_]/');
    expect(py('/[\\d\\w]/')).toBe('__k_re.compile("[0-9A-Za-z0-9_]", __k_re.ASCII)');
  });

  // In-class \s expands to its BARE set inside the brackets (no nesting).
  test('/[\\s]/ → [ \\t\\n\\r\\f\\v] (in-class \\s bare) on both targets', () => {
    expect(ts('/[\\s]/')).toBe('/[ \\t\\n\\r\\f\\v]/');
    expect(py('/[\\s]/')).toBe('__k_re.compile("[ \\\\t\\\\n\\\\r\\\\f\\\\v]", __k_re.ASCII)');
  });

  // Out-of-class \s is the bracketed set (unchanged behavior).
  test('/\\s/ → [ \\t\\n\\r\\f\\v] (out-of-class \\s) on both targets', () => {
    expect(ts('/\\s/')).toBe('/[ \\t\\n\\r\\f\\v]/');
    expect(py('/\\s/')).toBe('__k_re.compile("[ \\\\t\\\\n\\\\r\\\\f\\\\v]", __k_re.ASCII)');
  });

  // \w then a literal trailing dash (last-position `-` is a literal hyphen).
  test('/[\\w-]/ → [A-Za-z0-9_-] (\\w then literal dash) on both targets', () => {
    expect(ts('/[\\w-]/')).toBe('/[A-Za-z0-9_-]/');
    expect(py('/[\\w-]/')).toBe('__k_re.compile("[A-Za-z0-9_-]", __k_re.ASCII)');
  });

  // Two out-of-class shorthands each get their own bracketed expansion.
  test('/\\d\\d/ → [0-9][0-9] (two out-of-class) on both targets', () => {
    expect(ts('/\\d\\d/')).toBe('/[0-9][0-9]/');
    expect(py('/\\d\\d/')).toBe('__k_re.compile("[0-9][0-9]", __k_re.ASCII)');
  });
});

describe('normalizeRegexClasses — escaped backslash is NOT a shorthand (literal \\\\d bug fix)', () => {
  // REVERT-CHECK: the blind replaceAll rewrote the LITERAL `\\d` (escaped
  // backslash + `d`) to `\\[0-9]`. The fix leaves it verbatim — the `\` is
  // escaped, so the `d` is a literal letter, not a shorthand.
  test('/\\\\d/ → \\\\d VERBATIM (escaped backslash + literal d) on both targets', () => {
    expect(ts('/\\\\d/')).toBe('/\\\\d/');
    expect(py('/\\\\d/')).toBe('__k_re.compile("\\\\\\\\d", __k_re.ASCII)');
  });

  // Escaped backslash + d INSIDE a class — also untouched.
  test('/[\\\\d]/ → [\\\\d] VERBATIM (escaped in class) on both targets', () => {
    expect(ts('/[\\\\d]/')).toBe('/[\\\\d]/');
    expect(py('/[\\\\d]/')).toBe('__k_re.compile("[\\\\\\\\d]", __k_re.ASCII)');
  });

  // A class with an ESCAPED `]` member then a TRUE in-class `\d` — proves the
  // escape-aware scan finds the right `]` and only the active `\d` expands bare.
  test('/[\\]\\d]/ → [\\]0-9] (escaped-] member, then in-class \\d bare) on both targets', () => {
    expect(ts('/[\\]\\d]/')).toBe('/[\\]0-9]/');
    expect(py('/[\\]\\d]/')).toBe('__k_re.compile("[\\\\]0-9]", __k_re.ASCII)');
  });
});

describe('normalizeRegexClasses — no over-reach on patterns WITHOUT shorthand', () => {
  // Regression guard: a literal range class is untouched.
  test('/[a-z]+/ → unchanged on both targets', () => {
    expect(ts('/[a-z]+/')).toBe('/[a-z]+/');
    expect(py('/[a-z]+/')).toBe('__k_re.compile("[a-z]+", __k_re.ASCII)');
  });

  // Regression guard: a `\b` word-boundary literal pattern is untouched (and the
  // `\b`s are not shorthand classes).
  test('/\\bword\\b/ → unchanged on both targets', () => {
    expect(ts('/\\bword\\b/')).toBe('/\\bword\\b/');
    expect(py('/\\bword\\b/')).toBe('__k_re.compile("\\\\bword\\\\b", __k_re.ASCII)');
  });
});

describe('normalizeRegexClasses — TS-vs-Python BYTE-PARITY of the emitted pattern', () => {
  // The two legs feed `normalizeRegexClasses` the same input modulo the Python
  // `\/`→`/` un-escape (which touches only `/`). So the residual pattern is
  // byte-identical across targets — assert it directly for the three killer
  // shapes (in-class bare, escaped literal, in-class \s).
  const byteParity = (src: string): void => {
    const t = tsPattern(src);
    const p = pyPattern(src);
    // Apply the SAME `\/`→`/` collapse the Python emitter applies before
    // normalization, so we compare the same construct (no `/` is present in any
    // of these rows, so it is a no-op here — but it documents the contract).
    expect(t.replace(/\\\//g, '/')).toBe(p);
  };

  test('/[\\d_]/ — TS and Python emit byte-identical [0-9_]', () => {
    byteParity('/[\\d_]/');
  });

  test('/\\\\d/ — TS and Python emit byte-identical \\\\d', () => {
    byteParity('/\\\\d/');
  });

  test('/[\\s]/ — TS and Python emit byte-identical [ \\t\\n\\r\\f\\v]', () => {
    byteParity('/[\\s]/');
  });

  // Escape-asymmetry stress: an escaped `\/` immediately BEFORE a shorthand `\d`.
  // TS sees `a\/[0-9]b`; Python (after `\/`→`/`) sees `a/[0-9]b`. The byteParity
  // helper collapses the TS `\/` the same way, so they match — proving the
  // un-escape never disturbs the shorthand expansion.
  test('/a\\/\\db/ — escaped-slash before shorthand stays parity-correct', () => {
    byteParity('/a\\/\\db/');
    expect(ts('/a\\/\\db/')).toBe('/a\\/[0-9]b/');
    expect(py('/a\\/\\db/')).toBe('__k_re.compile("a/[0-9]b", __k_re.ASCII)');
  });
});
