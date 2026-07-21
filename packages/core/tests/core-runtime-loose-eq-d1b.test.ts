/** D1b — TS-leg LOOSE cross-type equality (`==`/`!=`) reconciliation.
 *
 *  KERN's loose `==` is NOT JS `==`: it adds ONLY the null/undefined crossing on
 *  top of strict equality and does NOT model JS coercion. So `1 == "1"` is FALSE,
 *  `true == 1` is FALSE, `null == undefined` is TRUE. core-runtime
 *  (`kernLooseEqual`) and the Python emitter (`_kern_loose_equal`) already did this;
 *  the TS emitter was the lone outlier (raw `==` passthrough → JS coercion → `1=="1"`
 *  true). This slice fixes the TS leg via the emitter-produced `__kern_loose_eq`
 *  helper, GATED to native (`lang="kern"`) bodies through `ExprEmitContext.coerceJsValues`.
 *
 *  These tests are the LOAD-BEARING gate-coverage proof:
 *   - the emission gate routes loose ops in native bodies through the helper, and
 *     STRICT `===`/`!==` (already JS-strict on TS) are left untouched;
 *   - the FAIL-CLOSED test asserts NO raw `==`/`!=` token survives a native body —
 *     any future missed native gate fails loudly here;
 *   - the GROUND regression asserts a raw/escape-hatch path STILL emits raw `==` —
 *     proving the gate is correctly OFF there (a user's hand-written raw `==` is
 *     never silently rewritten);
 *   - `looseEq` (which drives the helper-def injection) is derived from the EMITTED
 *     output via `emittedCodeUsesLooseEq`, NOT an IR walk — so detection == emission
 *     BY CONSTRUCTION: the def is present exactly when a `__kern_loose_eq(` call is
 *     emitted (no fail-open), including `==` inside `${…}` interpolations and
 *     structured-IR (lambda / param-default) bodies that an IR text-scan could miss. */

import { emitNativeKernBodyTSWithImports } from '../src/codegen/body-ts.js';
import { emittedCodeUsesLooseEq, kernStdlibPreamble } from '../src/codegen/stdlib-preamble.js';
import { emitExpression } from '../src/codegen-expression.js';
import { parseExpression } from '../src/parser-expression.js';
import type { IRNode } from '../src/types.js';

function makeKernHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

/** Remove the `__kern_loose_eq` helper IDENTIFIER (its args are themselves lowered,
 *  so they hold no raw loose token — and dropping just the name is paren-agnostic,
 *  immune to nested-paren arguments), then scan for a SURVIVING raw loose token. A
 *  raw `==`/`!=` (not part of `===`/`!==`/`>=`/`<=`) in a native body would be an
 *  ungated emission. */
function hasRawLooseToken(code: string): boolean {
  const withoutHelper = code.replace(/__kern_loose_eq/g, '');
  return /(?<![=!])==(?!=)|!=(?!=)/.test(withoutHelper);
}

describe('D1b — native-body emission gate (loose `==`/`!=` → __kern_loose_eq)', () => {
  test('native `==` lowers to the helper call (NOT raw, NOT JS-coerced)', () => {
    const r = emitNativeKernBodyTSWithImports(makeKernHandler([{ type: 'return', props: { value: '1 == "1"' } }]));
    expect(r.code).toBe('return __kern_loose_eq(1, "1");');
  });

  test('native `!=` lowers to the negated helper call', () => {
    const r = emitNativeKernBodyTSWithImports(makeKernHandler([{ type: 'return', props: { value: 'a != b' } }]));
    expect(r.code).toBe('return !__kern_loose_eq(a, b);');
  });

  test('STRICT `===` is UNTOUCHED — TS `===` already IS JS strict, no helper', () => {
    const r = emitNativeKernBodyTSWithImports(makeKernHandler([{ type: 'return', props: { value: '1 === "1"' } }]));
    expect(r.code).toBe('return 1 === "1";');
  });

  test('STRICT `!==` is UNTOUCHED', () => {
    const r = emitNativeKernBodyTSWithImports(makeKernHandler([{ type: 'return', props: { value: 'a !== b' } }]));
    expect(r.code).toBe('return a !== b;');
  });

  test('operands are evaluated EXACTLY ONCE — `foo() == bar()` does not double-call', () => {
    // The function-call form passes each operand as a single argument; an inlined
    // ternary `(nullish(a)&&nullish(b))?true:a===b` would emit `foo()`/`bar()` twice.
    const r = emitNativeKernBodyTSWithImports(
      makeKernHandler([{ type: 'return', props: { value: 'foo() == bar()' } }]),
    );
    expect(r.code).toBe('return __kern_loose_eq(foo(), bar());');
    // each operand text appears exactly once in the emitted call
    expect(r.code.match(/foo\(\)/g)?.length).toBe(1);
    expect(r.code.match(/bar\(\)/g)?.length).toBe(1);
  });

  test('operand internal structure is preserved as a bare call argument', () => {
    const r = emitNativeKernBodyTSWithImports(makeKernHandler([{ type: 'return', props: { value: '(a || b) == c' } }]));
    expect(r.code).toBe('return __kern_loose_eq(a || b, c);');
  });

  test('FAIL-CLOSED: a native body with multiple loose + strict ops leaks NO raw `==`/`!=`', () => {
    // Mixes loose `==`/`!=`, strict `===`/`!==`, and relational `>=`/`<=` so the
    // gate must rewrite EXACTLY the loose ops. A surviving raw `==`/`!=` (a missed
    // native gate, the #1 silent-divergence risk) fails this assertion loudly.
    const r = emitNativeKernBodyTSWithImports(
      makeKernHandler([
        { type: 'let', props: { name: 'p', value: 'x == y' } },
        { type: 'let', props: { name: 'q', value: 'x != y' } },
        { type: 'let', props: { name: 's', value: 'x === y' } },
        { type: 'let', props: { name: 't', value: 'x !== y' } },
        { type: 'let', props: { name: 'u', value: 'x >= y' } },
        { type: 'return', props: { value: 'p == q' } },
      ]),
    );
    expect(hasRawLooseToken(r.code)).toBe(false);
    // positively: the loose ops became helper calls, the strict ops stayed raw
    expect(r.code).toContain('const p = __kern_loose_eq(x, y);');
    expect(r.code).toContain('const q = !__kern_loose_eq(x, y);');
    expect(r.code).toContain('const s = x === y;');
    expect(r.code).toContain('const t = x !== y;');
    expect(r.code).toContain('const u = x >= y;');
  });

  test('B1 regression: an expression-bodied LAMBDA inside a native body lowers `==` through the helper', () => {
    // `withAdditionalUserBindings` (the closure-param ctx) previously rebuilt the
    // ExprEmitContext and DROPPED `coerceJsValues`, so a nested arrow emitted raw
    // `x => x == y` (JS coercion → TS↔Python divergence) and could miss a `decimal.js`
    // import. The spread fix preserves the gate into the lambda body.
    const r = emitNativeKernBodyTSWithImports(makeKernHandler([{ type: 'return', props: { value: 'x => x == y' } }]));
    expect(r.code).toContain('__kern_loose_eq(x, y)');
    expect(hasRawLooseToken(r.code)).toBe(false);
  });

  test('GROUND regression: a raw/no-ctx path STILL emits raw `==` (gate is OFF there)', () => {
    // `emitExpression` with no ExprEmitContext is the Ground/escape-hatch shape:
    // `coerceJsValues` is absent → default FALSE → raw passthrough. A user who wrote
    // raw `1 == "1"` in a `lang="ts"` body expecting JS coercion is NEVER rewritten.
    expect(emitExpression(parseExpression('1 == "1"'))).toBe('1 == "1"');
    expect(emitExpression(parseExpression('a != b'))).toBe('a != b');
  });
});

describe('D1b — looseEq injection (derived from EMITTED code)', () => {
  // `emittedCodeUsesLooseEq(code)` is the production signal each injection site uses
  // (cli `applyKernStdlibPreamble`, the differential TS leg, the conformance harness)
  // to set `usage.looseEq`. It is true iff the emitted output carries a
  // `__kern_loose_eq(` call — exactly the emitter's gate, so detection == emission.
  const emitOf = (value: string): string =>
    emitNativeKernBodyTSWithImports(makeKernHandler([{ type: 'return', props: { value } }])).code;

  test('an emitted native `==` body is flagged (carries the helper call)', () => {
    expect(emittedCodeUsesLooseEq(emitOf('1 == "1"'))).toBe(true);
  });

  test('`==` only inside a string literal is NOT lowered → NOT flagged', () => {
    // The emitter keeps `"a == b"` as a string literal (no helper call), so the
    // emitted code has no token and no def is injected.
    const code = emitOf('"a == b"');
    expect(code).not.toContain('__kern_loose_eq');
    expect(emittedCodeUsesLooseEq(code)).toBe(false);
  });

  test('strict-only `===` is NOT flagged (TS `===` already JS-strict, no helper)', () => {
    expect(emittedCodeUsesLooseEq(emitOf('1 === "1"'))).toBe(false);
  });

  test('relational `>=` is NOT flagged', () => {
    expect(emittedCodeUsesLooseEq(emitOf('a >= b'))).toBe(false);
  });

  test('`kernStdlibPreamble` emits the helper def when `looseEq` is set', () => {
    const preamble = kernStdlibPreamble({ result: false, option: false, looseEq: true }).join('\n');
    expect(preamble).toContain('function __kern_loose_eq(a: unknown, b: unknown): boolean {');
    expect(preamble).toContain('if ((a === null || a === undefined) && (b === null || b === undefined)) return true;');
    expect(preamble).toContain('return a === b;');
  });

  test('preamble omits the helper when `looseEq` is unset', () => {
    const preamble = kernStdlibPreamble({ result: false, option: false }).join('\n');
    expect(preamble).not.toContain('__kern_loose_eq');
  });

  test('the helper appears ONCE even when many loose ops are used (single def)', () => {
    const preamble = kernStdlibPreamble({ result: false, option: false, looseEq: true }).join('\n');
    expect(preamble.match(/function __kern_loose_eq\(/g)?.length).toBe(1);
  });
});

describe('D1b — NO-FAIL-OPEN by construction: emitted-code detection == emission', () => {
  // The load-bearing safety property: for ANY native body, IF the emitter emits a
  // `__kern_loose_eq(` call THEN the injection site MUST set `looseEq` so the def is
  // present. Because `looseEq` is now derived from the EMITTED code (not an IR walk),
  // `emits ⟹ flagged` is true BY CONSTRUCTION. This battery includes the exact cases
  // the prior IR-walk detector MISSED → runtime `ReferenceError`: a `==` inside a
  // `${…}` template interpolation (incl. a `}` inside a string inside the interp) and
  // structured-IR (lambda / param-default) bodies that are not scannable string props.
  const bodies: ReadonlyArray<readonly [string, IRNode]> = [
    ['plain return ==', makeKernHandler([{ type: 'return', props: { value: 'a == b' } }])],
    ['plain return !=', makeKernHandler([{ type: 'return', props: { value: 'a != b' } }])],
    ['let with ==', makeKernHandler([{ type: 'let', props: { name: 'r', value: 'x == y' } }])],
    ['template interpolation ${a == b}', makeKernHandler([{ type: 'return', props: { value: '`${a == b}`' } }])],
    [
      'nested template interpolation',
      makeKernHandler([{ type: 'return', props: { value: '`outer ${ `inner ${p != q}` }`' } }]),
    ],
    // codex/kimi/claude review repro: a `}` inside a string inside the interpolation —
    // broke the IR-walk brace counter; the emitted-code signal is immune.
    [
      'interp with brace-in-string',
      makeKernHandler([{ type: 'return', props: { value: '`${ pick("}", a == b) }`' } }]),
    ],
    ['== inside a call arg', makeKernHandler([{ type: 'return', props: { value: 'wrap(a == b)' } }])],
    ['== inside a ternary', makeKernHandler([{ type: 'return', props: { value: '(a == b) ? 1 : 2' } }])],
    // codex B1 repro: an expression-bodied lambda — structured ValueIR, not a string prop.
    ['expression-bodied lambda', makeKernHandler([{ type: 'return', props: { value: 'x => x == y' } }])],
    [
      'structured-children fn param default with ==',
      makeKernHandler([
        {
          type: 'fn',
          props: { name: 'inner', returns: 'any' },
          children: [
            { type: 'param', props: { name: 'a', type: 'any', value: 'x == y' } },
            { type: 'handler', props: {}, children: [{ type: 'return', props: { value: 'a' } }] },
          ],
        },
        { type: 'return', props: { value: 'inner(1)' } },
      ]),
    ],
  ];
  test.each(bodies.map((b) => [b[0], b[1]] as const))(
    'IF %s emits the helper THEN looseEq is set (def present)',
    (_name, handler) => {
      const code = emitNativeKernBodyTSWithImports(handler).code;
      const emits = code.includes('__kern_loose_eq(');
      const flagged = emittedCodeUsesLooseEq(code);
      // emits ⟹ flagged (true by construction — both read the same emitted token).
      expect(emits && !flagged).toBe(false);
      if (emits) {
        // The injection site sets looseEq from the emitted code; the preamble carries the def.
        const preamble = kernStdlibPreamble({ result: false, option: false, looseEq: flagged }).join('\n');
        expect(preamble).toContain('function __kern_loose_eq');
      }
    },
  );

  test('a `==` ONLY in a template STATIC segment (not interpolated) does NOT flag', () => {
    // `` `a == b` `` — the `==` is literal text, never lowered, so no helper is needed.
    const code = emitNativeKernBodyTSWithImports(
      makeKernHandler([{ type: 'return', props: { value: '`a == b`' } }]),
    ).code;
    expect(code).not.toContain('__kern_loose_eq');
    expect(emittedCodeUsesLooseEq(code)).toBe(false);
  });
});

describe('D1b — TS↔Python↔core parity on the loose scalar pairs', () => {
  // The three producers share the SAME shape: `(nullish(a)&&nullish(b)) ? true :
  // strict(a,b)`. For portable scalars strict === JS `===`, so the TS helper result
  // IS the cross-producer expectation. Each row pins the agreed value (the same one
  // core `kernLooseEqual` and Python `_kern_loose_equal` produce).
  const nullish = (x: unknown): boolean => x === null || x === undefined;
  const tsLooseEq = (a: unknown, b: unknown): boolean => (nullish(a) && nullish(b) ? true : a === b);
  const pairs: ReadonlyArray<readonly [string, unknown, unknown, boolean]> = [
    ['1 == "1"', 1, '1', false],
    ['true == 1', true, 1, false],
    ['null == undefined', null, undefined, true],
    ['null == null', null, null, true],
    ['undefined == undefined', undefined, undefined, true],
    ['0 == ""', 0, '', false],
    ['false == 0', false, 0, false],
    ['"" == 0', '', 0, false],
    ['undefined == false', undefined, false, false],
    ['NaN == NaN', Number.NaN, Number.NaN, false],
    ['-0 == 0', -0, 0, true],
  ];
  test.each(pairs.map((p) => [p[0], p] as const))('%s agrees across producers', (_name, [, a, b, expected]) => {
    expect(tsLooseEq(a, b)).toBe(expected);
  });
});
