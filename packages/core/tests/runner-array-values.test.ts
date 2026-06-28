/**
 * ReferenceRunner — array-literal VALUES + `each` iteration (slice-2a).
 *
 * KERN's value is its OWN runtime executing `.kern` natively; this slice makes
 * the ReferenceRunner (the executor `kern run` uses) able to BIND an array
 * literal so the canonical demo runs on its own:
 *
 *     let xs = [1,2,3]   →   each x in xs: print x   →   1 / 2 / 3
 *
 * Semantics MIRROR the product runtime (`core-runtime`'s `arrayLit` case): an
 * array literal eagerly, recursively evaluates its elements into a single array
 * value. Elements are the portable-scalar domain (safe-integer number, string,
 * bool, null) plus NESTED array literals of the same. A non-portable element
 * (non-canonical numeric literal, non-integer/unsafe numeric expression, Decimal,
 * a regex, an object, an unsupported call) makes the binding ABSTAIN (fail-close).
 *
 * Deliberately DEFERRED in this slice — every one must ABSTAIN (precondition
 * fails → `referenceRunSequence` throws `ReferenceRunnerError`), never produce
 * a value:
 *   - whole-array `print xs` (the shipped `print` contract already fail-closes
 *     arrays AND non-integer floats — the runner is a conservative subset),
 *   - OUT-OF-BOUNDS / negative / non-integer index access (TS undefined vs Py
 *     IndexError/wraparound/TypeError — not 3-leg portable). In-bounds index
 *     reads now CERTIFY (slice-2b, see runner-array-index.test.ts),
 *   - `.length`, `assign` to an array binding, methods / spread / concat.
 *
 * Every expected value here was verified empirically on the REAL emitters
 * (node + python3) before authoring — this is RED-at-base (arrays abstain today)
 * and turns GREEN only when the runner binds array literals.
 */

import { makeEnv, ReferenceRunnerError, referenceRunSequence, registerAllContracts } from '../src/index.js';
import type { IRNode } from '../src/types.js';

beforeAll(() => {
  registerAllContracts();
});

/** Run a sequence of body statements and return the replayed stdout text
 *  (each `{op:'stdout'}` event + "\n"), exactly as `kern run` renders it. */
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
function eachPrint(varName: string, inName: string, child: IRNode): IRNode {
  return { type: 'each', props: { name: varName, in: inName }, children: [child] };
}
function print(expr: string): IRNode {
  return { type: 'print', props: { value: expr } };
}

// ── CORE: array literals bind and `each` iterates them (3-leg-portable obs.) ──
describe('runner array values — bind + each iteration', () => {
  it('each over a numeric array literal prints each element in order', () => {
    expect(runStdout([letArr('xs', '[1,2,3]'), eachPrint('x', 'xs', print('x'))])).toBe('1\n2\n3\n');
  });

  it('each over a string array keeps each element a DISTINCT string (no join)', () => {
    // The comma INSIDE "b,c" must survive as one element — an impl that joins /
    // flattens the array into a single string would print "a,b,c" on one line.
    expect(runStdout([letArr('xs', '["a","b,c"]'), eachPrint('x', 'xs', print('x'))])).toBe('a\nb,c\n');
  });

  it('each over a boolean array prints canonical lowercase', () => {
    expect(runStdout([letArr('xs', '[true,false]'), eachPrint('x', 'xs', print('x'))])).toBe('true\nfalse\n');
  });

  it('NESTED array literals are real iterable values (double-nested each)', () => {
    // rows = [[1,2],[3]] — each `row` binds an ARRAY; iterating it again yields
    // the leaf scalars. Proves recursive element evaluation, not a flat fake.
    const inner = eachPrint('v', 'row', print('v'));
    expect(runStdout([letArr('rows', '[[1,2],[3]]'), eachPrint('row', 'rows', inner)])).toBe('1\n2\n3\n');
  });

  it('empty array literal yields zero iterations (no output, normal completion)', () => {
    expect(runStdout([letArr('xs', '[]'), eachPrint('x', 'xs', print('x'))])).toBe('');
  });

  it('a mixed-kind array iterates each element in order with per-kind canonical print', () => {
    // 0 / "k" / true / null each bind and print with no cross-kind coercion:
    // null -> "null", true -> "true", 0 -> "0". Verified on node + python3.
    expect(runStdout([letArr('xs', '[0,"k",true,null]'), eachPrint('x', 'xs', print('x'))])).toBe('0\nk\ntrue\nnull\n');
  });

  it('binds the array literal directly as the assign-trace payload (flat + nested)', () => {
    // Verify the BINDING value itself, not just the downstream `each` observable:
    // `let` emits one `{op:'assign', target, value}` carrying the evaluated array
    // (recursively, for nested literals). This pins the exact payload at the seam.
    const flat = referenceRunSequence([letArr('xs', '[1,2,3]')], makeEnv());
    expect(flat.events).toEqual([{ op: 'assign', target: 'xs', value: [1, 2, 3] }]);
    const nested = referenceRunSequence([letArr('rows', '[[1,2],[3]]')], makeEnv());
    expect(nested.events).toEqual([{ op: 'assign', target: 'rows', value: [[1, 2], [3]] }]);
  });
});

// ── FAIL-CLOSE: deferred / non-portable array observations must ABSTAIN ───────
describe('runner array values — fail-close fences (abstain, never a value)', () => {
  const abstains = (nodes: IRNode[]) =>
    expect(() => referenceRunSequence(nodes, makeEnv())).toThrow(ReferenceRunnerError);

  it('whole-array print abstains (print contract fail-closes arrays)', () => {
    abstains([letArr('xs', '[1,2,3]'), print('xs')]);
  });

  it('OUT-OF-BOUNDS index abstains (TS undefined vs Py IndexError — not 3-leg portable)', () => {
    // In-bounds index now certifies (slice-2b, runner-array-index.test.ts); an
    // OOB read stays fenced because the two emitter legs diverge on it.
    abstains([letArr('xs', '[1,2,3]'), print('xs[5]')]);
  });

  it('.length access abstains (deferred)', () => {
    abstains([letArr('xs', '[1,2,3]'), print('xs.length')]);
  });

  it('a non-integer FLOAT element abstains at binding time', () => {
    abstains([letArr('xs', '[1.5]'), eachPrint('x', 'xs', print('x'))]);
  });

  it('a non-portable element (Decimal) abstains at the binding', () => {
    abstains([letArr('xs', '[Decimal.of("1")]'), eachPrint('x', 'xs', print('x'))]);
  });

  it('assign to an array binding abstains (deferred — mutable arrays are a later slice)', () => {
    abstains([
      { type: 'let', props: { name: 'xs', kind: 'let', value: '[1]' } },
      { type: 'assign', props: { target: 'xs', value: '[2]' } },
    ]);
  });
});
