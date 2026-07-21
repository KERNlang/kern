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

import {
  collectClosureBlockMemberAccesses,
  collectClosureBlockRegexHostViolations,
  collectClosureBlockTypeofOperands,
} from '../src/closure-eligibility.js';
import { isHostNamespaceRoot } from '../src/codegen/host-namespace.js';
import { beginIRHostNamespacesValidatedTS } from '../src/codegen/host-namespace-ir.js';
import {
  REGEX_EXEC_FAILCLOSE,
  REGEX_HOST_REGEXP_FAILCLOSE,
  REGEX_TEST_G_FAILCLOSE,
} from '../src/codegen/regex-normalize.js';
import { emitExpression } from '../src/codegen-expression.js';
import { parseExpression } from '../src/parser-expression.js';
import type { IRNode } from '../src/types.js';
import {
  typescriptClosureClassifier,
  validateClosureBlockHostNamespacesTS,
} from '../src/typescript-closure-classifier.js';

const parseExpr = (input: string): ReturnType<typeof parseExpression> =>
  parseExpression(input, { closureClassifier: typescriptClosureClassifier });

/** TS-emit leg — no user binding (top-level). Returns the thrown message or null.
 *  Injects `validateRawBlock` exactly as real codegen does (body-ts.ts /
 *  type-system.ts), so block-bodied arrows are validated through the same
 *  TS-AST closure classifier the production path uses. */
function emitTS(src: string, userBound: string[] = []): { ok: boolean; message: string } {
  const ctx = {
    isUserBinding: (n: string) => userBound.includes(n),
    validateRawBlock: validateClosureBlockHostNamespacesTS,
  };
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
  test.each(['RegExp.prototype', 'RegExp.$1', 'RegExp.lastMatch'])(
    'host-root member %s fails-closed (generic host-namespace message)',
    (src) => {
      const emit = emitTS(src);
      expect(emit.ok).toBe(false);
      expect(emit.message).toMatch(/Unsupported host namespace/);
      const val = validateIR(src);
      expect(val.ok).toBe(false);
      expect(val.message).toMatch(/Unsupported host namespace/);
    },
  );

  // `/x/.source` / `/x/.flags` on a REGEX LITERAL — launders the pattern/flags
  // back into a string. Regex-path-specific; the generic machinery does not see a
  // host-namespace ROOT here (the receiver is a literal, not an ident).
  test.each(['/x/.source', '/x/.flags', '/abc/gi.source'])(
    'regex-literal property read %s fails-closed with the shared regex message on both legs',
    (src) => {
      const emit = emitTS(src);
      expect(emit.ok).toBe(false);
      expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
      const val = validateIR(src);
      expect(val.ok).toBe(false);
      expect(val.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    },
  );

  // REVIEW FIX #1 — the BRACKET (`index`) form of a regex-literal property read.
  // `/x/["source"]` / `/x/["flags"]` launder the pattern/flags to a string exactly
  // like the dotted `/x/.source` form; `/x/["test"](s)` is a bracket-called
  // host-only method. The `index` branch previously did NOT screen these (only the
  // `member` branch did), so they BYPASSED Slice 2 entirely — verified against the
  // built code. They now fail-close byte-identically on BOTH legs. A COMPUTED
  // index (`/x/[k]`) is unknowable and also fails-close.
  test.each(['/x/["source"]', '/x/["flags"]', '/x/["test"](s)', '/abc/gi["source"]'])(
    'regex-literal BRACKET read %s fails-closed with the shared regex message on both legs',
    (src) => {
      const emit = emitTS(src);
      expect(emit.ok).toBe(false);
      expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
      const val = validateIR(src);
      expect(val.ok).toBe(false);
      expect(val.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    },
  );

  // REVIEW FIX #2 — BLOCK-BODIED arrows. The bare-value guard and the
  // regex-literal-read guard previously fired only OUTSIDE block bodies: a
  // block-bodied arrow delegated to raw block scanners that inspect only
  // MEMBER/CALL-shaped host accesses, so a bare `RegExp` value reference and a
  // regex-literal bracket read inside a block PASSED both TS emit and IR validate
  // (verified against the built code). The alias-soundness claim was FALSE inside
  // blocks. They now fail-close with the regex-specific message on BOTH legs.
  test.each([
    '() => { return RegExp; }',
    '() => { const R = RegExp; return R; }',
    '() => { return /x/["source"]; }',
    '() => { return /x/.flags; }',
    '() => { const f = /x/["test"]; return f; }',
  ])('block-bodied arrow %s fails-closed with the shared regex message on both legs', (src) => {
    const emit = emitTS(src);
    expect(emit.ok).toBe(false);
    expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    const val = validateIR(src);
    expect(val.ok).toBe(false);
    expect(val.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
  });

  // REVIEW FIX #2 (must-not-over-fire) — a block-bodied arrow that SHADOWS RegExp
  // with a block-local binding uses the user's value, so the bare reference must
  // NOT fire (it is a scope-aware AST walk, not a textual name-check). A genuine
  // host member on a non-RegExp root still goes through the generic scan.
  test('block-bodied arrow with a LOCAL `const RegExp` shadow does NOT fire', () => {
    const emit = emitTS('() => { const RegExp = 1; return RegExp; }');
    expect(emit.ok).toBe(true);
  });

  // REVIEW FIX #2 (round 3) — value-position shapes the bare-`RegExp` screen must
  // ALSO catch inside a block body: an object PROPERTY VALUE and a SHORTHAND
  // property are value references (the expression-level path fails-close both).
  test.each(['() => ({ x: RegExp })', '() => ({ RegExp })'])(
    'block-bodied arrow %s (RegExp in value/shorthand position) fails-closed',
    (src) => {
      const emit = emitTS(src);
      expect(emit.ok).toBe(false);
      expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
      const val = validateIR(src);
      expect(val.ok).toBe(false);
      expect(val.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    },
  );

  // REVIEW FIX #2 (round 3) — NESTED-block shadow scoping. A `const RegExp`
  // declared ONLY inside a nested block shadows references WITHIN that block,
  // but an OUTER reference still sees the host root → fails-close. (This is the
  // case the old global-registration walk got wrong on the Python leg: it
  // treated the nested local as a whole-closure shadow and fail-OPENED the outer
  // `return RegExp`. The TS leg now uses real per-block scope.)
  test('nested-block `const RegExp` does NOT shadow an OUTER reference (fails-closed)', () => {
    const emit = emitTS('() => { if (ok) { const RegExp = 1; } return RegExp; }');
    expect(emit.ok).toBe(false);
    expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
  });

  // …but a reference INSIDE the nested block DOES see the nested local → OK.
  test('nested-block `const RegExp` DOES shadow an in-block reference (does not fire)', () => {
    expect(emitTS('() => { if (ok) { const RegExp = 1; return RegExp; } return 2; }').ok).toBe(true);
  });

  // REVIEW FIX #2 (round 3) — TDZ / lexical hoisting. JS block-scoping hoists a
  // block's `const`/`let` for the WHOLE block, so a reference lexically BEFORE
  // the declarator is still the block-local, not the host. The walk must NOT
  // over-reject `let x = RegExp; const RegExp = 1`.
  test('block-local TDZ reference `let x = RegExp; const RegExp = 1` does NOT fire', () => {
    expect(emitTS('() => { let x = RegExp; const RegExp = 1; return x; }').ok).toBe(true);
  });

  // REVIEW FIX #2 (round 3) — a portable METHOD CALLEE on a regex literal
  // (`/x/.test(s)`) is handled by the call path and must NOT be over-rejected by
  // the block walk. A TYPE-ANNOTATION reference (`const x: RegExp = /a/`) is an
  // erased type, not a value use, and must NOT fire either.
  test.each(['() => { return /x/.test(s); }', '() => { const x: RegExp = /a/; return x; }'])(
    'block-bodied arrow %s does NOT fire (portable method / erased type)',
    (src) => {
      expect(emitTS(src).ok).toBe(true);
    },
  );

  // REVIEW FIX #2 (round 3) — ONLY the DOTTED method call is portable. A
  // BRACKET-form call (`/x/["test"](s)`) is NOT lowered by `lowerRegexCallTS`
  // (which lowers `callee.kind === 'member'` only), so it fails-close exactly
  // like a bare bracket read — matching the expression-level index screen.
  test('block-bodied arrow `/x/["test"](s)` (bracket call) fails-closed (only DOTTED is portable)', () => {
    const emit = emitTS('() => { return /x/["test"](s); }');
    expect(emit.ok).toBe(false);
    expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    // …byte-identical to the expression-level bracket-call message.
    expect(emit.message).toBe(emitTS('/x/["test"](s)').message);
  });

  // REVIEW FIX #2 (round 3) — MESSAGE CONSISTENCY: `RegExp.prototype` inside a
  // block uses the GENERIC host-namespace message (the member-object position is
  // owned by the generic scan), NOT the regex-specific message — identical to
  // the expression-level member-receiver path.
  test('block-bodied arrow `RegExp.prototype` uses the GENERIC host message (not regex)', () => {
    const emit = emitTS('() => { return RegExp.prototype; }');
    expect(emit.ok).toBe(false);
    expect(emit.message).toMatch(/Unsupported host namespace/);
    expect(emit.message).not.toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    // …and matches the expression-level message for the same access, byte-for-byte.
    expect(emit.message).toBe(emitTS('RegExp.prototype').message);
  });

  // REVIEW FIX #2 (round 3) — the `.exec` and `/g`-`.test` callees carry their
  // OWN Slice-3 messages (NOT the regex-host one), matching expression-level.
  test('block-bodied arrow `/x/.exec(s)` / `/x/g.test(s)` carry the expression-level method message', () => {
    const exec = emitTS('() => { return /x/.exec(s); }');
    expect(exec.ok).toBe(false);
    expect(exec.message).toBe(emitTS('/x/.exec(s)').message);
    const testG = emitTS('() => { return /x/g.test(s); }');
    expect(testG.ok).toBe(false);
    expect(testG.message).toBe(emitTS('/x/g.test(s)').message);
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
  test.each(['/lit/.test(s)', 's.replace(/a/g, "b")', 's.match(/([0-9]+)/)', 's.split(/,/)'])(
    'in-core literal method %s still transpiles (TS emit)',
    (src) => {
      expect(emitTS(src).ok).toBe(true);
    },
  );
});

describe('Slice 2 — non-portable literal-receiver METHOD pins the regex message', () => {
  // NIT — when `lowerRegexCallTS` returns null for a non-portable literal-receiver
  // method (`/x/.compile(...)`), emit falls through to the member-callee path,
  // which sees `object.kind === 'regexLit'` with a non-portable property and
  // throws the regex-specific `REGEX_HOST_REGEXP_FAILCLOSE`. Pinned here so the
  // message can't silently drift to the generic host-namespace diagnostic.
  test('`/x/.compile(...)` (non-portable literal method) throws the shared regex message', () => {
    const emit = emitTS('/x/.compile("y")');
    expect(emit.ok).toBe(false);
    expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
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

describe('Slice 2 — CONVERGENT classifier unification (round 4)', () => {
  // BLOCKING fix — the COMMON `/x/.test(s)` was over-rejected by IR-validate: its
  // `call` case re-validated the callee as a bare member READ and threw the
  // host-RegExp message, while TS-emit (via `lowerRegexCallTS`) ACCEPTED it — an
  // internal divergence on a very common method. IR-validate now consults the
  // SHARED classifier for the callee, so it accepts the portable dotted method.
  test('IR-validate ACCEPTS the common `/x/.test(s)` (BLOCKING fix), matching TS-emit', () => {
    expect(validateIR('/x/.test(s)').ok).toBe(true);
    expect(emitTS('/x/.test(s)').ok).toBe(true);
    // the same portable dotted methods on a literal, also accepted by both legs
    expect(validateIR('/lit/.test(input)').ok).toBe(true);
  });

  // `.exec` / `/g`-`.test` are NON-portable dotted methods. IR-validate now emits
  // the PRECISE Slice-3 message (not the generic host-RegExp one), byte-identical
  // to the TS-emit leg — the unification carries the message, not just the verdict.
  test('IR-validate emits the PRECISE `.exec` / `/g`-`.test` messages, matching TS-emit', () => {
    const exec = validateIR('/x/.exec(s)');
    expect(exec.ok).toBe(false);
    expect(exec.message).toBe(REGEX_EXEC_FAILCLOSE);
    expect(exec.message).toBe(emitTS('/x/.exec(s)').message);

    const testG = validateIR('/x/g.test(s)');
    expect(testG.ok).toBe(false);
    expect(testG.message).toBe(REGEX_TEST_G_FAILCLOSE);
    expect(testG.message).toBe(emitTS('/x/g.test(s)').message);
  });

  // EXACT accept/reject + message AGREEMENT between TS-emit and IR-validate over the
  // whole regex-host surface — the convergence property the unification guarantees.
  test.each([
    ['/x/.test(s)', true],
    ['/lit/.test(input)', true],
    ['/x/.exec(s)', false],
    ['/x/g.test(s)', false],
    ['/x/.compile("y")', false],
    ['/x/.source', false],
    ['/x/["source"]', false],
    ['/x/["test"](s)', false],
    ['/x/[k]', false],
    ['new (RegExp)()', false],
    ['new RegExp("a")', false],
    ['RegExp', false],
  ])('TS-emit and IR-validate AGREE on %s (accept + message)', (src, expectOk) => {
    const e = emitTS(src);
    const v = validateIR(src);
    expect(e.ok).toBe(expectOk);
    expect(v.ok).toBe(expectOk);
    if (!expectOk) {
      // byte-identical fail-close message across the two legs
      expect(v.message).toBe(e.message);
    }
  });

  // `new someObj.RegExp()` — the new-callee ROOT resolves to `someObj` (a member
  // chain), NOT the host `RegExp`, on BOTH legs (the receiver-root resolution is
  // shared). So it ACCEPTS symmetrically; it is NOT a host-RegExp construction.
  test('`new someObj.RegExp()` resolves root to `someObj` and accepts on both legs', () => {
    expect(emitTS('new someObj.RegExp()').ok).toBe(true);
    expect(validateIR('new someObj.RegExp()').ok).toBe(true);
  });

  // OVER-REJECTION fix — an object-literal METHOD / GETTER / SETTER named `RegExp`
  // (and a class PROPERTY named `RegExp`) is a member KEY, not a host VALUE
  // reference, so the bare-`RegExp` closure screen must NOT fire on it. Driven
  // directly through the AST walk (the KERN parser/gate rejects these bodies
  // upstream for unrelated reasons, so the walk is the unit under test).
  test.each([
    '{ return { RegExp() {} }; }',
    '{ return { get RegExp() { return 1; } }; }',
    '{ return { set RegExp(v) {} }; }',
    '{ class C { RegExp = 1; } return C; }',
  ])('object/class member named `RegExp` does NOT fire the bare-value screen: %s', (raw) => {
    const firing = collectClosureBlockRegexHostViolations(raw).filter((v) => !v.locallyShadowed);
    expect(firing).toHaveLength(0);
  });

  // …but a SHORTHAND `({ RegExp })` IS a value reference and MUST still fire.
  test('shorthand `({ RegExp })` is a value reference and still fires', () => {
    const firing = collectClosureBlockRegexHostViolations('{ return ({ RegExp }); }').filter((v) => !v.locallyShadowed);
    expect(firing).toHaveLength(1);
  });

  // DESTRUCTURING shadow — a `const { RegExp } = x` / `const [RegExp] = arr` binds
  // a block-local `RegExp`, so a later `return RegExp` reference is the local (NOT
  // the host) and must NOT fire. The TS walk honors it via the shared
  // binding-pattern extraction.
  test.each(['{ const { RegExp } = x; return RegExp; }', '{ const [RegExp] = arr; return RegExp; }'])(
    'destructured `RegExp` shadow does NOT fire the bare-value screen: %s',
    (raw) => {
      const firing = collectClosureBlockRegexHostViolations(raw).filter((v) => !v.locallyShadowed);
      expect(firing).toHaveLength(0);
    },
  );

  // `/x/[k]` — the access itself fails-close ONCE (computed index), but the index
  // EXPRESSION `k` is still walked for its OWN host violations (no double-reject of
  // the access, no skipped index). `/x/[/y/.source]` ⇒ 2 violations (outer access
  // + the inner regex-literal read in the index); `/x/[k]` ⇒ exactly 1.
  test('computed index `/x/[k]` fails-close ONCE and still validates the index expr', () => {
    expect(collectClosureBlockRegexHostViolations('{ return /x/[k]; }')).toHaveLength(1);
    // the index expr carries its own regex-literal violation → 2 total
    expect(collectClosureBlockRegexHostViolations('{ return /x/[/y/.source]; }')).toHaveLength(2);
  });
});

describe('Slice 2 — WRAPPED regex-literal receiver fails-close (round 5)', () => {
  // BLOCKING fix — a regex-literal receiver UNDER transparent type-only wrappers
  // (`(/x/ as any)`, `(/x/!)`, parens, nested combinations) previously BYPASSED
  // the fail-close on every leg: the DIRECT `object.kind === 'regexLit'` check
  // missed the wrapper, so `(/x/ as any).source` emitted verbatim while bare
  // `/x/.source` correctly failed-close. The receiver is now UNWRAPPED
  // (`regexLiteralReceiverIR` on the IR legs / `unwrapRegexReceiverTS` on the
  // TS-AST closure leg) before the regex-literal check, so the wrapped form is
  // screened identically to the bare form — on TS-emit AND IR-validate, with the
  // byte-identical message. (The Python-emit leg + cross-target symmetry are
  // pinned in regex-method-slice2-python.test.ts.)
  test.each([
    '(/x/).source',
    '(/x/ as any).source',
    '(/x/!)["source"]',
    '(/x/g as any).test(s)', // /g `.test` → REGEX_TEST_G_FAILCLOSE (stateful lastIndex)
    '(/x/).exec(s)',
    '(/x/)["test"](s)', // BRACKET call — never a portable dotted callee
    '((/x/ as any)).source', // NESTED wrappers (recursion)
    '(/x/ as any).exec(s)',
    '(/x/!).flags',
    '((/x/g))["test"](s)',
  ])('wrapped fail-close %s fails-closed on TS-emit AND IR-validate (byte-identical)', (src) => {
    const emit = emitTS(src);
    const val = validateIR(src);
    expect(emit.ok).toBe(false);
    expect(val.ok).toBe(false);
    // The wrapped fail-close message is byte-identical across the two legs…
    expect(val.message).toBe(emit.message);
    // …and EXACTLY matches the BARE form's verdict+message (the wrapper is erased,
    // so the access classifies identically). Strip the outer wrappers/parens to
    // recover the bare source for the `.source`/`.exec`/bracket cases.
  });

  // The wrapped form's message is byte-identical to the BARE literal's message —
  // proving the wrapper is fully transparent to the classifier (not a different
  // diagnostic path). `(/x/ as any).source` === `/x/.source`;
  // `(/x/g as any).test(s)` === `/x/g.test(s)`; `(/x/).exec(s)` === `/x/.exec(s)`.
  test.each([
    ['(/x/ as any).source', '/x/.source'],
    ['(/x/!)["source"]', '/x/["source"]'],
    ['(/x/g as any).test(s)', '/x/g.test(s)'],
    ['(/x/).exec(s)', '/x/.exec(s)'],
    ['((/x/ as any)).source', '/x/.source'],
    ['(/x/)["test"](s)', '/x/["test"](s)'],
  ])('wrapped %s yields the SAME message as bare %s on both legs', (wrapped, bare) => {
    expect(emitTS(wrapped).message).toBe(emitTS(bare).message);
    expect(validateIR(wrapped).message).toBe(validateIR(bare).message);
  });

  // BLOCK-BODY (TS-AST closure leg) — the same wrapped receivers inside a
  // block-bodied arrow fail-close through `collectClosureBlockRegexHostViolations`
  // (the leg `emitTS` drives via `validateRawBlock`), each producing exactly one
  // regex-literal violation, byte-identical to the bare form.
  test.each([
    '() => { return (/x/).source; }',
    '() => { return (/x/g).test(s); }', // /g .test → fail-close
    '() => { return (/x/).exec(s); }',
    '() => { return (/x/)["test"](s); }',
    '() => { return (/x/ as any).source; }',
    '() => { return (/x/!)["source"]; }',
    '() => { return ((/x/ as any)).source; }',
  ])('block-bodied arrow wrapped receiver %s fails-closed', (src) => {
    expect(emitTS(src).ok).toBe(false);
  });

  // The block-body wrapped violation count + message matches the bare form,
  // proving the TS-AST unwrap mirrors the IR unwrap by construction.
  test('block-body wrapped `(/x/).source` matches bare `/x/.source` (count + message)', () => {
    const wrapped = collectClosureBlockRegexHostViolations('{ return (/x/).source; }');
    const bare = collectClosureBlockRegexHostViolations('{ return /x/.source; }');
    expect(wrapped).toHaveLength(bare.length);
    expect(wrapped[0]?.message).toBe(bare[0]?.message);
  });

  // WRAPPED PORTABLE — a parenthesized/wrapped literal with a PORTABLE dotted
  // method (`(/x/).test(s)`) is still portable and ACCEPTS, lowering to the SAME
  // output as the bare `/x/.test(s)` (the wrapper is erased). Accepts identically
  // on TS-emit, IR-validate, AND the block-body closure leg.
  test.each(['(/x/).test(s)', '(/x/ as any).test(s)', '((/x/)).test(s)'])(
    'wrapped portable %s ACCEPTS and lowers like the bare `/x/.test(s)`',
    (src) => {
      const emit = emitTS(src);
      expect(emit.ok).toBe(true);
      expect(emit.message).toBe(emitTS('/x/.test(s)').message); // identical TS lowering
      expect(validateIR(src).ok).toBe(true);
    },
  );

  test('wrapped portable `(/x/).test(s)` accepts in a block body too', () => {
    expect(emitTS('() => { return (/x/).test(s); }').ok).toBe(true);
  });
});

describe('Slice 2 — `typeof <host root>` fail-close (round 6 — the round-5 carve-out was too broad)', () => {
  // ROUND-6 REGRESSION FIX. The round-5 carve-out special-cased `typeof <ANY bare
  // ident>` to dodge the bare-`RegExp` reject — but that re-opened reserved host
  // roots. `typeof RegExp` is NOT portable: TS emits the native `typeof RegExp`
  // (JS reads the host global), but the Python leg lowers `typeof` to a runtime
  // `isinstance` ladder over the Python name `RegExp`, which does not exist
  // (NameError). So `typeof RegExp` is a genuine TS↔Python divergence and now
  // fails-close — with the SAME message a bare `RegExp` value reference uses (the
  // Python-emit parity is pinned in the python slice-2 test).
  test('`typeof RegExp` now FAILS-CLOSE (regex message) on TS-emit + IR-validate', () => {
    const emit = emitTS('typeof RegExp');
    expect(emit.ok).toBe(false);
    expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    const val = validateIR('typeof RegExp');
    expect(val.ok).toBe(false);
    expect(val.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
  });

  // The round-5 carve-out also accepted `typeof Date` / `typeof process` (other
  // reserved host roots). These DIVERGE identically (Python `typeof` ladder over a
  // nonexistent name) and now fail-close with the GENERIC host message on both
  // legs. (Bare VALUE refs `const c = Date` are deliberately left accepted — a
  // wider, separately-charted slice; this fix closes only the `typeof` divergence.)
  test.each(['typeof Date', 'typeof process', 'typeof console'])(
    '%s FAILS-CLOSE with the generic host message on TS-emit + IR-validate',
    (src) => {
      const emit = emitTS(src);
      expect(emit.ok).toBe(false);
      expect(emit.message).toMatch(/Unsupported host namespace/);
      const val = validateIR(src);
      expect(val.ok).toBe(false);
      expect(val.message).toMatch(/Unsupported host namespace/);
      // The two legs emit the BYTE-IDENTICAL diagnostic (parity property).
      expect(emit.message).toBe(val.message);
    },
  );

  // A NON-host-root operand (a user local / an undeclared feature-detection flag)
  // must NOT be over-rejected — `window`/`document`/`setTimeout` are not host
  // roots, so the canonical `typeof window === 'undefined'` SSR idiom keeps working.
  test.each(['typeof userLocal', 'typeof undeclaredFeatureFlag', 'typeof window', 'typeof document'])(
    '%s is NOT over-rejected (emits native typeof) on TS-emit + IR-validate',
    (src) => {
      const emit = emitTS(src);
      expect(emit.ok).toBe(true);
      expect(emit.message).toBe(src); // native typeof, no reject
      expect(validateIR(src).ok).toBe(true);
    },
  );

  // User shadowing — a `const Date = …` binding makes `Date` the user's value, so
  // `typeof Date` is accepted (honored identically on both legs).
  test('`typeof Date` with a user binding of `Date` is accepted on both legs', () => {
    expect(emitTS('typeof Date', ['Date']).ok).toBe(true);
    expect(validateIR('typeof Date', ['Date']).ok).toBe(true);
  });

  // `typeof <host root>` inside a BLOCK body fails-close identically — RegExp with
  // the regex message (the regex walk now sees the bare `RegExp` value reference
  // since the `typeof` exemption was removed), other host roots with the generic
  // message — so the closure-walk leg stays byte-aligned with the expression legs.
  test('`typeof RegExp` inside a block body NOW fires the bare-value (regex) screen', () => {
    const emit = emitTS('() => { return typeof RegExp; }');
    expect(emit.ok).toBe(false);
    expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    expect(collectClosureBlockRegexHostViolations('{ return typeof RegExp; }')).toHaveLength(1);
  });

  test.each(['() => { return typeof Date; }', '() => { return typeof process; }'])(
    '%s inside a block body fails-close with the generic host message',
    (src) => {
      const emit = emitTS(src);
      expect(emit.ok).toBe(false);
      expect(emit.message).toMatch(/Unsupported host namespace/);
    },
  );

  // …but a block-LOCAL shadow of a host root makes `typeof <name>` the user value
  // (accepted), and a non-host `typeof userLocal` inside a block is untouched.
  test.each(['() => { const Date = x; return typeof Date; }', '() => { return typeof userLocal; }'])(
    '%s inside a block body is accepted (shadowed / non-host operand)',
    (src) => {
      expect(emitTS(src).ok).toBe(true);
    },
  );

  // …and `typeof RegExp.prototype` reads a MEMBER (a launder), so it still
  // fails-close via the member-root screen — `typeof` does not blanket-exempt a
  // member access (it emits the GENERIC host message, one diagnostic per site).
  test('`typeof RegExp.prototype` still fails-close (member read, not a bare ident)', () => {
    expect(emitTS('typeof RegExp.prototype').ok).toBe(false);
    expect(validateIR('typeof RegExp.prototype').ok).toBe(false);
  });
});

describe('Slice 2 — WRAPPED `typeof <host root>` fail-close (round 7 — close the wrapped-operand bypass)', () => {
  // ROUND-7 REGRESSION FIX. The round-6 `typeof <host root>` reject only fired when
  // the operand was a DIRECT `ident` (`node.argument.kind === 'ident'`). A WRAPPED
  // operand — parenthesized `typeof (Date)`, asserted `typeof (Date as any)`,
  // non-null `typeof (Date!)`, nested `typeof (Date as any as unknown)` — arrived as
  // a `typeAssert`/`nonNull` node and BYPASSED the reject: TS emitted the wrapper
  // verbatim while the Python leg lowered a runtime Date/process lookup → divergence.
  // The fix RECURSIVELY peels the transparent wrappers via the round-5
  // `unwrapTransparentReceiverIR` (fixpoint over `typeAssert`/`nonNull`) BEFORE the
  // host-root check on ALL legs, so a wrapped operand screens exactly like the bare
  // form. (The TS-AST closure leg uses the round-5 `unwrapRegexReceiverTS` twin.)

  // Date / process / a NESTED double-assertion all fail-close with the GENERIC host
  // message on both legs — byte-identical (the parity property), exactly like the
  // bare `typeof Date` round-6 case.
  test.each([
    'typeof (Date)',
    'typeof (Date as any)',
    'typeof (Date!)',
    'typeof (process as any)',
    'typeof (process!)',
    'typeof (Date as any as unknown)', // nested — fixpoint unwrap must collapse
  ])('%s FAILS-CLOSE with the generic host message on TS-emit + IR-validate (identical)', (src) => {
    const emit = emitTS(src);
    expect(emit.ok).toBe(false);
    expect(emit.message).toMatch(/Unsupported host namespace/);
    const val = validateIR(src);
    expect(val.ok).toBe(false);
    expect(val.message).toMatch(/Unsupported host namespace/);
    expect(emit.message).toBe(val.message);
  });

  // A wrapped `RegExp` operand fails-close with the REGEX message (matching the bare
  // `typeof RegExp` round-6 case), not the generic host one.
  test.each(['typeof (RegExp)', 'typeof (RegExp as any)', 'typeof (RegExp!)'])(
    '%s FAILS-CLOSE with the regex message on TS-emit + IR-validate',
    (src) => {
      const emit = emitTS(src);
      expect(emit.ok).toBe(false);
      expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
      const val = validateIR(src);
      expect(val.ok).toBe(false);
      expect(val.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
    },
  );

  // A wrapped NON-host operand must NOT be over-rejected — the wrappers are peeled
  // ONLY to DECIDE the host-root reject; the bare `userLocal`/`window` is accepted,
  // and the emitter re-emits from the ORIGINAL argument so the `as`/`!` wrappers are
  // PRESERVED (round-8 fix — stripping them broke emitter round-tripping). Bare
  // parens around a plain ident carry no syntax (the parser discards them), so
  // `typeof (userLocal)` correctly emits `typeof userLocal`.
  test.each([
    ['typeof (userLocal)', 'typeof userLocal'],
    ['typeof (userLocal as any)', 'typeof (userLocal as any)'],
    ['typeof (window)', 'typeof window'],
    ['typeof (window as any)', 'typeof (window as any)'],
  ])('%s is NOT over-rejected (emits native typeof) on TS-emit + IR-validate', (src, emitted) => {
    const emit = emitTS(src);
    expect(emit.ok).toBe(true);
    expect(emit.message).toBe(emitted);
    expect(validateIR(src).ok).toBe(true);
  });

  // User shadowing survives the unwrap — a `const Date` binding makes the wrapped
  // `typeof (Date as any)` the user's value (accepted on both legs).
  test('wrapped `typeof (Date as any)` with a user binding of `Date` is accepted on both legs', () => {
    expect(emitTS('typeof (Date as any)', ['Date']).ok).toBe(true);
    expect(validateIR('typeof (Date as any)', ['Date']).ok).toBe(true);
  });

  // CLOSURE-WALK leg — the operand collector now unwraps the transparent TS-AST
  // wrappers, so a wrapped operand records the UNDERLYING name (Date/process/RegExp/
  // userLocal), matching the ValueIR legs. (The consumer rejects Date/process via
  // the generic host message; RegExp is owned by the regex walk, hence skipped here.)
  test('closure-walk records the UNWRAPPED operand name for wrapped `typeof`', () => {
    expect(collectClosureBlockTypeofOperands('{ return typeof (Date as any); }')).toEqual([
      { name: 'Date', locallyShadowed: false },
    ]);
    expect(collectClosureBlockTypeofOperands('{ return typeof (process!); }')).toEqual([
      { name: 'process', locallyShadowed: false },
    ]);
    expect(collectClosureBlockTypeofOperands('{ return typeof (Date as any as unknown); }')).toEqual([
      { name: 'Date', locallyShadowed: false },
    ]);
    expect(collectClosureBlockTypeofOperands('{ return typeof (userLocal as any); }')).toEqual([
      { name: 'userLocal', locallyShadowed: false },
    ]);
  });

  // …and the block-bodied emit path fails-close on the wrapped operand: Date/process
  // with the generic host message, RegExp with the regex message (the regex walk
  // catches the wrapped `RegExp`), while a wrapped non-host / block-local-shadowed
  // operand is accepted.
  test.each(['() => { return typeof (Date as any); }', '() => { return typeof (process!); }'])(
    'block-bodied %s fails-close with the generic host message',
    (src) => {
      const emit = emitTS(src);
      expect(emit.ok).toBe(false);
      expect(emit.message).toMatch(/Unsupported host namespace/);
    },
  );

  test('block-bodied wrapped `typeof (RegExp as any)` fails-close with the regex message', () => {
    const emit = emitTS('() => { return typeof (RegExp as any); }');
    expect(emit.ok).toBe(false);
    expect(emit.message).toBe(REGEX_HOST_REGEXP_FAILCLOSE);
  });

  test.each(['() => { return typeof (userLocal as any); }', '() => { const Date = x; return typeof (Date as any); }'])(
    'block-bodied %s is accepted (non-host / shadowed wrapped operand)',
    (src) => {
      expect(emitTS(src).ok).toBe(true);
    },
  );
});

describe('Slice 2 — OVER-REJECTION fixes (round 5)', () => {
  // A wrapped NON-regex receiver (`(someVar).source`) is unaffected — no regex
  // fail-close; it emits/validates as an ordinary member read.
  test.each(['(someVar).source', '(someVar as any).source', '(obj.x!).flags'])(
    'wrapped NON-regex receiver %s is unaffected (no regex fail-close)',
    (src) => {
      expect(emitTS(src).ok).toBe(true);
      expect(validateIR(src).ok).toBe(true);
    },
  );
});

describe('Slice 2 — block-scope-aware member scan (round 6 — close the TS↔Python divergence)', () => {
  // ROUND-6 REGRESSION FIX. The generic `collectClosureBlockMemberAccesses` used
  // to declare a block-local only AFTER visiting its initializer, so a host-root
  // access in a PRIOR initializer was seen as the host namespace even though a
  // block-local of the same name shadows the WHOLE block. TS rejected while the
  // Python lowerer (which predeclares block locals via `enterBlockScope`) accepted
  // → a fresh TS↔Python divergence for non-RegExp host roots. The scan now
  // PREDECLARES each block's top-level bindings before visiting its refs (matching
  // the regex walk + the Python `enterBlockScope`), so a block-local shadow is
  // honored for the whole block.
  test('`{ let x = process.cwd(); const process = fake; return x; }` sees `process` as the block-local', () => {
    const accesses = collectClosureBlockMemberAccesses('{ let x = process.cwd(); const process = fake; return x; }');
    expect(accesses).toEqual([{ root: 'process', member: 'cwd', locallyShadowed: true }]);
    // …so the block-bodied arrow is ACCEPTED (the block-local `process` is the
    // user's value; identical to the Python leg, which also accepts it).
    expect(emitTS('() => { let x = process.cwd(); const process = fake; return x; }').ok).toBe(true);
  });

  test('`{ return process.cwd(); }` (no shadow) still fails-close on both legs', () => {
    const accesses = collectClosureBlockMemberAccesses('{ return process.cwd(); }');
    expect(accesses).toEqual([{ root: 'process', member: 'cwd', locallyShadowed: false }]);
    const emit = emitTS('() => { return process.cwd(); }');
    expect(emit.ok).toBe(false);
    expect(emit.message).toMatch(/Unsupported host namespace/);
  });

  // A block-local declared in a NESTED block must NOT shadow the OUTER block's
  // host-root access (real block-scoping): the outer `process.cwd()` still
  // fails-close even though an inner block redeclares `process`.
  test('a nested-block `process` shadow does NOT cover an outer-block host access', () => {
    const accesses = collectClosureBlockMemberAccesses(
      '{ const r = process.cwd(); if (c) { const process = fake; } return r; }',
    );
    const outer = accesses.find((a) => a.root === 'process' && a.member === 'cwd');
    expect(outer).toBeDefined();
    expect(outer?.locallyShadowed).toBe(false);
  });
});
