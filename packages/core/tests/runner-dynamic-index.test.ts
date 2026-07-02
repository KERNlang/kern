/**
 * ReferenceRunner — DYNAMIC array index via for-counter integer-provenance
 * (continues the array slices 2a bind+each / 2b literal index / `.length`).
 *
 * Slice 2b read an element only by a BARE safe-integer LITERAL because a
 * `let`-bound number index can be a Python float the reference cannot rule out
 * by value (`let j = 4 / 2` is 2 in JS/ref but 2.0 in Python → `xs[j]` is xs[2]
 * in TS, TypeError in Python). This slice lets the runner read `xs[i]` when `i`
 * is a `for` COUNTER, because a `for` counter is a GUARANTEED safe integer (the
 * `for` contract enforces `Number.isSafeInteger` on from/to/step and steps by an
 * integer), so it is an int on all three legs by construction — the provenance
 * comes from the loop, not a value check:
 *
 *     let xs = [10,20,30]
 *     for i in 0..xs.length:  print xs[i]      →  10 / 20 / 30
 *
 * Two coupled capabilities ship together so the headline works:
 *   (A) `.length` as a `for` RANGE BOUND  (`for i from=0 to=xs.length`), and
 *   (B) a for-counter as an array INDEX   (`xs[i]`).
 *
 * SCOPE — `xs[i]` certifies ONLY when `i` is a BARE ident that is
 * integer-provenanced (currently: the live counter of an enclosing `for`).
 * Provenance is per-scope binding metadata, set ONLY by the `for` contract and
 * CLEARED by any reassignment/shadowing, so it can never outlive an int value:
 *   - `let j = 4 / 2; xs[j]`            → abstain (a plain let is not provenanced)
 *   - `for i..: let j = i; xs[j]`       → abstain (provenance is NOT transitive)
 *   - `for i..: assign i = 4/2; xs[i]`  → abstain (assign clears provenance)
 *   - `xs[i + 1]`                        → CERTIFIES as of milestone 5.1b
 *     (`+`/`-` arithmetic between provenanced operands; see
 *     `isIntProvenancedExpr` in portable-scalar.ts). `xs[i * 1]` still abstains.
 * Provenance proves INTEGER-NESS, not in-bounds-ness — the existing runtime
 * bounds check still applies, so a reverse loop reaching a NEGATIVE index or a
 * range exceeding the array ABSTAINS mid-loop (TS xs[3]=undefined / xs[-1]=undefined
 * vs Python IndexError / wraparound — verified on real node + python3), and the
 * abstain is ATOMIC (no partial stdout).
 *
 * Reference-only change: the emitters already lower `for i=0 to xs.length` and
 * `xs[i]` correctly (TS `for (…; i < xs.length; …)` + `xs[i]`; Python
 * `range(len(xs))` + `xs[i]`), so an abstaining program is never certified and
 * never reaches the differential — no codegen change.
 *
 * RED-at-base: `for to=xs.length` abstains (for's evalValue has no member case)
 * and `xs[i]` abstains (the index case rejects idents); both turn GREEN only when
 * the runner gains the `.length` bound + counter provenance.
 */

import { makeEnv, ReferenceRunnerError, referenceRunSequence, registerAllContracts } from '../src/index.js';
import type { IRNode } from '../src/types.js';

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
function assign(target: string, value: string): IRNode {
  return { type: 'assign', props: { target, value } };
}
/** `for name=<name> from=<from> to=<to> [step=<step>]` with the given body. */
function forL(props: { name: string; from: string; to: string; step?: string }, ...children: IRNode[]): IRNode {
  return { type: 'for', props, children };
}

// ── CERTIFY: for-counter index + `.length` bound are 3-leg portable ───────────
describe('runner dynamic index — for-counter reads certify (3-leg portable)', () => {
  it('HEADLINE: iterates an array by index over its `.length`', () => {
    expect(
      runStdout([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '0', to: 'xs.length' }, print('xs[i]'))]),
    ).toBe('10\n20\n30\n');
  });

  it('reads by counter over an integer-LITERAL bound', () => {
    expect(runStdout([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '0', to: '3' }, print('xs[i]'))])).toBe(
      '10\n20\n30\n',
    );
  });

  it('a REVERSE loop (step -1) reads elements back-to-front', () => {
    expect(
      runStdout([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '2', to: '-1', step: '-1' }, print('xs[i]'))]),
    ).toBe('30\n20\n10\n');
  });

  it('a STEPPED loop reads every other element', () => {
    expect(
      runStdout([
        letBind('xs', '[10,20,30,40,50]'),
        forL({ name: 'i', from: '0', to: 'xs.length', step: '2' }, print('xs[i]')),
      ]),
    ).toBe('10\n30\n50\n');
  });

  it('an EMPTY range yields no iterations (no output)', () => {
    expect(runStdout([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '0', to: '0' }, print('xs[i]'))])).toBe('');
  });

  it('`.length` as a for-bound ALONE drives the iteration count (no index)', () => {
    // Isolates capability (A): the loop runs `xs.length` times printing the counter.
    expect(runStdout([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '0', to: 'xs.length' }, print('i'))])).toBe(
      '0\n1\n2\n',
    );
  });

  // Milestone 5.1b — `+`/`-` arithmetic between provenanced operands now
  // certifies (see `isIntProvenancedExpr` in portable-scalar.ts). This was
  // previously "ARITHMETIC on the counter abstains: `xs[i + 1]` is out of
  // slice" — the exact capability this milestone lifts.
  it('ARITHMETIC (+) on a for-counter now certifies: `xs[i + 1]`', () => {
    expect(
      runStdout([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '0', to: '2' }, print('xs[i + 1]'))]),
    ).toBe('20\n30\n');
  });

  it('ARITHMETIC (-) on a for-counter now certifies: `xs[i - 1]`', () => {
    expect(
      runStdout([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '1', to: '3' }, print('xs[i - 1]'))]),
    ).toBe('10\n20\n');
  });

  it('NESTED arithmetic on a for-counter certifies: `xs[i + 1 - 1]`', () => {
    expect(
      runStdout([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '0', to: '3' }, print('xs[i + 1 - 1]'))]),
    ).toBe('10\n20\n30\n');
  });

  it('a NESTED loop resolves the OUTER counter across scopes (declaringScope provenance)', () => {
    // `xs[i]` is read in the INNER loop's scope while `i` is the OUTER counter —
    // isIntProvenanced must walk to the declaring scope to find i's mark.
    expect(
      runStdout([
        letBind('xs', '[10,20,30]'),
        forL({ name: 'i', from: '0', to: 'xs.length' }, forL({ name: 'k', from: '0', to: '1' }, print('xs[i]'))),
      ]),
    ).toBe('10\n20\n30\n');
  });
});

// ── FAIL-CLOSE: every non-(provenanced-counter) index ABSTAINS ────────────────
describe('runner dynamic index — fail-close fences (abstain, never a value)', () => {
  const abstains = (nodes: IRNode[]) =>
    expect(() => referenceRunSequence(nodes, makeEnv())).toThrow(ReferenceRunnerError);

  it('a plain LET-bound number index abstains even when in-bounds (the slice-2b fence holds)', () => {
    abstains([letBind('xs', '[10,20,30]'), letBind('j', '2'), print('xs[j]')]);
  });

  it('THE FLOAT HOLE: `let j = 4 / 2; xs[j]` abstains (j is 2.0 in Python)', () => {
    // The killer case the provenance gate must keep closed — accepting ANY ident
    // index would certify this, then diverge (TS xs[2]=30 vs Python xs[2.0] TypeError).
    abstains([letBind('xs', '[10,20,30]'), letBind('j', '4 / 2'), print('xs[j]')]);
  });

  it('provenance is NOT transitive: `for i..: let j = i; xs[j]` abstains', () => {
    // `j` copies the counter VALUE but not its provenance, so it fails closed.
    abstains([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '0', to: '3' }, letBind('j', 'i'), print('xs[j]'))]);
  });

  it('ASSIGN to the counter clears provenance: `for i..: assign i = 4/2; xs[i]` abstains', () => {
    abstains([
      letBind('xs', '[10,20,30]'),
      forL({ name: 'i', from: '0', to: '3' }, assign('i', '4 / 2'), print('xs[i]')),
    ]);
  });

  it('ANY assign to the counter clears provenance, even an integer (`assign i = 1`)', () => {
    // Provenance is minted by the loop, not re-derived from the assigned value —
    // so even an integer reassignment drops it (the binding is no longer the
    // construct-guaranteed counter). Fail-safe over-rejection.
    abstains([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '0', to: '3' }, assign('i', '1'), print('xs[i]'))]);
  });

  it('a for-RANGE bound indexed by a plain let `for to=xs[j]` abstains (j could be a Python float)', () => {
    // The blocking review finding: for's range evaluator must apply the SAME index
    // gate as the body — `let j = 4/2` is 2.0 in Python, so `range(0, xs[2.0])`
    // raises TypeError while JS/ref read xs[2]. Verified divergent on node+python3.
    abstains([
      letBind('xs', '[3,4,5]'),
      letBind('j', '4 / 2'),
      forL({ name: 'i', from: '0', to: 'xs[j]' }, print('i')),
    ]);
  });

  it('MULTIPLICATION on the counter still abstains: `xs[i * 1]`', () => {
    abstains([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '0', to: '2' }, print('xs[i * 1]'))]);
  });

  it('OUT-OF-BOUNDS arithmetic on the counter abstains atomically: `xs[i + 5]`', () => {
    abstains([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '0', to: '2' }, print('xs[i + 5]'))]);
  });

  it('OUT-OF-BOUNDS mid-loop abstains ATOMICALLY (no partial stdout)', () => {
    // for i in 0..5 over a length-3 array: at i=3 TS reads undefined, Python raises
    // IndexError → the whole program abstains, emitting nothing.
    abstains([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '0', to: '5' }, print('xs[i]'))]);
  });

  it('a NEGATIVE counter (reverse past 0) abstains (TS undefined vs Py wraparound)', () => {
    // for i in 2..-2 step -1 reaches i = -1 → divergent index → abstain.
    abstains([letBind('xs', '[10,20,30]'), forL({ name: 'i', from: '2', to: '-2', step: '-1' }, print('xs[i]'))]);
  });

  it('an EACH binding is not integer-provenanced: `each x in ys: xs[x]` abstains', () => {
    // `each` binds an element value (any type), NOT an int counter — so its binding
    // is never provenanced and indexing with it fails closed.
    abstains([
      letBind('xs', '[10,20,30]'),
      letBind('ys', '[0,1]'),
      { type: 'each', props: { name: 'x', in: 'ys' }, children: [print('xs[x]')] },
    ]);
  });
});
