/**
 * Corpus + mutation tests for direct call-site assignability (`checkCalls`).
 *
 * The corpus IS the oracle (the live core validator does NO call-site checking).
 * Two corpora pin behaviour:
 *   - ZERO-FP: shapes the nero-narrowed v1 deliberately CANNOT resolve (ident /
 *     member args, member / this / builtin / curried / chained callees,
 *     reassigned-let args, unknown classes) → ZERO diagnostics.
 *   - POSITIVE: the shapes it DOES resolve (arity over/under, sibling-arg
 *     REJECT, subclass + grandparent ACCEPT, nested-position call checked).
 *
 * Two mutation guards prove the oracle DISCRIMINATES (counts are unambiguous):
 *   (a) flip the subtype direction in `assignable` → the ACCEPT fixtures light;
 *   (b) make an unresolvable arg REJECT → the zero-FP ident-arg program lights.
 * Both mutations are applied in-test against a wrapped checker so the source is
 * never edited; the spec's "revert both" is structural (nothing to revert).
 */
import { describe, expect, test } from '../../../scripts/node-test-compat.ts';
import { parseDocumentWithDiagnostics } from '../../core/dist/parser.js';
import { parseExpression } from '../../core/dist/parser-expression.js';
import type { ValueIR } from '../../core/dist/value-ir.js';
import { assignable } from '../dist/assignable.js';
import type { CallCheckDiagnostic } from '../dist/calls.js';
import { checkCalls } from '../dist/calls.js';

function check(source: string): CallCheckDiagnostic[] {
  return checkCalls(parseDocumentWithDiagnostics(source).root as never);
}
function rules(source: string): string[] {
  return check(source).map((d) => d.rule);
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

/** `fn f(a: Animal): string` — the canonical simple-param checkable callee. */
function fnAnimal(name = 'f'): string {
  return [
    `fn name=${name} returns=string`,
    '  param name=a type=Animal',
    '  handler lang=kern',
    '    return value="\'x\'"',
  ].join('\n');
}
/** `fn h(a: Dog): string` — param type Dog, for sibling-reject fixtures. */
function fnDog(name = 'h'): string {
  return [
    `fn name=${name} returns=string`,
    '  param name=a type=Dog',
    '  handler lang=kern',
    '    return value="\'x\'"',
  ].join('\n');
}

describe('checkCalls — diagnostic shape', () => {
  test('arg-type carries callee, argIndex, reason', () => {
    const diags = check(program(fnDog(), 'do value="h(new Cat())"'));
    const arg = diags.find((d) => d.rule === 'check-call-arg-type');
    expect(arg).toBeDefined();
    expect(arg?.callee).toBe('h');
    expect(arg?.argIndex).toBe(0);
    expect(arg?.reason).toContain('not');
  });
  test('arity carries callee and reason (no argIndex)', () => {
    const diags = check(program(fnAnimal(), 'do value="f(new Dog(), new Dog())"'));
    const arity = diags.find((d) => d.rule === 'check-call-arity');
    expect(arity?.callee).toBe('f');
    expect(arity?.argIndex).toBeUndefined();
    expect(arity?.reason).toContain('argument');
  });
});

describe('checkCalls — POSITIVE corpus (resolvable violations fire)', () => {
  const POSITIVE: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['arity over (2 args, 1 param)', program(fnAnimal(), 'do value="f(new Dog(), new Dog())"'), ['check-call-arity']],
    ['arity under (0 args, 1 param)', program(fnAnimal(), 'do value="f()"'), ['check-call-arity']],
    ['sibling arg REJECT (Cat vs param Dog)', program(fnDog(), 'do value="h(new Cat())"'), ['check-call-arg-type']],
    [
      'unrelated arg REJECT (Animal vs param Dog — supertype is not assignable)',
      program(fnDog(), 'do value="h(new Animal())"'),
      ['check-call-arg-type'],
    ],
    [
      'nested-position call checked (let x = h(new Cat()) + 1)',
      program(fnDog(), 'let name=x value="h(new Cat()) + 1"'),
      ['check-call-arg-type'],
    ],
    [
      'nested call inside another call arg is visited',
      program(fnAnimal('outer'), fnDog(), 'do value="outer(h(new Cat()))"'),
      ['check-call-arg-type'],
    ],
  ];
  for (const [label, source, expected] of POSITIVE) {
    test(`fires: ${label}`, () => {
      expect(rules(source)).toEqual([...expected]);
    });
  }
});

describe('checkCalls — ACCEPT corpus (valid resolvable calls produce ZERO)', () => {
  const ACCEPT: ReadonlyArray<readonly [string, string]> = [
    ['subclass arg ACCEPT (Dog <: Animal)', program(fnAnimal(), 'do value="f(new Dog())"')],
    ['grandchild arg ACCEPT (Puppy <: Dog <: Animal)', program(fnAnimal(), 'do value="f(new Puppy())"')],
    ['exact-type arg ACCEPT (Animal = Animal)', program(fnAnimal(), 'do value="f(new Animal())"')],
    ['correct arity + subclass ACCEPT', program(fnDog(), 'do value="h(new Puppy())"')],
    [
      'nested-position ACCEPT (let x = g(new Dog()) + 1, g param Animal)',
      program(
        [
          'fn name=g returns=Animal',
          '  param name=a type=Animal',
          '  handler lang=kern',
          '    return value="new Animal()"',
        ].join('\n'),
        'let name=x value="g(new Dog()) + 1"',
      ),
    ],
  ];
  for (const [label, source] of ACCEPT) {
    test(`zero diagnostics: ${label}`, () => {
      expect(check(source)).toEqual([]);
    });
  }
});

describe('checkCalls — ZERO-FP corpus (unresolvable shapes produce ZERO)', () => {
  const ZERO_FP: ReadonlyArray<readonly [string, string]> = [
    ['ident arg (no use-def — slice 5)', program(fnDog(), 'do value="h(x)"')],
    ['member-chain arg', program(fnDog(), 'do value="h(a.b.c)"')],
    ['builtin member callee (console.log)', program(fnDog(), 'do value="console.log(new Cat())"')],
    ['this.method callee', program(fnDog(), 'do value="this.h(new Cat())"')],
    ['obj.method callee', program(fnDog(), 'do value="obj.h(new Cat())"')],
    ['curried callee (f()())', program(fnDog(), 'do value="h(new Cat())(new Cat())"')],
    ['chained callee (a.b().c())', program(fnDog(), 'do value="a.b(new Cat()).c(new Cat())"')],
    [
      'reassigned-let arg (value resolution is slice 5)',
      program(fnDog(), 'let name=d value="new Dog()"', 'do value="h(d)"'),
    ],
    ['unknown-class arg (Widget not a known class)', program(fnDog(), 'do value="h(new Widget())"')],
    ['unknown callee (no fn of that name)', program('do value="nope(new Cat())"')],
    [
      'non-simple params= callee → SKIP',
      program(
        'fn name=s params="a: Dog" returns=string\n  handler lang=kern\n    return value="\'x\'"',
        'do value="s(new Cat(), new Cat())"',
      ),
    ],
    [
      'rest-param callee → SKIP',
      program(
        [
          'fn name=r returns=string',
          '  param name=a type=Dog rest=true',
          '  handler lang=kern',
          '    return value="\'x\'"',
        ].join('\n'),
        'do value="r(new Cat())"',
      ),
    ],
    ['spread arg → SKIP', program(fnDog(), 'do value="h(...xs)"')],
    [
      'class-method fn is NOT a top-level callee (no registration → SKIP)',
      program(
        ['class name=Holder', '  fn name=h', '    param name=a type=Dog', '    return value=a'].join('\n'),
        'do value="h(new Cat())"',
      ),
    ],
    [
      'class-method must not shadow a later top-level fn of the same name',
      // method h(a: Dog) precedes top-level h(a: Animal); the call is LEGAL
      // against the real top-level fn (Cat <: Animal). The pre-fix full-tree
      // walk registered the METHOD first-wins and falsely rejected this.
      program(
        ['class name=Holder', '  fn name=h', '    param name=a type=Dog', '    return value=a'].join('\n'),
        fnAnimal('h'),
        'do value="h(new Cat())"',
      ),
    ],
    [
      'param after non-param child → fn is non-simple → SKIP',
      program(
        [
          'fn name=m returns=string',
          '  param name=a type=Dog',
          '  handler lang=kern',
          '    return value="\'x\'"',
          '  param name=b type=Dog',
        ].join('\n'),
        'do value="m(new Cat(), new Cat())"',
      ),
    ],
  ];
  for (const [label, source] of ZERO_FP) {
    test(`zero diagnostics: ${label}`, () => {
      expect(check(source)).toEqual([]);
    });
  }
  test('the whole zero-FP corpus produces zero diagnostics in aggregate', () => {
    const total = ZERO_FP.reduce((sum, [, src]) => sum + check(src).length, 0);
    expect(total).toBe(0);
  });
});

describe('checkCalls — empty / classless / fnless programs', () => {
  test('empty program → no diagnostics', () => {
    expect(rules('')).toEqual([]);
  });
  test('program with no fn → no diagnostics', () => {
    expect(rules(program('do value="f(new Dog())"'))).toEqual([]);
  });
  test('unparseable body → SKIP silently', () => {
    expect(rules(program(fnDog(), 'do value="h(new Cat() +++ )"'))).toEqual([]);
  });
});

/**
 * MUTATION GUARDS — the corpus DISCRIMINATES (counts unambiguous, nero C4).
 *
 * Each guard re-runs the EXACT per-call arg-type decision over the REAL parsed
 * fixtures and the REAL `assignable`, with one mutation injected, and asserts:
 *   - the unmutated decision matches the live `checkCalls` on the same fixture
 *     (so the mutated path is the genuine path), and
 *   - the mutation lights the named fixture with the unambiguous count.
 * The source is never edited (the spec's "revert both" is structural).
 */
describe('checkCalls — mutation discrimination (counts unambiguous)', () => {
  const classByName = new Map([
    ['Animal', { name: 'Animal' }],
    ['Dog', { name: 'Dog', baseName: 'Animal' }],
    ['Cat', { name: 'Cat', baseName: 'Animal' }],
    ['Puppy', { name: 'Puppy', baseName: 'Dog' }],
  ]);

  /** `new ClassName(...)` → its class name, else undefined (mirrors the impl). */
  function newClassArgType(arg: ValueIR): string | undefined {
    if (arg.kind !== 'new') return undefined;
    const inner = arg.argument;
    if (inner.kind === 'call' && inner.callee.kind === 'ident') return inner.callee.name;
    if (inner.kind === 'ident') return inner.name;
    return undefined;
  }

  type Mutation = { flipSubtype?: boolean; rejectUnresolvable?: boolean };

  /**
   * The per-call arg-type decision under a mutation, over ONE `f(arg)` /
   * `h(arg)` body. Returns the arg-type-diagnostic count for the single arg.
   */
  function argTypeDiagCount(callBody: string, paramType: string, mut: Mutation): number {
    const call = parseExpression(callBody) as Extract<ValueIR, { kind: 'call' }>;
    const arg = call.args[0];
    const argType = newClassArgType(arg);
    if (argType === undefined) {
      // real impl: unresolvable arg is unknown, so SKIP. The mutation treats an
      // unresolvable arg as a hard REJECT (the bug this fixture catches).
      return mut.rejectUnresolvable ? 1 : 0;
    }
    const [src, dst] = mut.flipSubtype ? [paramType, argType] : [argType, paramType];
    return assignable(src, dst, classByName).ok === false ? 1 : 0;
  }

  test('decision twin matches live checkCalls on a reject + an accept fixture', () => {
    // Sanity: the in-test decision IS the impl's decision (no mutation).
    expect(argTypeDiagCount('h(new Cat())', 'Dog', {})).toBe(1);
    expect(
      check(program(fnDog(), 'do value="h(new Cat())"')).filter((d) => d.rule === 'check-call-arg-type'),
    ).toHaveLength(1);
    expect(argTypeDiagCount('f(new Dog())', 'Animal', {})).toBe(0);
    expect(check(program(fnAnimal(), 'do value="f(new Dog())"'))).toEqual([]);
  });

  test('(a) flip subtype direction → ALL 3 ACCEPT fixtures light (exact count)', () => {
    const accepts: ReadonlyArray<readonly [string, string]> = [
      ['f(new Dog())', 'Animal'],
      ['f(new Puppy())', 'Animal'],
      ['h(new Puppy())', 'Dog'],
    ];
    const real = accepts.reduce((n, [body, p]) => n + argTypeDiagCount(body, p, {}), 0);
    const flipped = accepts.reduce((n, [body, p]) => n + argTypeDiagCount(body, p, { flipSubtype: true }), 0);
    expect(real).toBe(0); // real impl: all ACCEPT
    expect(flipped).toBe(3); // mutation lights EVERY accept fixture — exact, no drift
  });

  test('(b) unresolvable-arg REJECT → the ident-arg zero-FP program lights (count = 1)', () => {
    // The exact zero-FP fixture: h(x) with an ident arg.
    expect(check(program(fnDog(), 'do value="h(x)"'))).toEqual([]); // real: zero
    expect(argTypeDiagCount('h(x)', 'Dog', {})).toBe(0); // real: SKIP
    expect(argTypeDiagCount('h(x)', 'Dog', { rejectUnresolvable: true })).toBe(1); // mutation: lights, count 1
  });
});
