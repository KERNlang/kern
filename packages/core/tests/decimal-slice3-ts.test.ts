/** DECIMAL Slice 3 — TS-leg emission, compile-time fail-close, preamble rendering,
 *  and producer-detection lockstep for div/mod/pow + the comparators.
 *
 *  The byte-exact RUNTIME parity is proven by the differential-EXECUTION oracle in
 *  `@kernlang/python` (`decimal-emission-slice3-python.test.ts`), which runs BOTH
 *  node+decimal.js and python3+decimal. THIS suite locks the TS-leg lowering shapes,
 *  the symmetric compile-time refusals, and that the auto-emitted file-level Decimal
 *  preamble now carries the guarded ops helpers. */

import {
  assertPortableDecimalPow,
  DECIMAL_DIV_ZERO_FAILCLOSE,
  DECIMAL_MOD_ZERO_FAILCLOSE,
  DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE,
  DECIMAL_OPERATOR_FAILCLOSE,
  DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
  DECIMAL_UNARY_OPERAND_FAILCLOSE,
  decimalImportLineTS,
  decimalOfLiteralValue,
  decimalOpsHelpersTS,
  detectKernStdlibUsage,
  emitExpression,
  emitExpressionWithImports,
  KERN_STDLIB,
  kernStdlibPreamble,
  parseExpression,
} from '../src/index.js';
import type { IRNode } from '../src/types.js';

const ts = (src: string): string => emitExpression(parseExpression(src));

describe('Decimal Slice 3 — TS div/mod/pow lowering (guarded helpers)', () => {
  test('div → __k_decimal_div(...)', () => {
    expect(ts('Decimal.div(Decimal.of("1"), Decimal.of("3"))')).toBe(
      '__k_decimal_div(new Decimal("1"), new Decimal("3"))',
    );
  });
  test('mod → __k_decimal_mod(...)', () => {
    expect(ts('Decimal.mod(Decimal.of("-5.5"), Decimal.of("2"))')).toBe(
      '__k_decimal_mod(new Decimal("-5.5"), new Decimal("2"))',
    );
  });
  test('pow → __k_decimal_pow_int(...)', () => {
    expect(ts('Decimal.pow(Decimal.of("2"), Decimal.of("3"))')).toBe(
      '__k_decimal_pow_int(new Decimal("2"), new Decimal("3"))',
    );
  });
  test('div records the decimal.js import', () => {
    const r = emitExpressionWithImports(parseExpression('Decimal.div(Decimal.of("1"), Decimal.of("3"))'));
    expect([...r.imports]).toEqual(['decimal.js']);
  });
});

describe('Decimal Slice 3 — TS comparison lowering (native, NOT through stringifier)', () => {
  test('eq/ne/lt/lte/gt/gte → native decimal.js methods', () => {
    expect(ts('Decimal.eq(Decimal.of("1"), Decimal.of("1"))')).toBe('new Decimal("1").eq(new Decimal("1"))');
    expect(ts('Decimal.ne(Decimal.of("1"), Decimal.of("2"))')).toBe('!new Decimal("1").eq(new Decimal("2"))');
    expect(ts('Decimal.lt(Decimal.of("1"), Decimal.of("2"))')).toBe('new Decimal("1").lt(new Decimal("2"))');
    expect(ts('Decimal.lte(Decimal.of("2"), Decimal.of("2"))')).toBe('new Decimal("2").lte(new Decimal("2"))');
    expect(ts('Decimal.gt(Decimal.of("3"), Decimal.of("2"))')).toBe('new Decimal("3").gt(new Decimal("2"))');
    expect(ts('Decimal.gte(Decimal.of("3"), Decimal.of("3"))')).toBe('new Decimal("3").gte(new Decimal("3"))');
  });
  test('cmp → native .cmp() (plain number)', () => {
    expect(ts('Decimal.cmp(Decimal.of("1"), Decimal.of("2"))')).toBe('new Decimal("1").cmp(new Decimal("2"))');
  });
});

describe('Decimal Slice 3 — compile-time pow fail-close (TS leg)', () => {
  test('non-integer exponent literal', () => {
    expect(() => ts('Decimal.pow(Decimal.of("2"), Decimal.of("0.5"))')).toThrow(DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE);
  });
  test('negative base literal', () => {
    expect(() => ts('Decimal.pow(Decimal.of("-2"), Decimal.of("3"))')).toThrow(DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE);
  });
  test('non-literal (dynamic) exponent — the soundness-critical refusal', () => {
    expect(() => ts('Decimal.pow(Decimal.of("2"), x)')).toThrow(DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE);
    expect(() => ts('Decimal.pow(Decimal.of("2"), Decimal.add(Decimal.of("1"), Decimal.of("1")))')).toThrow(
      DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
    );
  });
  test('integer exponent on non-negative base ships (incl. 0**0 and negative exp)', () => {
    expect(() => ts('Decimal.pow(Decimal.of("0"), Decimal.of("0"))')).not.toThrow();
    expect(() => ts('Decimal.pow(Decimal.of("2"), Decimal.of("3"))')).not.toThrow();
    expect(() => ts('Decimal.pow(Decimal.of("2"), Decimal.of("-1"))')).not.toThrow();
  });
  test('assertPortableDecimalPow is callable directly on raw IR', () => {
    const goodBase = parseExpression('Decimal.of("2")');
    const goodExp = parseExpression('Decimal.of("3")');
    expect(() => assertPortableDecimalPow(goodBase, goodExp)).not.toThrow();
    const badExp = parseExpression('Decimal.of("2.5")');
    expect(() => assertPortableDecimalPow(goodBase, badExp)).toThrow(DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE);
  });
});

describe('Decimal Slice 3 — decimalOfLiteralValue helper', () => {
  test('extracts the literal from a Decimal.of("...") call', () => {
    expect(decimalOfLiteralValue(parseExpression('Decimal.of("3")'))).toBe('3');
    expect(decimalOfLiteralValue(parseExpression('Decimal.of("-7")'))).toBe('-7');
  });
  test('returns null for a non-Decimal.of shape', () => {
    expect(decimalOfLiteralValue(parseExpression('x'))).toBeNull();
    expect(decimalOfLiteralValue(parseExpression('Decimal.add(Decimal.of("1"), Decimal.of("2"))'))).toBeNull();
    expect(decimalOfLiteralValue(parseExpression('Other.of("3")'))).toBeNull();
  });
});

describe('Decimal Slice 3 — operator fail-close extends to div/mod/pow producers', () => {
  // div/mod/pow PRODUCE a Decimal, so `Decimal.div(a,b) + 1` trips the operator
  // fail-close exactly like add (a JS `+` on a decimal.js value degrades to float).
  test('Decimal.div(...) + Decimal.of(...) fails closed', () => {
    expect(() => ts('Decimal.div(Decimal.of("1"), Decimal.of("3")) + Decimal.of("1")')).toThrow(
      DECIMAL_OPERATOR_FAILCLOSE,
    );
  });
  // Comparators return bool/int — NOT a Decimal — so `Decimal.eq(a,b) + 1` is
  // ordinary boolean→number arithmetic and must NOT be refused.
  test('Decimal.eq(...) + 1 is NOT a Decimal-operator misuse (bool result)', () => {
    expect(() => ts('Decimal.eq(Decimal.of("1"), Decimal.of("1")) + 1')).not.toThrow();
  });
  test('Decimal.cmp(...) + 1 is NOT a Decimal-operator misuse (int result)', () => {
    expect(() => ts('Decimal.cmp(Decimal.of("1"), Decimal.of("2")) + 1')).not.toThrow();
  });
});

describe('Decimal Slice 3 — file-level preamble carries the guarded ops helpers', () => {
  function kernHandlerUsing(expr: string): IRNode {
    return {
      type: 'fn',
      props: { name: 'f' },
      children: [{ type: 'handler', props: { lang: 'kern' }, children: [{ type: 'return', props: { value: expr } }] }],
    };
  }

  test('a div handler flips usage.decimal and the preamble emits the helpers', () => {
    const usage = detectKernStdlibUsage(kernHandlerUsing('Decimal.div(Decimal.of("1"), Decimal.of("3"))'));
    expect(usage.decimal).toBe(true);
    const preamble = kernStdlibPreamble(usage).join('\n');
    expect(preamble).toContain("import Decimal from 'decimal.js';");
    expect(preamble).toContain('function __k_decimal_div');
    expect(preamble).toContain('function __k_decimal_mod');
    expect(preamble).toContain('function __k_decimal_pow_int');
  });

  test('a comparator-only handler ALSO pulls the decimal preamble (native .eq needs the import)', () => {
    const usage = detectKernStdlibUsage(kernHandlerUsing('Decimal.eq(Decimal.of("1"), Decimal.of("1"))'));
    expect(usage.decimal).toBe(true);
  });

  test('the ops-helper text references only the imported Decimal + Error', () => {
    const helpers = decimalOpsHelpersTS();
    expect(helpers).toContain('b.isZero()');
    expect(helpers).toContain('a.isZero() && b.lt(0)');
    expect(helpers).toContain('a.isZero() && b.isZero()');
    expect(helpers).toContain('new Decimal(1)');
  });

  test('a Decimal-FREE handler does NOT flip usage.decimal (no helper leak)', () => {
    const usage = detectKernStdlibUsage(kernHandlerUsing('Math.max(a, b)'));
    expect(usage.decimal).toBeFalsy();
  });
});

// ── FIX 1 (remediation) — the canonical-context preamble pins `modulo: ROUND_DOWN`
describe('Decimal Slice 3 (remediation) — preamble pins modulo: ROUND_DOWN', () => {
  test('decimalImportLineTS pins precision + rounding + modulo', () => {
    const line = decimalImportLineTS();
    expect(line).toContain('precision: 28');
    expect(line).toContain('Decimal.ROUND_HALF_EVEN');
    // The load-bearing addition: `modulo: ROUND_DOWN` = truncated (sign-of-dividend)
    // remainder, matching Python `Decimal.__mod__`. Behaviourally a no-op today
    // (it IS decimal.js's default) — this converts a coincidence to a guarantee.
    expect(line).toContain('modulo: Decimal.ROUND_DOWN');
    expect(line).toContain(
      'Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN, modulo: Decimal.ROUND_DOWN });',
    );
  });
  test('the rendered file-level preamble carries the modulo pin', () => {
    const usage = detectKernStdlibUsage({
      type: 'fn',
      props: { name: 'f' },
      children: [
        {
          type: 'handler',
          props: { lang: 'kern' },
          children: [{ type: 'return', props: { value: 'Decimal.mod(Decimal.of("-5.5"), Decimal.of("2"))' } }],
        },
      ],
    });
    expect(kernStdlibPreamble(usage).join('\n')).toContain('modulo: Decimal.ROUND_DOWN');
  });
});

// ── FIX 2 (remediation) — SYNTACTICALLY-ZERO div/mod divisor literal fails closed
//    at COMPILE time (the early-error twin of the emitted runtime `b.isZero()` guard).
describe('Decimal Slice 3 (remediation) — compile-time literal-zero divisor fail-close', () => {
  test('Decimal.div(x, Decimal.of("0")) fails closed at compile time', () => {
    expect(() => ts('Decimal.div(Decimal.of("1"), Decimal.of("0"))')).toThrow(DECIMAL_DIV_ZERO_FAILCLOSE);
  });
  test('Decimal.mod(x, Decimal.of("0")) fails closed at compile time', () => {
    expect(() => ts('Decimal.mod(Decimal.of("1"), Decimal.of("0"))')).toThrow(DECIMAL_MOD_ZERO_FAILCLOSE);
  });
  test('a NON-zero literal divisor still ships (the compile check is a strict narrowing)', () => {
    expect(() => ts('Decimal.div(Decimal.of("1"), Decimal.of("3"))')).not.toThrow();
    expect(() => ts('Decimal.mod(Decimal.of("7"), Decimal.of("3"))')).not.toThrow();
  });
  test('a DYNAMIC (non-literal) divisor is left to the runtime guard — NOT refused here', () => {
    // `d` could be any non-zero Decimal at runtime; the compile-time check only fires
    // on a provable literal zero, so this lowers normally (runtime `b.isZero()` guards).
    expect(() => ts('Decimal.div(Decimal.of("1"), d)')).not.toThrow();
  });
});

// ── FIX 3 (remediation) — a provably-non-Decimal LITERAL operand passed to any
//    Decimal op but `of` is refused (it would silently diverge across targets).
describe('Decimal Slice 3 (remediation) — non-Decimal operand fail-close', () => {
  test('a number-literal operand is refused on comparators, arithmetic, div/mod, unary', () => {
    expect(() => ts('Decimal.eq(Decimal.of("1"), 0.1)')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.lt(Decimal.of("1"), 0.1)')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.add(Decimal.of("1"), 0.1)')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.div(Decimal.of("1"), 0.1)')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.mod(Decimal.of("1"), 0.1)')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.neg(0.1)')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
  });
  test('a number literal as the FIRST operand is also refused (would be a TS runtime TypeError)', () => {
    // `0.1.eq(...)` is invalid JS at runtime; refuse it at compile time symmetrically.
    expect(() => ts('Decimal.eq(0.1, Decimal.of("1"))')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
  });
  test('a UNARY-SIGNED number literal (-0.1) is refused (parses as unary(numLit), not a bare numLit)', () => {
    // The soundness hole: `-0.1` is `unary('-', numLit)`; the validator unwraps the
    // unary chain so a signed non-Decimal literal cannot slip the guard. DISCRIMINATING
    // assertion (not just the shared prefix): the remediation must point at
    // `Decimal.of("...")` (the SIGNED-HOST-LITERAL fix) and must NOT mislead the user
    // toward `Decimal.neg` (`Decimal.neg(0.1)` is itself invalid).
    expect(() => ts('Decimal.eq(Decimal.of("1"), -0.1)')).toThrow(/Decimal\.of\("\.\.\."\)/);
    expect(() => ts('Decimal.eq(Decimal.of("1"), -0.1)')).not.toThrow(/Decimal\.neg/);
    expect(() => ts('Decimal.add(Decimal.of("1"), -5)')).toThrow(/Decimal\.of\("\.\.\."\)/);
    expect(() => ts('Decimal.add(Decimal.of("1"), -5)')).not.toThrow(/Decimal\.neg/);
    expect(() => ts('Decimal.div(Decimal.of("1"), -0.5)')).toThrow(/Decimal\.of\("\.\.\."\)/);
    expect(() => ts('Decimal.div(Decimal.of("1"), -0.5)')).not.toThrow(/Decimal\.neg/);
  });
  test('bool / string / null literal operands are refused', () => {
    expect(() => ts('Decimal.eq(Decimal.of("1"), true)')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.eq(Decimal.of("1"), "x")')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.lt(Decimal.of("1"), null)')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
  });
  test('LEGITIMATE Decimal operands (variable / nested producer / non-zero literal) still ship', () => {
    // No typed IR yet: a variable/param/return MAY be a Decimal, so it flows through —
    // the validator rejects only provably-NON-Decimal literals, never requires proof.
    expect(() => ts('Decimal.eq(Decimal.of("1"), Decimal.of("2"))')).not.toThrow();
    expect(() => ts('Decimal.eq(d, e)')).not.toThrow();
    expect(() => ts('Decimal.add(d, Decimal.of("2"))')).not.toThrow();
    expect(() => ts('Decimal.div(Decimal.of("1"), d)')).not.toThrow();
  });
});

// ── FIX 3b (confirmation-review BLOCKER) — a UNARY-PREFIXED operand whose unwrapped
//    node is NOT a non-Decimal literal (`-Decimal.of("0")` → unwraps to a `call`) used
//    to slip the operand guard. A unary on a Decimal degrades on the TS leg only
//    (decimal.js `.valueOf()` coerces it to a host primitive BEFORE the helper runs),
//    so the prior code emitted `__k_decimal_div(new Decimal("1"), (-new Decimal("0")))`
//    — which throws a bare `TypeError` on TS but the intended KERN diagnostic on
//    Python: an asymmetric runtime divergence. The fix fail-closes ANY top-level unary
//    operand (every method but `of`), pointing users at `Decimal.neg(x)`.
describe('Decimal Slice 3 (remediation) — unary-prefixed operand fail-close', () => {
  test('THE REPRO: Decimal.div(Decimal.of("1"), -Decimal.of("0")) fails closed (was emitted before)', () => {
    expect(() => ts('Decimal.div(Decimal.of("1"), -Decimal.of("0"))')).toThrow(DECIMAL_UNARY_OPERAND_FAILCLOSE);
  });
  test('-Decimal.of("1") as a div operand and as a comparator operand both fail closed', () => {
    expect(() => ts('Decimal.div(-Decimal.of("1"), Decimal.of("2"))')).toThrow(DECIMAL_UNARY_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.eq(-Decimal.of("1"), Decimal.of("1"))')).toThrow(DECIMAL_UNARY_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.add(Decimal.of("1"), -Decimal.of("1"))')).toThrow(DECIMAL_UNARY_OPERAND_FAILCLOSE);
  });
  test('other unary operators on a Decimal producer (~, !) also fail closed', () => {
    expect(() => ts('Decimal.add(Decimal.of("1"), ~Decimal.of("1"))')).toThrow(DECIMAL_UNARY_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.eq(Decimal.of("1"), !Decimal.of("1"))')).toThrow(DECIMAL_UNARY_OPERAND_FAILCLOSE);
  });
  test('a unary on a PRODUCER (-Decimal.of("0"), -Decimal.of("1")) points at Decimal.neg(x), NOT Decimal.of("...")', () => {
    // DISCRIMINATING: the unary wraps a Decimal producer (a `call`), so `Decimal.neg(x)`
    // is the correct portable fix — and the message must NOT instead suggest wrapping
    // the operand in `Decimal.of("...")` (that advice is for a signed HOST literal).
    expect(() => ts('Decimal.div(Decimal.of("1"), -Decimal.of("0"))')).toThrow('Decimal.neg(x)');
    expect(() => ts('Decimal.div(Decimal.of("1"), -Decimal.of("0"))')).not.toThrow(/Decimal\.of\("\.\.\."\)/);
    // A comparator with a unary-on-a-producer operand is the same case.
    expect(() => ts('Decimal.eq(Decimal.of("1"), -Decimal.of("1"))')).toThrow('Decimal.neg(x)');
    expect(() => ts('Decimal.eq(Decimal.of("1"), -Decimal.of("1"))')).not.toThrow(/Decimal\.of\("\.\.\."\)/);
  });
  // NOTE: unary PLUS (`+Decimal.of("1")`) is rejected even EARLIER — the KERN parser
  // does not accept a leading `+`, so it is a parse-time error, not a validator
  // fail-close. Both are a refusal; we assert the parse-level one for completeness.
  test('unary plus (+Decimal.of("1")) is refused at PARSE time (parser rejects leading +)', () => {
    expect(() => parseExpression('+Decimal.of("1")')).toThrow();
  });
  test('REGRESSION: a unary-signed non-Decimal literal (-0.1) fails closed with the Decimal.of("...") advice (NOT Decimal.neg)', () => {
    // A signed host literal is `unary(numLit)`: it ALWAYS fails closed, but the routing
    // inspects the unary's `.argument` and points at `Decimal.of("...")` — the real fix —
    // never at the misleading `Decimal.neg(x)` (`Decimal.neg(0.1)` is itself invalid).
    expect(() => ts('Decimal.eq(Decimal.of("1"), -0.1)')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.eq(Decimal.of("1"), -0.1)')).toThrow(/Decimal\.of\("\.\.\."\)/);
    expect(() => ts('Decimal.eq(Decimal.of("1"), -0.1)')).not.toThrow(/Decimal\.neg/);
    expect(() => ts('Decimal.add(Decimal.of("1"), -5)')).toThrow(/Decimal\.of\("\.\.\."\)/);
    expect(() => ts('Decimal.add(Decimal.of("1"), -5)')).not.toThrow(/Decimal\.neg/);
    expect(() => ts('Decimal.div(Decimal.of("1"), -0.5)')).toThrow(/Decimal\.of\("\.\.\."\)/);
    expect(() => ts('Decimal.div(Decimal.of("1"), -0.5)')).not.toThrow(/Decimal\.neg/);
  });
  test('SOUND: the METHOD negation Decimal.neg(Decimal.of("1")) still works (it is a call, not a unary)', () => {
    expect(() => ts('Decimal.neg(Decimal.of("1"))')).not.toThrow();
    expect(ts('Decimal.neg(Decimal.of("1"))')).toBe('new Decimal("1").neg()');
    // And neg as a nested operand to another op flows through (a call producer).
    expect(() => ts('Decimal.add(Decimal.of("1"), Decimal.neg(Decimal.of("2")))')).not.toThrow();
  });
  test('SOUND: variables / params / nested Decimal.*(...) producers still flow through', () => {
    expect(() => ts('Decimal.div(d, e)')).not.toThrow();
    expect(() => ts('Decimal.eq(Decimal.add(Decimal.of("1"), Decimal.of("2")), Decimal.of("3"))')).not.toThrow();
  });
});

// ── FIX 3c (transparent-wrapper bypass) — the unary check and the non-Decimal-literal
//    check inspected only the operand's TOP-LEVEL IR kind, so KERN's transparent-wrapper
//    kinds `typeAssert` (`x as T`) and `nonNull` (`x!`) HID a wrapped unary or literal and
//    let it bypass BOTH checks. `(0.1 as any)` → `typeAssert(numLit)` (a cast-wrapped
//    non-Decimal literal, re-opening the silent-boolean divergence) and `(-Decimal.of("0"))!`
//    → `nonNull(unary(call))` (a non-null-wrapped degrading unary) both used to flow through.
//    The fix recursively UNWRAPS `typeAssert`/`nonNull` before both checks, so every wrapper
//    shape — incl. nested/combined (`((... as Decimal))!`) — is refused on the real inner node.
describe('Decimal Slice 3 (remediation) — transparent-wrapper (as / !) operand bypass', () => {
  test('cast-wrapped non-Decimal literal (0.1 as any) fails closed (was the re-opened FIX-3 bug)', () => {
    expect(() => ts('Decimal.eq(Decimal.of("1"), (0.1 as any))')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.add(Decimal.of("1"), (0.1 as any))')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.div(Decimal.of("1"), (true as any))')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.lt(Decimal.of("1"), ("x" as any))')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
  });
  test('nonNull-wrapped degrading unary (-Decimal.of("0"))! fails closed', () => {
    // `(-Decimal.of("0"))!` parses as nonNull(unary(call)); the `!` hid the degrading unary.
    expect(() => ts('Decimal.div(Decimal.of("1"), (-Decimal.of("0"))!)')).toThrow(DECIMAL_UNARY_OPERAND_FAILCLOSE);
    expect(() => ts('Decimal.eq(Decimal.of("1"), (~Decimal.of("1"))!)')).toThrow(DECIMAL_UNARY_OPERAND_FAILCLOSE);
  });
  test('nonNull-wrapped non-Decimal literal (0.1)! fails closed', () => {
    expect(() => ts('Decimal.eq(Decimal.of("1"), (0.1 as any)!)')).toThrow(DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
  });
  test('nested / combined wrappers (cast of cast, cast + nonNull) all fail closed on the inner shape', () => {
    expect(() => ts('Decimal.eq(Decimal.of("1"), ((0.1 as any) as any))')).toThrow(
      DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE,
    );
    expect(() => ts('Decimal.div(Decimal.of("1"), ((-Decimal.of("0") as Decimal))!)')).toThrow(
      DECIMAL_UNARY_OPERAND_FAILCLOSE,
    );
    expect(() => ts('Decimal.eq(Decimal.of("1"), (((0.1 as any))! as any))')).toThrow(
      DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE,
    );
  });
  test('the flagship repro -Decimal.of("0") as Decimal fails closed (here a TOP-LEVEL unary by precedence)', () => {
    // `(-Decimal.of("0") as Decimal)` parses as unary(typeAssert(call)) — `as` binds inside
    // the unary — so it is ALREADY a top-level unary; assert it fail-closes regardless.
    expect(() => ts('Decimal.div(Decimal.of("1"), (-Decimal.of("0") as Decimal))')).toThrow(
      DECIMAL_UNARY_OPERAND_FAILCLOSE,
    );
  });
  test('SOUND: a cast of a REAL Decimal producer still flows through and emits (no false-fire)', () => {
    expect(() => ts('Decimal.div(Decimal.of("1"), (Decimal.of("2") as Decimal))')).not.toThrow();
    expect(ts('Decimal.div(Decimal.of("1"), (Decimal.of("2") as Decimal))')).toBe(
      '__k_decimal_div(new Decimal("1"), new Decimal("2") as Decimal)',
    );
    // nonNull on a real Decimal producer, and a cast ident (may be a Decimal), also flow.
    expect(() => ts('Decimal.eq((Decimal.of("1"))!, Decimal.of("2"))')).not.toThrow();
    expect(() => ts('Decimal.eq(Decimal.of("1"), (d as Decimal))')).not.toThrow();
  });
});

// ── FIX 4 (remediation) — arity validation precedes the positional pow read, so a
//    1-arg `Decimal.pow` yields the ARITY error, NOT the misleading pow message.
describe('Decimal Slice 3 (remediation) — pow arity ordering (FIX-4 regression)', () => {
  test('Decimal.pow with ONE arg yields the arity error (not the pow-integer message)', () => {
    expect(() => ts('Decimal.pow(Decimal.of("2"))')).toThrow("Decimal.pow' takes 2 args, got 1");
    // And specifically NOT the exponent-must-be-integer message.
    expect(() => ts('Decimal.pow(Decimal.of("2"))')).not.toThrow(DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE);
  });
  test('Decimal.pow with THREE args yields the arity error too', () => {
    expect(() => ts('Decimal.pow(Decimal.of("2"), Decimal.of("3"), Decimal.of("4"))')).toThrow(
      "Decimal.pow' takes 2 args, got 3",
    );
  });
});

// ── Optional (kimi maintainability nit) — the channel-2 usage detector must stay in
//    lockstep with the KERN_STDLIB.Decimal surface, or a new method silently fails to
//    pull the decimal preamble/import (a missing-import regression).
describe('Decimal Slice 3 (remediation) — usage detector ↔ KERN_STDLIB.Decimal lockstep', () => {
  function kernHandlerUsing(expr: string): IRNode {
    return {
      type: 'fn',
      props: { name: 'f' },
      children: [{ type: 'handler', props: { lang: 'kern' }, children: [{ type: 'return', props: { value: expr } }] }],
    };
  }
  // A valid sample call for each method (2-arg ops get two operands; unary ops one;
  // `of` a string literal). Every one must flip usage.decimal.
  const sampleArgsFor = (method: string): string => {
    if (method === 'of') return '"1.5"';
    if (method === 'neg' || method === 'abs') return 'Decimal.of("1")';
    if (method === 'pow') return 'Decimal.of("2"), Decimal.of("3")';
    return 'Decimal.of("1"), Decimal.of("2")';
  };
  test.each(Object.keys(KERN_STDLIB.Decimal))(
    'Decimal.%s usage flips usage.decimal (regex in lockstep with the table)',
    (method) => {
      const usage = detectKernStdlibUsage(kernHandlerUsing(`Decimal.${method}(${sampleArgsFor(method)})`));
      expect(usage.decimal).toBe(true);
    },
  );
});
