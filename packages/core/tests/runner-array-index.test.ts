/**
 * ReferenceRunner — array INDEX read `xs[i]` (slice-2b, continues slice-2a).
 *
 * Slice-2a bound array literals + `each` iteration. This slice lets the
 * ReferenceRunner READ a single element by a LITERAL index so a program can
 * address elements natively on its own runtime:
 *
 *     let xs = [10,20,30]   →   print xs[0]   →   10
 *
 * Scope is deliberately the SOUND minimum: the index must be a BARE non-negative
 * safe-integer DECIMAL literal. That is the only index form provably
 * byte-identical across `kern run`, emitted TS, and emitted Python — every other
 * form has a TS↔Python divergence verified on real node + python3:
 *   - out-of-bounds → TS `undefined` vs Py IndexError                  (ABSTAIN)
 *   - NEGATIVE      → TS `undefined` vs Py wraps to the LAST element    (ABSTAIN)
 *   - FLOAT literal / DIVISION → Python list indices must be int; `xs[1.0]`,
 *     `xs[4/2]` raise TypeError while JS reads `xs[1]`                  (ABSTAIN)
 *   - integer `%` with a negative operand → `5 % -3` is 2 in JS, -1 in Python,
 *     and `+`/`-`/`*` over safe literals can overflow 2^53 and round in JS while
 *     Python stays exact — so ARITHMETIC indices                       (ABSTAIN)
 *   - UNSAFE integer literal (`9007199254740993`) → JS rounds, Python exact,
 *     and LEADING-ZERO literal (`05`) → SyntaxError on both targets     (ABSTAIN)
 *   - IDENT / nested index-read → can hold/resolve to a Python float    (ABSTAIN)
 *
 * JS has no int/float distinction and the emitters preserve the SOURCE numeric
 * form, so the reference cannot tell a Python int from a Python float by VALUE —
 * hence the SYNTACTIC literal gate. Dynamic / computed indexing is a follow-up
 * that must prove exact integer arithmetic (e.g. BigInt-checked) or carry integer
 * provenance. The object is restricted to an array-binding identifier, so
 * OBJECT-position nesting (`xs[0][1]`) and string index (`s[0]`) abstain; an
 * array-valued element is not a portable scalar, so it abstains too.
 *
 * Reference-only change: an abstaining program is never certified and never
 * reaches the emitter differential — no core-runtime or codegen change is needed.
 *
 * RED-at-base: in-bounds index abstains today (the scalar evaluator has no
 * `index` case); turns GREEN only when the runner reads an in-bounds element.
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

function letArr(name: string, value: string): IRNode {
  return { type: 'let', props: { name, value } };
}
function letScalar(name: string, value: string): IRNode {
  return { type: 'let', props: { name, value } };
}
function print(expr: string): IRNode {
  return { type: 'print', props: { value: expr } };
}
/** `for name=i from=<from> to=<to>` (to EXCLUSIVE) with the given body. */
function forLoop(name: string, from: string, to: string, child: IRNode): IRNode {
  return { type: 'for', props: { name, from, to }, children: [child] };
}

// ── CERTIFY: in-bounds bare safe-integer literal index reads a portable scalar ─
describe('runner array index — in-bounds literal reads certify (3-leg portable)', () => {
  it('reads the FIRST element by literal index 0', () => {
    expect(runStdout([letArr('xs', '[10,20,30]'), print('xs[0]')])).toBe('10\n');
  });

  it('reads the LAST in-bounds element (pins the upper edge; off-by-one would miss)', () => {
    expect(runStdout([letArr('xs', '[10,20,30]'), print('xs[2]')])).toBe('30\n');
  });

  it('reads a middle element distinctly (not first, not last)', () => {
    expect(runStdout([letArr('xs', '[10,20,30]'), print('xs[1]')])).toBe('20\n');
  });

  it('a string element with an embedded comma stays one whole element', () => {
    // A join/flatten impl would corrupt this; index must return the exact string.
    expect(runStdout([letArr('xs', '["a","b,c"]'), print('xs[1]')])).toBe('b,c\n');
  });

  it('a boolean element prints canonical lowercase', () => {
    expect(runStdout([letArr('xs', '[true,false]'), print('xs[1]')])).toBe('false\n');
  });

  // Milestone 5.1b — `+`/`-` arithmetic between provenanced operands (here: two
  // bare safe-integer literals) is now admitted (see `isIntProvenancedExpr` in
  // portable-scalar.ts for the exact-IEEE-754 no-divergence argument). This
  // moves the fixture that used to assert "ARITHMETIC (+) index abstains" —
  // literal+literal arithmetic is strictly safer than counter+literal, so it
  // certifies too.
  it('ARITHMETIC (+) between two literals now certifies: `xs[1 + 1]`', () => {
    expect(runStdout([letArr('xs', '[10,20,30]'), print('xs[1 + 1]')])).toBe('30\n');
  });

  it('ARITHMETIC (-) between two literals now certifies: `xs[2 - 1]`', () => {
    expect(runStdout([letArr('xs', '[10,20,30]'), print('xs[2 - 1]')])).toBe('20\n');
  });

  it('ARITHMETIC on a for-loop counter now certifies: `xs[i + 1]`', () => {
    // The task headline capability — a loop counter plus a literal offset.
    expect(
      runStdout([letArr('xs', '[10,20,30]'), forLoop('i', '0', '2', print('xs[i + 1]'))]),
    ).toBe('20\n30\n');
  });

  it('a null element prints "null"', () => {
    expect(runStdout([letArr('xs', '[1,null,3]'), print('xs[1]')])).toBe('null\n');
  });
});

// ── FAIL-CLOSE: every non-(bare-safe-integer-literal) index ABSTAINS ──────────
describe('runner array index — fail-close fences (abstain, never a value)', () => {
  const abstains = (nodes: IRNode[]) =>
    expect(() => referenceRunSequence(nodes, makeEnv())).toThrow(ReferenceRunnerError);

  it('OUT-OF-BOUNDS index (== length) abstains (TS undefined vs Py IndexError)', () => {
    abstains([letArr('xs', '[1,2,3]'), print('xs[3]')]);
  });

  it('OUT-OF-BOUNDS index (> length) abstains', () => {
    abstains([letArr('xs', '[1,2,3]'), print('xs[5]')]);
  });

  it('NEGATIVE literal index abstains (TS undefined vs Py wraps to last element)', () => {
    // An impl mirroring Python would print "3" here.
    abstains([letArr('xs', '[1,2,3]'), print('xs[-1]')]);
  });

  it('FLOAT-literal index abstains (Python list indices must be int — TypeError)', () => {
    // ref + TS read xs[1] (1.0 === 1) but Python `xs[1.0]` raises. Verified 3-leg.
    abstains([letArr('xs', '[10,20,30]'), print('xs[1.0]')]);
  });

  it('NON-INTEGER float index abstains (1.5)', () => {
    abstains([letArr('xs', '[1,2,3]'), print('xs[1.5]')]);
  });

  it('INT-VALUED float element abstains before an index read can certify it', () => {
    abstains([letArr('xs', '[1.0]'), print('xs[0]')]);
  });

  it('NON-INTEGER float element abstains before an index read can certify it', () => {
    abstains([letArr('xs', '[1.5]'), print('xs[0]')]);
  });

  it('DIVISION index abstains even when in-bounds-valued (Python `/` is float)', () => {
    // 4 / 2 == 2.0 in Python -> `xs[2.0]` TypeError, while ref + TS read xs[2].
    abstains([letArr('xs', '[10,20,30]'), print('xs[4 / 2]')]);
  });

  it('NEGATIVE-MODULO index abstains (JS `5 % -3` is 2, Python is -1 — divergent)', () => {
    // `%` over a negative operand diverges by sign; the bare-literal gate excludes it.
    abstains([letArr('xs', '[10,20,30]'), print('xs[5 % (0 - 3)]')]);
  });

  it('UNSAFE-integer literal index abstains (JS rounds it, Python keeps precision)', () => {
    abstains([letArr('xs', '[1,2,3]'), print('xs[9007199254740993]')]);
  });

  it('UNSAFE-integer element abstains before an index read can surface the rounded JS value', () => {
    abstains([letArr('xs', '[9007199254740993]'), print('xs[0]')]);
  });

  it('UNSAFE-integer arithmetic index abstains (rounds to 0 in JS, exact 1 in Python)', () => {
    // The literal gate excludes arithmetic, so this divergent computation never certifies.
    abstains([letArr('xs', '[1,2,3]'), print('xs[9007199254740993 - 9007199254740992]')]);
  });

  it('LEADING-ZERO literal index abstains (octal-style `05` is a SyntaxError on both targets)', () => {
    abstains([letArr('xs', '[10,20,30]'), print('xs[05]')]);
  });

  it('a plain LET-bound (non-counter) ident index abstains (could be a Python float)', () => {
    // Even in-bounds: a plain `let` binding can hold a Python float the reference
    // cannot rule out by value -> abstain. A for-COUNTER now certifies via
    // integer-provenance (see runner-dynamic-index.test.ts); a plain let does not.
    abstains([letArr('xs', '[5,6,7]'), letScalar('j', '2'), print('xs[j]')]);
  });

  it('MULTIPLICATION index still abstains (`*` is excluded from isIntProvenancedExpr)', () => {
    // 1 * 2 = 2 is in-bounds, but `*` stays out of the provenanced-arithmetic
    // domain (milestone 5.1b only admits +/-; see isIntProvenancedExpr's doc).
    abstains([letArr('xs', '[10,20,30]'), print('xs[1 * 2]')]);
  });

  it('DIVISION arithmetic index still abstains (`/` is excluded)', () => {
    abstains([letArr('xs', '[10,20,30]'), print('xs[4 / 2]')]);
  });

  it('OUT-OF-BOUNDS arithmetic index abstains atomically: `xs[1 + 5]`', () => {
    // Milestone 5.1b admits the arithmetic FORM; the existing safe-integer +
    // bounds check on the evaluated result still fences an out-of-range value.
    abstains([letArr('xs', '[10,20,30]'), print('xs[1 + 5]')]);
  });

  it('INDEX-POSITION nesting `xs[ys[0]]` abstains (a nested index is not a literal)', () => {
    abstains([letArr('ys', '[0]'), letArr('xs', '[1,2,3]'), print('xs[ys[0]]')]);
  });

  it('STRING index abstains (deferred — same OOB/negative divergence as arrays)', () => {
    abstains([letScalar('s', '"abc"'), print('s[0]')]);
  });

  it('OPTIONAL index `xs?.[0]` abstains (outside the portable domain)', () => {
    abstains([letArr('xs', '[1,2,3]'), print('xs?.[0]')]);
  });

  it('an index whose ELEMENT is a nested array abstains (deferred — scalar reads only)', () => {
    // rows[0] is [1,2] — an array, not a portable scalar -> abstain.
    abstains([letArr('rows', '[[1,2],[3]]'), print('rows[0]')]);
  });

  it('OBJECT-POSITION nesting `xs[0][1]` abstains (object is not an array-binding ident)', () => {
    abstains([letArr('xs', '[[1,2]]'), print('xs[0][1]')]);
  });

  it('indexing a non-array (scalar) binding abstains', () => {
    abstains([letScalar('n', '5'), print('n[0]')]);
  });

  it('malformed IR whose numeric index raw/value disagree abstains', () => {
    const expr: ValueIR = {
      kind: 'index',
      object: { kind: 'ident', name: 'xs' },
      index: { kind: 'numLit', raw: '0', value: 1 },
      optional: false,
    };
    const env = makeEnv({ bindings: new Map<string, unknown>([['xs', [10, 20, 30]]]) });
    expect(() => evalPortableValue(expr, env)).toThrow(/bare non-negative safe-integer literal/);
  });

  it('manual sparse array bindings abstain with an explicit index-hole error', () => {
    const sparse = Array(1);
    const env = makeEnv({ bindings: new Map<string, unknown>([['xs', sparse]]) });
    const expr: ValueIR = {
      kind: 'index',
      object: { kind: 'ident', name: 'xs' },
      index: { kind: 'numLit', raw: '0', value: 0 },
      optional: false,
    };
    expect(() => evalPortableValue(expr, env)).toThrow('portable: array index must point at an existing element');
  });

  it('malformed index object and index subnodes fail with controlled portable errors', () => {
    expect(() =>
      evalPortableValue(
        {
          kind: 'index',
          object: null,
          index: { kind: 'numLit', raw: '0', value: 0 },
          optional: false,
        } as unknown as ValueIR,
        makeEnv(),
      ),
    ).toThrow('portable: index access is only admitted on an array-binding identifier');

    expect(() =>
      evalPortableValue(
        { kind: 'index', object: { kind: 'ident', name: 'xs' }, index: null, optional: false } as unknown as ValueIR,
        makeEnv({ bindings: new Map<string, unknown>([['xs', [1]]]) }),
      ),
    ).toThrow('portable: array index must be a bare non-negative safe-integer literal');
  });

  it('malformed member object subnodes fail with a controlled portable error', () => {
    expect(() =>
      evalPortableValue(
        { kind: 'member', object: null, property: 'message', optional: false } as unknown as ValueIR,
        makeEnv(),
      ),
    ).toThrow('portable: member access is only admitted on an array, record, or caught-error binding');
  });
});
