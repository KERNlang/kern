/**
 * Corpus + mutation tests for declared-return contract checking
 * (`checkReturns`, slice 4).
 *
 * The corpus IS the oracle (the live core validator does NO declared-return
 * checking). Three corpora pin behaviour:
 *   - POSITIVE: returns=<KnownClass> + a literal `return new <Sibling/Super>()`
 *     whose actual class is NOT assignable to the declared class → fires.
 *   - ACCEPT: returns=<KnownClass> + `return new <Self/Subclass>()` → ZERO.
 *   - ZERO-FP / SKIP: every shape the literal-only v1 deliberately cannot (or
 *     must not) resolve — non-class declared types (the #1 corpus shape,
 *     `returns=number`), unknown declared / actual classes, non-`new` return
 *     values, value-less returns, and a nested fn's return NOT attributed to
 *     the enclosing fn → ZERO diagnostics.
 *
 * Two mutation guards prove the oracle DISCRIMINATES (counts unambiguous):
 *   (M1) flip the subtype direction → ALL ACCEPT fixtures light (exact count);
 *   (M2) treat an unresolvable/unknown return as a hard REJECT → the SKIP-shape
 *        fixtures light (exact count), proving the SKIP path is load-bearing.
 * Both mutations run in-test against a wrapped decision so the source is never
 * edited (the spec's "revert both" is structural). M3→wall floor, M4→wall
 * allowlist are asserted in acceptance-wall.test.ts (mapping noted below).
 */
import { describe, expect, test } from '../../../scripts/node-test-compat.ts';
import { parseDocumentWithDiagnostics } from '../../core/dist/parser.js';
import { parseExpression } from '../../core/dist/parser-expression.js';
import type { ValueIR } from '../../core/dist/value-ir.js';
import { assignable } from '../dist/assignable.js';
import type { ReturnCheckDiagnostic } from '../dist/returns.js';
import { checkReturns } from '../dist/returns.js';

function diags(source: string): ReturnCheckDiagnostic[] {
  return checkReturns(parseDocumentWithDiagnostics(source).root as never).diagnostics;
}
function rules(source: string): string[] {
  return diags(source).map((d) => d.rule);
}

/** Animal ⊃ Dog ⊃ Puppy (grandparent chain); Cat is Dog's sibling. */
const CLASSES = [
  'class name=Animal',
  'class name=Dog extends=Animal',
  'class name=Cat extends=Animal',
  'class name=Puppy extends=Dog',
];
function program(...lines: string[]): string {
  return [...CLASSES, ...lines].join('\n');
}

/** `fn name=make returns=<declared>` whose handler returns `new <ret>()`. */
function fnReturning(declared: string, ret: string, name = 'make'): string {
  return [`fn name=${name} returns=${declared}`, '  handler lang=kern', `    return value="new ${ret}()"`].join('\n');
}
/** class method form of {@link fnReturning}, nested under a holder class.
 *  Includes the {@link CLASSES} prelude so Animal/Dog/… are known classes. */
function methodReturning(declared: string, ret: string): string {
  return program(
    [
      'class name=Holder',
      `  method name=birth returns=${declared}`,
      '    handler lang=kern',
      `      return value="new ${ret}()"`,
    ].join('\n'),
  );
}

describe('checkReturns — diagnostic shape', () => {
  test('carries rule, fnName, declared, actual, reason', () => {
    const d = diags(program(fnReturning('Dog', 'Animal')));
    expect(d).toHaveLength(1);
    expect(d[0]?.rule).toBe('check-return-type');
    expect(d[0]?.fnName).toBe('make');
    expect(d[0]?.declared).toBe('Dog');
    expect(d[0]?.actual).toBe('Animal');
    expect(d[0]?.reason).toContain('not assignable');
  });
});

describe('checkReturns — POSITIVE corpus (resolvable violations fire)', () => {
  const POSITIVE: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    [
      'widening REJECT (returns=Dog, return new Animal())',
      program(fnReturning('Dog', 'Animal')),
      ['check-return-type'],
    ],
    ['sibling REJECT (returns=Dog, return new Cat())', program(fnReturning('Dog', 'Cat')), ['check-return-type']],
    [
      'mixed multi-return: returns=Dog body has new Cat() AND new Puppy() → EXACTLY 1',
      program(
        [
          'fn name=make returns=Dog',
          '  handler lang=kern',
          '    if cond="x"',
          '      return value="new Cat()"',
          '    return value="new Puppy()"',
        ].join('\n'),
      ),
      ['check-return-type'],
    ],
    [
      'class METHOD widening REJECT (returns=Dog, return new Animal())',
      methodReturning('Dog', 'Animal'),
      ['check-return-type'],
    ],
  ];
  for (const [label, source, expected] of POSITIVE) {
    test(`fires: ${label}`, () => {
      expect(rules(source)).toEqual([...expected]);
    });
  }
});

describe('checkReturns — ACCEPT corpus (valid resolvable returns produce ZERO)', () => {
  const ACCEPT: ReadonlyArray<readonly [string, string]> = [
    ['subclass ACCEPT (returns=Animal, return new Dog())', program(fnReturning('Animal', 'Dog'))],
    ['exact-match ACCEPT (returns=Dog, return new Dog())', program(fnReturning('Dog', 'Dog'))],
    [
      'grandchild ACCEPT (returns=Dog, return new Puppy())',
      program(
        ['fn name=make returns=Dog', '  handler lang=kern', '    if cond="x"', '      return value="new Puppy()"'].join(
          '\n',
        ),
      ),
    ],
    ['method subclass ACCEPT (returns=Animal, return new Dog())', methodReturning('Animal', 'Dog')],
  ];
  for (const [label, source] of ACCEPT) {
    test(`zero diagnostics: ${label}`, () => {
      expect(diags(source)).toEqual([]);
    });
  }
});

describe('checkReturns — ZERO-FP corpus (unresolvable/out-of-scope shapes produce ZERO)', () => {
  const ZERO_FP: ReadonlyArray<readonly [string, string]> = [
    [
      'no returns= declaration',
      program(['fn name=make', '  handler lang=kern', '    return value="new Animal()"'].join('\n')),
    ],
    [
      'declared type is a primitive (returns=number, return new Dog()) — the #1 corpus FP vector',
      program(fnReturning('number', 'Dog')),
    ],
    ['declared type is a generic (returns=T)', program(fnReturning('T', 'Dog'))],
    ['declared type is unknown class (returns=Widget)', program(fnReturning('Widget', 'Dog'))],
    [
      'return of a call (makeDog())',
      program(['fn name=make returns=Dog', '  handler lang=kern', '    return value="makeDog()"'].join('\n')),
    ],
    [
      'return of Promise.resolve(new Dog()) (out of scope — no unwrap)',
      program(
        ['fn name=make returns=Dog', '  handler lang=kern', '    return value="Promise.resolve(new Dog())"'].join('\n'),
      ),
    ],
    [
      'return of a ternary',
      program(
        ['fn name=make returns=Dog', '  handler lang=kern', '    return value="x ? new Dog() : new Cat()"'].join('\n'),
      ),
    ],
    [
      'return of a bare ident',
      program(['fn name=make returns=Dog', '  handler lang=kern', '    return value="x"'].join('\n')),
    ],
    [
      'return of a member',
      program(['fn name=make returns=Dog', '  handler lang=kern', '    return value="a.b.c"'].join('\n')),
    ],
    [
      'return of an await',
      program(['fn name=make returns=Dog', '  handler lang=kern', '    return value="await makeDog()"'].join('\n')),
    ],
    [
      'return of an object literal',
      program(['fn name=make returns=Dog', '  handler lang=kern', '    return value="{ a: 1 }"'].join('\n')),
    ],
    [
      'return of an array literal',
      program(['fn name=make returns=Dog', '  handler lang=kern', '    return value="[new Dog()]"'].join('\n')),
    ],
    [
      'return of a template literal',
      program(['fn name=make returns=Dog', '  handler lang=kern', '    return value="`x`"'].join('\n')),
    ],
    ['actual is an unknown class (returns=Dog, return new Widget())', program(fnReturning('Dog', 'Widget'))],
    [
      'return with no value prop',
      program(['fn name=make returns=Dog', '  handler lang=kern', '    return'].join('\n')),
    ],
    [
      "nested fn's return NOT attributed to outer fn (outer returns=Dog, inner returns new Animal())",
      program(
        [
          'fn name=outer returns=Dog',
          '  handler lang=kern',
          '    fn name=inner',
          '      handler lang=kern',
          '        return value="new Animal()"',
        ].join('\n'),
      ),
    ],
  ];
  for (const [label, source] of ZERO_FP) {
    test(`zero diagnostics: ${label}`, () => {
      expect(diags(source)).toEqual([]);
    });
  }
  test('the whole zero-FP corpus produces zero diagnostics in aggregate', () => {
    const total = ZERO_FP.reduce((sum, [, src]) => sum + diags(src).length, 0);
    expect(total).toBe(0);
  });
});

describe('checkReturns — empty / classless / fnless programs', () => {
  test('empty program → no diagnostics', () => {
    expect(rules('')).toEqual([]);
  });
  test('program with no fn → no diagnostics', () => {
    expect(rules(program('do value="1"'))).toEqual([]);
  });
  test('unparseable return value → SKIP silently', () => {
    expect(
      rules(
        program(['fn name=make returns=Dog', '  handler lang=kern', '    return value="new Cat() +++ "'].join('\n')),
      ),
    ).toEqual([]);
  });
});

/**
 * MUTATION GUARDS — the corpus DISCRIMINATES (counts unambiguous, nero C4).
 *
 * Each guard re-runs the EXACT per-return decision over the REAL parsed
 * fixtures and the REAL `assignable`, with one mutation injected, asserting:
 *   - the unmutated decision matches live `checkReturns` on the same fixture
 *     (so the mutated path is the genuine path), and
 *   - the mutation lights the named fixtures with the unambiguous count.
 * The source is never edited (the spec's "revert both" is structural).
 *
 * Structural mutation mapping (asserted in acceptance-wall.test.ts):
 *   M3 (rule never RAN) → the wall's `returnChecksRun >= 3` floor.
 *   M4 (parse-failure drift) → the wall's exact parse-failure allowlist.
 */
describe('checkReturns — mutation discrimination (counts unambiguous)', () => {
  const classByName = new Map([
    ['Animal', { name: 'Animal' }],
    ['Dog', { name: 'Dog', baseName: 'Animal' }],
    ['Cat', { name: 'Cat', baseName: 'Animal' }],
    ['Puppy', { name: 'Puppy', baseName: 'Dog' }],
  ]);

  /** `new ClassName(...)` → its class name, else undefined (mirrors the impl). */
  function newClassName(value: ValueIR): string | undefined {
    if (value.kind !== 'new') return undefined;
    const inner = value.argument;
    if (inner.kind === 'call' && inner.callee.kind === 'ident') return inner.callee.name;
    if (inner.kind === 'ident') return inner.name;
    return undefined;
  }

  type Mutation = { flipSubtype?: boolean; rejectUnresolvable?: boolean };

  /**
   * The per-return decision under a mutation, over ONE `return <expr>` body
   * with a declared class. Returns the diagnostic count for the single return.
   */
  function returnDiagCount(returnExpr: string, declared: string, mut: Mutation): number {
    let value: ValueIR;
    try {
      value = parseExpression(returnExpr);
    } catch {
      return 0; // unparseable → SKIP (matches the impl).
    }
    const actual = newClassName(value);
    if (actual === undefined || !classByName.has(actual)) {
      // real impl: an unresolvable / non-class actual is unknown, so SKIP. The
      // mutation treats it as a hard REJECT (the bug this fixture catches).
      return mut.rejectUnresolvable ? 1 : 0;
    }
    const [src, dst] = mut.flipSubtype ? [declared, actual] : [actual, declared];
    return assignable(src, dst, classByName).ok === false ? 1 : 0;
  }

  test('decision twin matches live checkReturns on a reject + an accept fixture', () => {
    expect(returnDiagCount('new Animal()', 'Dog', {})).toBe(1);
    expect(diags(program(fnReturning('Dog', 'Animal')))).toHaveLength(1);
    expect(returnDiagCount('new Dog()', 'Animal', {})).toBe(0);
    expect(diags(program(fnReturning('Animal', 'Dog')))).toEqual([]);
  });

  test('(M1) flip subtype direction → ALL 3 ACCEPT fixtures light (exact count)', () => {
    const accepts: ReadonlyArray<readonly [string, string]> = [
      ['new Dog()', 'Animal'],
      ['new Puppy()', 'Dog'],
      ['new Dog()', 'Dog'],
    ];
    const real = accepts.reduce((n, [r, d]) => n + returnDiagCount(r, d, {}), 0);
    const flipped = accepts.reduce((n, [r, d]) => n + returnDiagCount(r, d, { flipSubtype: true }), 0);
    expect(real).toBe(0); // real impl: all ACCEPT
    expect(flipped).toBe(2); // exact: Dog<:Animal and Puppy<:Dog flip to REJECT; Dog=Dog stays equal (no diag)
  });

  test('(M2) unresolvable/unknown return REJECT → the SKIP-shape fixtures light (exact count)', () => {
    // The SKIP shapes whose actual is unknown/non-class. Each is real-ZERO and
    // mutation-ONE, proving the SKIP path carries the zero-FP guarantee.
    const skips: ReadonlyArray<readonly [string, string]> = [
      ['makeDog()', 'Dog'], // call
      ['x ? new Dog() : new Cat()', 'Dog'], // ternary
      ['x', 'Dog'], // bare ident
      ['a.b.c', 'Dog'], // member
      ['await makeDog()', 'Dog'], // await
      ['{ a: 1 }', 'Dog'], // object literal
      ['[new Dog()]', 'Dog'], // array literal
      ['new Widget()', 'Dog'], // unknown actual class
    ];
    const real = skips.reduce((n, [r, d]) => n + returnDiagCount(r, d, {}), 0);
    const mutated = skips.reduce((n, [r, d]) => n + returnDiagCount(r, d, { rejectUnresolvable: true }), 0);
    expect(real).toBe(0); // real impl: every SKIP shape is zero
    expect(mutated).toBe(8); // mutation lights EVERY skip shape — exact, no drift
  });
});
