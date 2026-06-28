/**
 * ReferenceRunner — array `.length` read (continues slice-2a/2b array values).
 *
 * Slice-2a bound array literals + `each`; slice-2b read an element by a literal
 * index. This slice lets the ReferenceRunner read an array's ELEMENT COUNT so a
 * program can ask how big an array is on its own runtime:
 *
 *     let xs = [1,2,3]   →   print xs.length   →   3
 *
 * Scope is the SOUND minimum, mirroring the index slice's receiver fence:
 * `.length` certifies ONLY as a NON-optional `.length` member on a BARE
 * IDENTIFIER that is bound to a portable array. The result is the array's
 * element count — a non-negative safe integer that is byte-identical on all
 * three legs: `kern run` (`arr.length`), emitted TS (`arr.length`), emitted
 * Python (`len(arr)`).
 *
 * Only ARRAYS certify. A STRING receiver ABSTAINS even though `len()` reads a
 * string too, because JS `.length` counts UTF-16 code units while Python `len()`
 * counts code points — `"😀".length` is 2 in JS, 1 in Python (verified on real
 * node + python3), so string `.length` is NOT portable. Every other receiver
 * (number / boolean / null / object / decimal / caught-error) and every
 * non-ident receiver (`[1,2,3].length`, `xs[0].length`, `xs.length.foo`),
 * optional (`xs?.length`), computed (`xs['length']`), or non-`length` member
 * (`xs.foo`) ABSTAINS.
 *
 * Reference-only change: an abstaining program is never certified and never
 * reaches the emitter differential — the emitters already lower a portable
 * array `.length` to `len(...)` (Python) / `.length` (TS), so no codegen change
 * is needed. The length VALUE is an ordinary safe integer, so it flows through
 * arithmetic / comparison / binding / print with no further hazard.
 *
 * RED-at-base: `.length` abstains today (the `member` case admits only a
 * caught-error `.message`); turns GREEN only when the runner reads array length.
 */

import { makeEnv, ReferenceRunnerError, referenceRunSequence, registerAllContracts } from '../src/index.js';
import { evalPortableValue } from '../src/ir/semantics/portable-scalar.js';
import type { IRNode } from '../src/types.js';
import type { ValueIR } from '../src/value-ir.js';

beforeAll(() => {
  registerAllContracts();
});

/** Run a sequence of body statements and return replayed stdout, as `kern run`
 *  renders it (each `{op:'stdout'}` event + "\n"). */
function runStdout(nodes: IRNode[]): string {
  const trace = referenceRunSequence(nodes, makeEnv());
  return trace.events
    .filter((e): e is { op: 'stdout'; text: string } => e.op === 'stdout')
    .map((e) => `${e.text}\n`)
    .join('');
}

function letBind(name: string, value: string): IRNode {
  return { type: 'let', props: { name, value } };
}
function print(expr: string): IRNode {
  return { type: 'print', props: { value: expr } };
}

// ── CERTIFY: `<arrayIdent>.length` reads the element count (3-leg portable) ────
describe('runner array length — element-count reads certify (3-leg portable)', () => {
  it('reads the element count of a non-empty array', () => {
    expect(runStdout([letBind('xs', '[1,2,3]'), print('xs.length')])).toBe('3\n');
  });

  it('reads 0 for an empty array (an off-by-one / undefined impl would miss)', () => {
    expect(runStdout([letBind('xs', '[]'), print('xs.length')])).toBe('0\n');
  });

  it('counts TOP-LEVEL elements of a nested array, not leaves', () => {
    // A leaf-counting impl would print 5 here; the contract is top-level cardinality.
    expect(runStdout([letBind('rows', '[[1,2],[3,4,5]]'), print('rows.length')])).toBe('2\n');
  });

  it('the length value flows into arithmetic (xs.length - 1)', () => {
    expect(runStdout([letBind('xs', '[1,2,3]'), print('xs.length - 1')])).toBe('2\n');
  });

  it('the length value binds to a scalar and reads back', () => {
    expect(runStdout([letBind('xs', '[1,2,3]'), letBind('n', 'xs.length'), print('n')])).toBe('3\n');
  });

  it('a parenthesized receiver certifies (parens strip to the bare ident)', () => {
    // `(xs).length` parses to a member on the bare ident — TS `(xs).length` and
    // Python `len(xs)` both read 3, so certifying it is sound.
    expect(runStdout([letBind('xs', '[1,2,3]'), print('(xs).length')])).toBe('3\n');
  });
});

// ── FAIL-CLOSE: every non-(array-ident `.length`) form ABSTAINS ───────────────
describe('runner array length — fail-close fences (abstain, never a value)', () => {
  const abstains = (nodes: IRNode[]) =>
    expect(() => referenceRunSequence(nodes, makeEnv())).toThrow(ReferenceRunnerError);

  it('STRING `.length` abstains (JS UTF-16 units vs Python code points)', () => {
    abstains([letBind('s', '"abc"'), print('s.length')]);
  });

  it('ASTRAL string `.length` abstains (the real divergence: JS 2 vs Python 1)', () => {
    abstains([letBind('s', '"😀"'), print('s.length')]);
  });

  it('NUMBER receiver `.length` abstains', () => {
    abstains([letBind('n', '5'), print('n.length')]);
  });

  it('BOOLEAN receiver `.length` abstains', () => {
    abstains([letBind('b', 'true'), print('b.length')]);
  });

  it('NULL receiver `.length` abstains', () => {
    abstains([letBind('n', 'null'), print('n.length')]);
  });

  it('DECIMAL (tagged-object) receiver `.length` abstains', () => {
    // A non-array, non-caught-error OBJECT receiver — distinct code path from the
    // scalar receivers above — must fail closed too.
    abstains([letBind('d', 'Decimal.of("1")'), print('d.length')]);
  });

  it('a REBOUND ident (array name later holding a scalar) abstains', () => {
    // The receiver must be an array AT READ TIME; a scalar binding fails closed.
    abstains([letBind('xs', '1'), print('xs.length')]);
  });

  it('ARRAY-LITERAL receiver `[1,2,3].length` abstains (object is not a bare ident)', () => {
    abstains([print('[1,2,3].length')]);
  });

  it('INDEX-position receiver `xs[0].length` abstains (object is an index node)', () => {
    abstains([letBind('xs', '[[1,2],[3]]'), print('xs[0].length')]);
  });

  it('CHAINED member `xs.length.foo` abstains (object is a member node)', () => {
    abstains([letBind('xs', '[1,2,3]'), print('xs.length.foo')]);
  });

  it('a NON-`length` member on an array (`xs.foo`) abstains', () => {
    abstains([letBind('xs', '[1,2,3]'), print('xs.foo')]);
  });

  it('OPTIONAL `xs?.length` abstains (outside the portable domain)', () => {
    abstains([letBind('xs', '[1,2,3]'), print('xs?.length')]);
  });

  it("COMPUTED `xs['length']` abstains (a string-literal index is not a safe-int literal)", () => {
    abstains([letBind('xs', '[1,2,3]'), print("xs['length']")]);
  });

  it('an UNBOUND ident `.length` abstains', () => {
    abstains([print('ys.length')]);
  });

  // Direct evaluator checks — pin the helper's array-vs-non-array decision.
  it('evalPortableValue returns the count for `.length` on an array binding', () => {
    const expr: ValueIR = {
      kind: 'member',
      object: { kind: 'ident', name: 'xs' },
      property: 'length',
      optional: false,
    };
    const env = makeEnv({ bindings: new Map<string, unknown>([['xs', [10, 20, 30]]]) });
    expect(evalPortableValue(expr, env)).toBe(3);
  });

  it('evalPortableValue throws on `.length` on a non-array (string) binding', () => {
    const expr: ValueIR = { kind: 'member', object: { kind: 'ident', name: 's' }, property: 'length', optional: false };
    const env = makeEnv({ bindings: new Map<string, unknown>([['s', 'abc']]) });
    expect(() => evalPortableValue(expr, env)).toThrow(/portable/);
  });
});
