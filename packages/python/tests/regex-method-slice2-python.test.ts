/** Milestone C, Slice 2 — host-`RegExp` fail-close, DISCRIMINATING cross-target tests.
 *
 *  The FINAL regex parity slice closes the Milestone-B `RegExp` host escape hatch.
 *  KERN's certified portable regex surface is the LITERAL `/…/` form (Slices
 *  1/3/4/5); the host `RegExp` constructor/global has NO portable cross-target
 *  lowering, so every reference to it fails-close — symmetrically, with a
 *  BYTE-IDENTICAL message on BOTH targets (the entire point of the shared
 *  `REGEX_HOST_REGEXP_FAILCLOSE` const).
 *
 *  WHY host `RegExp` cannot lower portably:
 *   - construction takes a STRING pattern, so KERN's literal-only escape/class
 *     pipeline never runs (`new RegExp("\\d")` already collapsed `"\\d"` → `\d`
 *     at the JS string layer, diverging from a `/\d/` literal), and the runtime
 *     SyntaxError/flag model differs across JS and Python `re`;
 *   - legacy statics (`RegExp.$1`, `RegExp.prototype`), value-position uses, and
 *     `/x/.source`/`/x/.flags` (which launder the pattern back to a string) are
 *     host-only.
 *
 *  This file asserts the EXACT thrown message on BOTH targets so a regression that
 *  desyncs the TS and Python diagnostics (the parity property) is caught without
 *  running both hosts. The TS-emit + IR-validate legs in isolation live in
 *  `packages/core/tests/regex-host-regexp-slice2.test.ts`.
 */

import type { IRNode } from '@kernlang/core';
import { emitExpression, emitNativeKernBodyTS, parseExpression, REGEX_HOST_REGEXP_FAILCLOSE } from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports, emitPyExpression } from '../src/codegen-body-python.js';

const ts = (src: string): { ok: boolean; message: string } => {
  try {
    return { ok: true, message: emitExpression(parseExpression(src), { isUserBinding: () => false }) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
};
const py = (src: string, outerBindings?: string[]): { ok: boolean; message: string } => {
  try {
    return { ok: true, message: emitPyExpression(parseExpression(src), outerBindings ? { outerBindings } : undefined) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
};

// Body-level emitters (for the alias-soundness + Slice 2/3 interaction tests,
// which need a binding table). Mirror the slice3 convention.
function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: {}, children } as IRNode;
}
const tsBody = (children: IRNode[]): string => emitNativeKernBodyTS(makeHandler(children));
const pyBody = (children: IRNode[]): string => emitNativeKernBodyPythonWithImports(makeHandler(children)).code;

describe('Slice 2 — host `RegExp` construction fails-close SYMMETRICALLY (byte-identical message)', () => {
  // kills: naive_py_verbatim — a Python impl that lets `new RegExp(...)` /
  // `RegExp(...)` fall through to a verbatim `RegExp(...)` (runtime NameError)
  // instead of a compile-time fail-close.
  test.each([
    'new RegExp("a")',
    'RegExp("a", "g")',
    'new RegExp(someVar)',
    'RegExp(getPattern())',
  ])('%s throws the SAME shared message on TS and Python', (src) => {
    const t = ts(src);
    const p = py(src);
    expect(t.ok).toBe(false);
    expect(p.ok).toBe(false);
    expect(t.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    expect(p.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    // The parity invariant, asserted directly: TS message === Python message.
    expect(p.message).toBe(t.message);
  });

  test('`new RegExp("\\\\d")` fails-close even on a CONSTANT string (escape-pipeline divergence)', () => {
    // The JS string already collapsed `"\\d"` → `\d`; the Python target never sees
    // a `/\d/` literal to run the class normalizer on, so over-rejection is correct.
    expect(py('new RegExp("\\\\d")').message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    expect(ts('new RegExp("\\\\d")').message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
  });
});

describe('Slice 2 — host-root statics, value-position, and literal-property reads (Python)', () => {
  // Legacy statics / prototype — default-deny through the GENERIC host-namespace
  // machinery (one diagnostic per site). The generic diagnostic intentionally
  // names the TARGET ("...in TypeScript expression" vs "...in Python expression"),
  // so it is symmetric-in-shape, not byte-identical — the byte-identical contract
  // is reserved for the target-agnostic regex-specific message. Both targets
  // close the access on the SAME `RegExp.<member>` root.
  test.each(['RegExp.prototype', 'RegExp.$1'])('host-root member %s fails-close on both targets', (src) => {
    const t = ts(src);
    const p = py(src);
    expect(t.ok).toBe(false);
    expect(p.ok).toBe(false);
    expect(t.message).toMatch(/Unsupported host namespace in TypeScript expression: RegExp\./);
    expect(p.message).toMatch(/Unsupported host namespace in Python expression: RegExp\./);
  });

  // `RegExp` as a bare VALUE — alias-soundness screen (subsumes `const R = RegExp`).
  test('bare-value `RegExp` fails-close with the shared regex message on Python', () => {
    const p = py('RegExp');
    expect(p.ok).toBe(false);
    expect(p.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
  });

  // `/x/.source` / `/x/.flags` — regex-literal property read, laundered to string.
  test.each(['/x/.source', '/x/.flags'])('regex-literal property read %s fails-close symmetrically', (src) => {
    const t = ts(src);
    const p = py(src);
    expect(t.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    expect(p.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    expect(p.message).toBe(t.message);
  });

  // REVIEW FIX #1 — the BRACKET (`index`) form of a regex-literal read. The Python
  // `lowerChain` `index` branch previously lowered `/x/["source"]` to
  // `__k_re.compile("x", …)["source"]` (invalid at runtime) — a verified bypass on
  // BOTH targets. Now fails-close byte-identically with the shared regex message.
  test.each([
    '/x/["source"]',
    '/x/["flags"]',
    '/x/["test"](s)',
  ])('regex-literal BRACKET read %s fails-close symmetrically (shared regex message)', (src) => {
    const t = ts(src);
    const p = py(src);
    expect(t.ok).toBe(false);
    expect(p.ok).toBe(false);
    expect(t.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    expect(p.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    expect(p.message).toBe(t.message);
  });
});

describe('Slice 2 — BLOCK-BODIED arrow bypass (review fix #2)', () => {
  // The bare-value guard + regex-literal-read guard previously fired only OUTSIDE
  // block bodies: block-bodied arrows delegated to raw block scanners that inspect
  // only MEMBER/CALL-shaped host accesses, so a bare `RegExp` value reference and a
  // regex-literal read inside a block PASSED TS emit + IR validate (and the Python
  // regex-bracket case PASSED Python too). They now fail-close with the
  // regex-specific message on BOTH targets, byte-identically.
  //
  // Block-bodied arrows need the TS-AST closure classifier to PARSE, which real
  // codegen injects through the BODY emitters (`emitNativeKernBodyTS` /
  // `...Python`). The expression-level `ts`/`py` helpers above intentionally lack
  // the classifier (parser-spine isolation), so these run at body level via a
  // `let f = <arrow>` handler — exactly the production emit path.
  const bodyEmitTS = (arrow: string): { ok: boolean; message: string } => {
    try {
      return { ok: true, message: tsBody([{ type: 'let', props: { name: 'f', value: arrow } } as IRNode]) };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  };
  const bodyEmitPy = (arrow: string): { ok: boolean; message: string } => {
    try {
      return { ok: true, message: pyBody([{ type: 'let', props: { name: 'f', value: arrow } } as IRNode]) };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  };

  test.each([
    '() => { return RegExp; }',
    '() => { const R = RegExp; return R; }',
    '() => { return /x/["source"]; }',
    '() => { return /x/.flags; }',
  ])('block-bodied arrow %s fails-close symmetrically with the shared regex message', (src) => {
    const t = bodyEmitTS(src);
    const p = bodyEmitPy(src);
    expect(t.ok).toBe(false);
    expect(p.ok).toBe(false);
    expect(t.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    expect(p.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    expect(p.message).toBe(t.message);
  });

  // must-not-over-fire — a block-LOCAL `const RegExp` shadow is the user's value.
  test('block-bodied arrow with a LOCAL `const RegExp` shadow does NOT fire on either target', () => {
    expect(bodyEmitTS('() => { const RegExp = 1; return RegExp; }').ok).toBe(true);
    expect(bodyEmitPy('() => { const RegExp = 1; return RegExp; }').ok).toBe(true);
  });
});

describe('Slice 2 — MUST-NOT-FIRE (resolver, not a textual name-check)', () => {
  // User shadow — `RegExp` bound to a user value. The body/expr binding table
  // makes the shadowed name a USER value, not the host root. Proves resolver.
  test('user shadow bare `RegExp` value does NOT fire when RegExp is user-bound (Python)', () => {
    expect(py('RegExp', ['RegExp']).ok).toBe(true);
  });

  // In-core literal regex methods — the certified portable surface STAYS working.
  test.each([
    '/lit/.test(s)',
    's.replace(/a/g, "b")',
    's.match(/([0-9]+)/)',
  ])('in-core literal method %s still transpiles on BOTH targets', (src) => {
    expect(ts(src).ok).toBe(true);
    expect(py(src).ok).toBe(true);
  });
});

describe('Slice 2 — alias soundness at BODY level (construction-first)', () => {
  // THE soundness proof: `let R = RegExp; new R("a")` must fail at the `let R =
  // RegExp` initializer (the bare-value screen), so `new R(...)` can never lower.
  // kills: naive_ident_passthrough — an impl that lets a bare `RegExp` ident bind
  // silently, allowing `new R(...)` to diverge across targets.
  test('`let R = RegExp; new R("a")` fails at the construction (initializer) site on both targets', () => {
    const children: IRNode[] = [
      { type: 'let', props: { name: 'R', kind: 'const', value: 'RegExp' } } as IRNode,
      { type: 'do', props: { value: 'new R("a")' } } as IRNode,
    ];
    expect(() => tsBody(children)).toThrow(REGEX_HOST_REGEXP_FAILCLOSE);
    expect(() => pyBody(children)).toThrow(REGEX_HOST_REGEXP_FAILCLOSE);
  });
});

describe('Slice 2/3 interaction — construction-first, no double-diagnose', () => {
  // `let r = new RegExp("a"); s.replace(r, "b")` must fail at the CONSTRUCTION
  // site (Slice 2, earliest+clearest) with the regex message — NOT the Slice-3
  // use-site non-literal message. Statements emit in order, so the `let`
  // initializer throws first and the use-site is never reached (one diagnostic).
  test('`let r = new RegExp("a"); s.replace(r, "b")` fails at construction with the Slice-2 message', () => {
    const children: IRNode[] = [
      { type: 'let', props: { name: 'r', kind: 'const', value: 'new RegExp("a")' } } as IRNode,
      { type: 'do', props: { value: 's.replace(r, "b")' } } as IRNode,
    ];
    expect(() => tsBody(children)).toThrow(REGEX_HOST_REGEXP_FAILCLOSE);
    expect(() => pyBody(children)).toThrow(REGEX_HOST_REGEXP_FAILCLOSE);
  });

  // Slice 3 keeps SOLE ownership of the literal-bound + misused path: `let r =
  // /lit/; s.replace(r, …)` is a Slice-3 non-literal fail-close, NOT a Slice-2
  // host-RegExp one. Slice 2 must never touch this path (no message substitution).
  test('`let r = /lit/; s.replace(r, "b")` stays the Slice-3 (non-literal) fail-close, not Slice 2', () => {
    const children: IRNode[] = [
      { type: 'let', props: { name: 'r', kind: 'const', value: '/lit/' } } as IRNode,
      { type: 'do', props: { value: 's.replace(r, "b")' } } as IRNode,
    ];
    // Throws (Slice 3), but NOT with the Slice-2 host-RegExp message.
    expect(() => tsBody(children)).toThrow();
    expect(() => pyBody(children)).toThrow();
    let tsMsg = '';
    let pyMsg = '';
    try {
      tsBody(children);
    } catch (e) {
      tsMsg = e instanceof Error ? e.message : String(e);
    }
    try {
      pyBody(children);
    } catch (e) {
      pyMsg = e instanceof Error ? e.message : String(e);
    }
    expect(tsMsg).not.toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    expect(pyMsg).not.toBe(REGEX_HOST_REGEXP_FAILCLOSE);
  });
});
