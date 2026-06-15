/** Milestone C, Slice 2 — host-`RegExp` fail-close (TS-emit + IR-validate legs).
 *
 *  The FINAL regex parity slice CLOSES the Milestone-B `RegExp` host escape hatch:
 *  `RegExp` was carried in `HOST_NAMESPACE_EXEMPT_ROOTS`, so
 *  `isHostNamespaceRoot('RegExp')` returned false. Slice 2 un-exempts it, making
 *  the host `RegExp` constructor/global RESERVED, and adds the regex-path screens
 *  the generic `Module.member` machinery does not cover (bare-value references,
 *  bare calls, `new`, and `/x/.source`/`/x/.flags` literal-property reads).
 *
 *  The certified portable regex surface is the LITERAL `/…/` form (Slices 1/3/4/5)
 *  — those stay working. This file pins the TS-emit and IR-validate legs; the
 *  Python-emit leg + the byte-identical-message symmetry assertions live in
 *  `packages/python/tests/regex-method-slice2-python.test.ts`.
 *
 *  SOUNDNESS — the key fixture is the ALIAS `const R = RegExp`: rejecting the
 *  bare-value reference at the initializer SUBSUMES alias-following — `new R(...)`
 *  can never silently diverge because the binding is refused up front. */

import { isHostNamespaceRoot } from '../src/codegen/host-namespace.js';
import { beginIRHostNamespacesValidatedTS } from '../src/codegen/host-namespace-ir.js';
import { REGEX_HOST_REGEXP_FAILCLOSE } from '../src/codegen/regex-normalize.js';
import { emitExpression } from '../src/codegen-expression.js';
import { parseExpression } from '../src/parser-expression.js';
import type { IRNode } from '../src/types.js';
import { typescriptClosureClassifier } from '../src/typescript-closure-classifier.js';

const parseExpr = (input: string): ReturnType<typeof parseExpression> =>
  parseExpression(input, { closureClassifier: typescriptClosureClassifier });

/** TS-emit leg — no user binding (top-level). Returns the thrown message or null. */
function emitTS(src: string, userBound: string[] = []): { ok: boolean; message: string } {
  const ctx = { isUserBinding: (n: string) => userBound.includes(n) };
  try {
    return { ok: true, message: emitExpression(parseExpr(src), ctx) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** IR-validate leg — drives the shared host-namespace validator over a
 *  `const c = <src>` so a bare-value `RegExp` reference is exercised at the const
 *  value site (the alias-soundness path). */
function validateIR(src: string, userBindings: string[] = []): { ok: boolean; message: string } {
  const mod: IRNode = {
    type: 'module',
    props: { name: 'M' },
    children: [{ type: 'const', props: { name: 'c', value: src }, children: [] }],
  };
  try {
    beginIRHostNamespacesValidatedTS(mod, { userBindings: new Set(userBindings) });
    return { ok: true, message: '' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

describe('Slice 2 — host `RegExp` is reserved (the exemption is closed)', () => {
  test('isHostNamespaceRoot("RegExp") is now true', () => {
    expect(isHostNamespaceRoot('RegExp')).toBe(true);
  });
});

describe('Slice 2 — FAIL-CLOSE on the host `RegExp` constructor/global (TS emit + IR validate)', () => {
  // Construction (with and without `new`) — fails EVEN ON A CONSTANT STRING, with
  // the regex-specific shared message (escape-pipeline / SyntaxError divergence).
  test.each([
    'new RegExp("a")',
    'RegExp("a", "g")',
    'new RegExp(someVar)', // dynamic pattern
    'RegExp(getPattern())',
  ])('construction %s fails-closed with the shared regex message on both legs', (src) => {
    const emit = emitTS(src);
    expect(emit.ok).toBe(false);
    expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    const val = validateIR(src);
    expect(val.ok).toBe(false);
    expect(val.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
  });

  // SOUNDNESS — the ALIAS. A bare-value reference to `RegExp` is refused at the
  // value site (here the const initializer), so `new R(...)` downstream can never
  // silently diverge. This is the addition that makes the slice sound on aliases.
  test('bare-value reference `const R = RegExp` fails-closed (subsumes alias-following)', () => {
    // const.value holds the RHS expression text `RegExp`.
    const val = validateIR('RegExp');
    expect(val.ok).toBe(false);
    expect(val.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    // …and the same bare value emitted as an expression also fails-closed.
    const emit = emitTS('RegExp');
    expect(emit.ok).toBe(false);
    expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
  });

  // `RegExp` passed as a VALUE (argument position) — same bare-value screen.
  test('`RegExp` passed as a call argument fails-closed', () => {
    const emit = emitTS('register(RegExp)');
    expect(emit.ok).toBe(false);
    expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
  });

  // Host ROOT member access (legacy statics, prototype) — DEFAULT-DENY. These
  // close through the GENERIC host-namespace machinery once RegExp is reserved
  // (one diagnostic per site; the regex-specific message is reserved for the
  // construction/value/literal-property positions the generic screen misses).
  test.each([
    'RegExp.prototype',
    'RegExp.$1',
    'RegExp.lastMatch',
  ])('host-root member %s fails-closed (generic host-namespace message)', (src) => {
    const emit = emitTS(src);
    expect(emit.ok).toBe(false);
    expect(emit.message).toMatch(/Unsupported host namespace/);
    const val = validateIR(src);
    expect(val.ok).toBe(false);
    expect(val.message).toMatch(/Unsupported host namespace/);
  });

  // `/x/.source` / `/x/.flags` on a REGEX LITERAL — launders the pattern/flags
  // back into a string. Regex-path-specific; the generic machinery does not see a
  // host-namespace ROOT here (the receiver is a literal, not an ident).
  test.each([
    '/x/.source',
    '/x/.flags',
    '/abc/gi.source',
  ])('regex-literal property read %s fails-closed with the shared regex message on both legs', (src) => {
    const emit = emitTS(src);
    expect(emit.ok).toBe(false);
    expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    const val = validateIR(src);
    expect(val.ok).toBe(false);
    expect(val.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
  });
});

describe('Slice 2 — MUST-NOT-FIRE (resolver, not a textual name-check)', () => {
  // User shadow — `const RegExp = myThing; RegExp.foo()`. The locals scope makes
  // the shadowed name a USER value, not the host root. Proves it is a scope-aware
  // resolver, not a textual `"RegExp"` name-check.
  test('user shadow `RegExp.foo()` does NOT fire when RegExp is user-bound (TS emit)', () => {
    expect(emitTS('RegExp.foo()', ['RegExp']).ok).toBe(true);
  });

  test('user shadow `RegExp.foo()` does NOT fire when RegExp is user-bound (IR validate)', () => {
    expect(validateIR('RegExp.foo()', ['RegExp']).ok).toBe(true);
  });

  test('user shadow bare-value `RegExp` does NOT fire when RegExp is user-bound', () => {
    expect(emitTS('RegExp', ['RegExp']).ok).toBe(true);
    expect(validateIR('RegExp', ['RegExp']).ok).toBe(true);
  });

  // In-core literal regex methods — the certified portable surface (Slices 1/3/4/5)
  // STAYS working; Slice 2 must not close it.
  test.each([
    '/lit/.test(s)',
    's.replace(/a/g, "b")',
    's.match(/([0-9]+)/)',
    's.split(/,/)',
  ])('in-core literal method %s still transpiles (TS emit)', (src) => {
    expect(emitTS(src).ok).toBe(true);
  });
});

describe('Slice 2 — shared fail-close message contract', () => {
  test('REGEX_HOST_REGEXP_FAILCLOSE names construction, statics, and source/flags', () => {
    expect(REGEX_HOST_REGEXP_FAILCLOSE).toContain("Host 'RegExp' is not portable");
    expect(REGEX_HOST_REGEXP_FAILCLOSE).toContain('new RegExp');
    expect(REGEX_HOST_REGEXP_FAILCLOSE).toContain('.source');
    expect(REGEX_HOST_REGEXP_FAILCLOSE).toContain('/…/'); // points users at the literal form
  });
});
