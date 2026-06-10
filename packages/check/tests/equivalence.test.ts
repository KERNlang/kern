/**
 * THE EQUIVALENCE GATE.
 *
 * Asserts the lifted assignability core (packages/check) is behaviourally
 * IDENTICAL to the originals still living in packages/core/src/
 * semantic-validator.ts, over a matrix whose SEMANTIC coverage (not its cell
 * count) is the deliverable:
 *   - the (sub,sup) product over a 4-deep chain;
 *   - `undefined` sentinels on sub / sup / both ('unknown' paths);
 *   - names absent from classByName (one side / both), builtin-ish names,
 *     and an EMPTY classByName;
 *   - a cycle the baseName walk actually TRAVERSES (A→B→A reached from a
 *     queried pair);
 *   - override-variance over every kind pair (method/getter/setter/field,
 *     incl. MIXED accessor pairs), arity mismatches, and
 *     covariant/contravariant/invariant/unrelated types in both positions,
 *     plus undefined returns/params.
 *
 * Every cell asserts lifted ≡ original. A second block applies THREE live
 * mutations to copies of the LIFT logic and proves each lights ≥1 matrix cell
 * (dead-code mutations would be theater — nero C2).
 */
import { describe, expect, test } from '../../../scripts/node-test-compat.ts';
// The ORIGINALS, imported from core's built dist via a relative path (the
// exports map gates only bare specifiers, so this needs no core package.json
// edit). They were made `export` additively in semantic-validator.ts.
import {
  checkOverrideVariance as origCheckOverrideVariance,
  isNominalSubtype as origIsNominalSubtype,
} from '../../core/dist/semantic-validator.js';
import type { ClassMemberKind, NominalClassInfo, OverrideMemberInfo } from '../dist/assignable.js';
import {
  checkOverrideVariance as liftCheckOverrideVariance,
  isNominalSubtype as liftIsNominalSubtype,
} from '../dist/assignable.js';

type SubtypeResult = true | false | 'unknown';
type VarianceResult = 'return-mismatch' | 'param-mismatch' | null;

type IsNominalSubtypeFn = (
  sub: string | undefined,
  sup: string | undefined,
  classByName: ReadonlyMap<string, NominalClassInfo>,
) => SubtypeResult;

type CheckOverrideVarianceFn = (
  member: OverrideMemberInfo,
  baseMember: OverrideMemberInfo,
  classByName: ReadonlyMap<string, NominalClassInfo>,
) => VarianceResult;

const origSubtype = origIsNominalSubtype as unknown as IsNominalSubtypeFn;
const origVariance = origCheckOverrideVariance as unknown as CheckOverrideVarianceFn;

// ── Class universes ─────────────────────────────────────────────────────────

/**
 * A 4-deep linear chain  D → C → B → A  (D extends C extends B extends A).
 * `Sib` shares root A but is an unrelated branch (A ← Sib) for invariant /
 * unrelated cases. `Lone` is a known class with no base.
 */
function chainUniverse(): Map<string, NominalClassInfo> {
  return new Map<string, NominalClassInfo>([
    ['A', { name: 'A' }],
    ['B', { name: 'B', baseName: 'A' }],
    ['C', { name: 'C', baseName: 'B' }],
    ['D', { name: 'D', baseName: 'C' }],
    ['Sib', { name: 'Sib', baseName: 'A' }],
    ['Lone', { name: 'Lone' }],
  ]);
}

/** A→B→A cycle: B's base is A, A's base is B. Walking from D2→A reaches it. */
function cycleUniverse(): Map<string, NominalClassInfo> {
  return new Map<string, NominalClassInfo>([
    ['A', { name: 'A', baseName: 'B' }],
    ['B', { name: 'B', baseName: 'A' }],
    // A descendant that enters the cycle: D2 → C2 → A → B → A …
    ['C2', { name: 'C2', baseName: 'A' }],
    ['D2', { name: 'D2', baseName: 'C2' }],
    // Target never on the cycle path, forcing a full traversal until repeat.
    ['Z', { name: 'Z' }],
  ]);
}

// ── Cell harness ────────────────────────────────────────────────────────────

interface SubtypeCell {
  readonly label: string;
  readonly sub: string | undefined;
  readonly sup: string | undefined;
  readonly classByName: ReadonlyMap<string, NominalClassInfo>;
}

interface VarianceCell {
  readonly label: string;
  readonly member: OverrideMemberInfo;
  readonly base: OverrideMemberInfo;
  readonly classByName: ReadonlyMap<string, NominalClassInfo>;
}

const EMPTY: ReadonlyMap<string, NominalClassInfo> = new Map();

function member(
  kind: ClassMemberKind,
  opts: { returns?: string; paramTypes?: readonly string[]; arity?: number } = {},
): OverrideMemberInfo {
  const paramTypes = opts.paramTypes ?? [];
  return {
    kind,
    arity: opts.arity ?? paramTypes.length,
    returns: opts.returns,
    paramTypes,
  };
}

// ── Build the subtype matrix ────────────────────────────────────────────────

function buildSubtypeCells(): SubtypeCell[] {
  const cells: SubtypeCell[] = [];
  const chain = chainUniverse();

  // (1) full (sub,sup) product over the 4-deep chain D,C,B,A (+ siblings/lone).
  const names = ['A', 'B', 'C', 'D', 'Sib', 'Lone'];
  for (const sub of names) {
    for (const sup of names) {
      cells.push({ label: `chain ${sub}<:${sup}`, sub, sup, classByName: chain });
    }
  }

  // (2) undefined sentinels — sub undefined, sup undefined, both undefined.
  cells.push({ label: 'undef sub', sub: undefined, sup: 'A', classByName: chain });
  cells.push({ label: 'undef sup', sub: 'A', sup: undefined, classByName: chain });
  cells.push({ label: 'undef both', sub: undefined, sup: undefined, classByName: chain });
  cells.push({ label: 'undef sub eq', sub: undefined, sup: undefined, classByName: EMPTY });

  // (3) absent names: one side absent, both absent, builtin-ish, empty map.
  cells.push({ label: 'absent sub', sub: 'Ghost', sup: 'A', classByName: chain });
  cells.push({ label: 'absent sup', sub: 'A', sup: 'Ghost', classByName: chain });
  cells.push({ label: 'absent both', sub: 'Ghost', sup: 'Phantom', classByName: chain });
  cells.push({ label: 'builtin Error', sub: 'Error', sup: 'A', classByName: chain });
  cells.push({ label: 'builtin Array sup', sub: 'A', sup: 'Array', classByName: chain });
  cells.push({ label: 'builtin both', sub: 'Error', sup: 'Array', classByName: chain });
  cells.push({ label: 'builtin self-eq', sub: 'Error', sup: 'Error', classByName: chain });
  cells.push({ label: 'empty map miss', sub: 'A', sup: 'B', classByName: EMPTY });
  cells.push({ label: 'empty map self', sub: 'A', sup: 'A', classByName: EMPTY });

  // (4) a cycle the baseName walk TRAVERSES.
  const cyc = cycleUniverse();
  // D2 → C2 → A → B → A(repeat): never reaches Z, returns false after cycling.
  cells.push({ label: 'cycle D2<:Z (traverse→false)', sub: 'D2', sup: 'Z', classByName: cyc });
  // A → B → A(repeat): looking for C2 not on the path → false via seen-set.
  cells.push({ label: 'cycle A<:C2 (traverse→false)', sub: 'A', sup: 'C2', classByName: cyc });
  // D2 → C2 → A: reaches A before any cycle repeat → true (walk enters but
  // succeeds first).
  cells.push({ label: 'cycle D2<:A (reached)', sub: 'D2', sup: 'A', classByName: cyc });
  // B → A → B(repeat): reaches A then would cycle; looking for A → true early.
  cells.push({ label: 'cycle B<:A (reached pre-repeat)', sub: 'B', sup: 'A', classByName: cyc });
  // A → B → A(repeat): looking for B, reached on first hop → true.
  cells.push({ label: 'cycle A<:B (reached)', sub: 'A', sup: 'B', classByName: cyc });

  return cells;
}

// ── Build the override-variance matrix ──────────────────────────────────────

function buildVarianceCells(): VarianceCell[] {
  const cells: VarianceCell[] = [];
  const chain = chainUniverse();
  const kinds: ClassMemberKind[] = ['method', 'getter', 'setter', 'field'];

  // (A) every kind pair — equal kinds exercise the real branches; mismatched
  //     kinds (incl. mixed accessor getter/setter) must SKIP (null).
  for (const mk of kinds) {
    for (const bk of kinds) {
      cells.push({
        label: `kindpair ${mk}/${bk}`,
        member: member(mk, { returns: 'B', paramTypes: ['B'], arity: 1 }),
        base: member(bk, { returns: 'A', paramTypes: ['A'], arity: 1 }),
        classByName: chain,
      });
    }
  }

  // (B) method: arity mismatch → null (skip before variance).
  cells.push({
    label: 'method arity-mismatch',
    member: member('method', { returns: 'B', paramTypes: ['A'], arity: 2 }),
    base: member('method', { returns: 'A', paramTypes: ['A'], arity: 1 }),
    classByName: chain,
  });

  // (C) method return position — covariant (narrow OK), widen FAIL, equal OK,
  //     unrelated/sibling FAIL, undefined return → unknown (skip), builtin →
  //     unknown (skip).
  const methodReturn: Array<[string, string | undefined, string | undefined]> = [
    ['ret narrow B<:A ok', 'B', 'A'],
    ['ret equal A==A ok', 'A', 'A'],
    ['ret deep D<:A ok', 'D', 'A'],
    ['ret widen A</:B FAIL', 'A', 'B'],
    ['ret sibling Sib</:B FAIL', 'Sib', 'B'],
    ['ret unrelated Lone</:A FAIL', 'Lone', 'A'],
    ['ret undef member skip', undefined, 'A'],
    ['ret undef base skip', 'B', undefined],
    ['ret builtin skip', 'Error', 'A'],
  ];
  for (const [label, mret, bret] of methodReturn) {
    cells.push({
      label: `method ${label}`,
      member: member('method', { returns: mret, paramTypes: [], arity: 0 }),
      base: member('method', { returns: bret, paramTypes: [], arity: 0 }),
      classByName: chain,
    });
  }

  // (D) method param position — contravariant: base.param <: member.param.
  //     widen OK, narrow FAIL, equal OK, undefined skip, builtin skip,
  //     multi-param (second param fails).
  const methodParam: Array<[string, readonly (string | undefined)[], readonly (string | undefined)[]]> = [
    ['param widen ok (m=A,b=B)', ['A'], ['B']],
    ['param equal ok', ['A'], ['A']],
    ['param narrow FAIL (m=B,b=A)', ['B'], ['A']],
    ['param sibling FAIL (m=Sib,b=A)', ['Sib'], ['A']],
    ['param undef member skip', [undefined], ['A']],
    ['param undef base skip', ['B'], [undefined]],
    ['param builtin skip', ['Error'], ['A']],
    ['param multi 2nd-FAIL', ['A', 'C'], ['A', 'B']],
    ['param multi all-ok', ['A', 'A'], ['B', 'C']],
  ];
  for (const [label, mparams, bparams] of methodParam) {
    cells.push({
      label: `method ${label}`,
      member: member('method', {
        returns: 'A',
        paramTypes: mparams as readonly string[],
        arity: mparams.length,
      }),
      base: member('method', {
        returns: 'A',
        paramTypes: bparams as readonly string[],
        arity: bparams.length,
      }),
      classByName: chain,
    });
  }

  // (E) getter — covariant return only.
  const getterReturn: Array<[string, string | undefined, string | undefined]> = [
    ['getter narrow ok', 'B', 'A'],
    ['getter widen FAIL', 'A', 'B'],
    ['getter equal ok', 'A', 'A'],
    ['getter undef skip', undefined, 'A'],
    ['getter builtin skip', 'Array', 'A'],
  ];
  for (const [label, mret, bret] of getterReturn) {
    cells.push({
      label,
      member: member('getter', { returns: mret }),
      base: member('getter', { returns: bret }),
      classByName: chain,
    });
  }

  // (F) setter — contravariant param[0] only.
  const setterParam: Array<[string, string | undefined, string | undefined]> = [
    ['setter widen ok (m=A,b=B)', 'A', 'B'],
    ['setter narrow FAIL (m=B,b=A)', 'B', 'A'],
    ['setter equal ok', 'A', 'A'],
    ['setter undef member skip', undefined, 'A'],
    ['setter undef base skip', 'B', undefined],
    ['setter builtin skip', 'Error', 'A'],
  ];
  for (const [label, mp, bp] of setterParam) {
    cells.push({
      label,
      member: member('setter', { paramTypes: [mp as string], arity: 1 }),
      base: member('setter', { paramTypes: [bp as string], arity: 1 }),
      classByName: chain,
    });
  }

  // (G) field — always null regardless of types.
  cells.push({
    label: 'field skip',
    member: member('field', { returns: 'Sib', paramTypes: ['Sib'] }),
    base: member('field', { returns: 'A', paramTypes: ['A'] }),
    classByName: chain,
  });

  return cells;
}

const SUBTYPE_CELLS = buildSubtypeCells();
const VARIANCE_CELLS = buildVarianceCells();

// ── Equivalence assertions: lifted ≡ original on EVERY cell ──────────────────

describe('equivalence gate — isNominalSubtype lift ≡ original', () => {
  test(`covers ${SUBTYPE_CELLS.length} subtype cells, all matching original`, () => {
    for (const cell of SUBTYPE_CELLS) {
      const lifted = liftIsNominalSubtype(cell.sub, cell.sup, cell.classByName);
      const original = origSubtype(cell.sub, cell.sup, cell.classByName);
      expect({ cell: cell.label, result: lifted }).toEqual({ cell: cell.label, result: original });
    }
  });

  test('matrix exercises all three return values (true / false / unknown)', () => {
    const seen = new Set<SubtypeResult>();
    for (const cell of SUBTYPE_CELLS) {
      seen.add(liftIsNominalSubtype(cell.sub, cell.sup, cell.classByName));
    }
    expect(seen.has(true)).toBe(true);
    expect(seen.has(false)).toBe(true);
    expect(seen.has('unknown')).toBe(true);
  });
});

describe('equivalence gate — checkOverrideVariance lift ≡ original', () => {
  test(`covers ${VARIANCE_CELLS.length} variance cells, all matching original`, () => {
    for (const cell of VARIANCE_CELLS) {
      const lifted = liftCheckOverrideVariance(cell.member, cell.base, cell.classByName);
      const original = origVariance(cell.member, cell.base, cell.classByName);
      expect({ cell: cell.label, result: lifted }).toEqual({ cell: cell.label, result: original });
    }
  });

  test('matrix exercises all three variance verdicts (null / return / param)', () => {
    const seen = new Set<VarianceResult>();
    for (const cell of VARIANCE_CELLS) {
      seen.add(liftCheckOverrideVariance(cell.member, cell.base, cell.classByName));
    }
    expect(seen.has(null)).toBe(true);
    expect(seen.has('return-mismatch')).toBe(true);
    expect(seen.has('param-mismatch')).toBe(true);
  });
});

// ── Live-mutation discrimination proof (nero C2) ─────────────────────────────
//
// Three independent mutations of the LIFT, each targeting a DISTINCT return
// path. Each is a real, behaviour-changing reimplementation (not a dead-code
// edit). Every mutation must light ≥1 cell of the matrix above; the counts are
// asserted > 0 so a future matrix regression that creates a hole fails loudly.

/** MUTATION (a): flip return COVARIANCE — narrowing returns now wrongly fail. */
function mutantVarianceFlipReturn(
  m: OverrideMemberInfo,
  b: OverrideMemberInfo,
  cb: ReadonlyMap<string, NominalClassInfo>,
): VarianceResult {
  if (m.kind !== b.kind) return null;
  if (m.kind === 'field') return null;
  if (m.kind === 'method') {
    if (m.arity !== b.arity) return null;
    // FLIPPED: was isNominalSubtype(m.returns, b.returns)
    if (liftIsNominalSubtype(b.returns, m.returns, cb) === false) return 'return-mismatch';
    for (let i = 0; i < m.paramTypes.length; i += 1) {
      if (liftIsNominalSubtype(b.paramTypes[i], m.paramTypes[i], cb) === false) return 'param-mismatch';
    }
    return null;
  }
  if (m.kind === 'getter') {
    // FLIPPED here too.
    if (liftIsNominalSubtype(b.returns, m.returns, cb) === false) return 'return-mismatch';
    return null;
  }
  if (liftIsNominalSubtype(b.paramTypes[0], m.paramTypes[0], cb) === false) return 'param-mismatch';
  return null;
}

/** MUTATION (b): flip param CONTRAVARIANCE — widening params now wrongly fail. */
function mutantVarianceFlipParam(
  m: OverrideMemberInfo,
  b: OverrideMemberInfo,
  cb: ReadonlyMap<string, NominalClassInfo>,
): VarianceResult {
  if (m.kind !== b.kind) return null;
  if (m.kind === 'field') return null;
  if (m.kind === 'method') {
    if (m.arity !== b.arity) return null;
    if (liftIsNominalSubtype(m.returns, b.returns, cb) === false) return 'return-mismatch';
    for (let i = 0; i < m.paramTypes.length; i += 1) {
      // FLIPPED: was isNominalSubtype(b.paramTypes[i], m.paramTypes[i])
      if (liftIsNominalSubtype(m.paramTypes[i], b.paramTypes[i], cb) === false) return 'param-mismatch';
    }
    return null;
  }
  if (m.kind === 'getter') {
    if (liftIsNominalSubtype(m.returns, b.returns, cb) === false) return 'return-mismatch';
    return null;
  }
  // FLIPPED here too.
  if (liftIsNominalSubtype(m.paramTypes[0], b.paramTypes[0], cb) === false) return 'param-mismatch';
  return null;
}

/** MUTATION (c): break the cycle-guard — drop the seen-set add → infinite loop
 *  risk, so this mutant caps iterations and reports a sentinel. A divergence
 *  from the original on any cycle cell proves the guard is exercised. */
function mutantSubtypeNoCycleGuard(
  sub: string | undefined,
  sup: string | undefined,
  cb: ReadonlyMap<string, NominalClassInfo>,
): SubtypeResult {
  if (sub === undefined || sup === undefined) return 'unknown';
  if (sub === sup) return true;
  if (!cb.has(sub) || !cb.has(sup)) return 'unknown';
  let current = cb.get(sub);
  // REMOVED: const visited = new Set<string>(); + visited.has/add guard.
  // Cap iterations so the test can't hang; the cap is the observable defect.
  let guard = 0;
  while (current) {
    if (current.name === sup) return true;
    if (guard++ > 10000) return 'unknown'; // sentinel the original NEVER returns here
    current = current.baseName ? cb.get(current.baseName) : undefined;
  }
  return false;
}

describe('live-mutation discrimination (nero C2)', () => {
  function countSubtypeDivergences(mut: IsNominalSubtypeFn): number {
    let n = 0;
    for (const c of SUBTYPE_CELLS) {
      if (mut(c.sub, c.sup, c.classByName) !== liftIsNominalSubtype(c.sub, c.sup, c.classByName)) n += 1;
    }
    return n;
  }
  function countVarianceDivergences(mut: CheckOverrideVarianceFn): number {
    let n = 0;
    for (const c of VARIANCE_CELLS) {
      if (mut(c.member, c.base, c.classByName) !== liftCheckOverrideVariance(c.member, c.base, c.classByName)) {
        n += 1;
      }
    }
    return n;
  }

  test('(a) flip return covariance lights ≥1 variance cell', () => {
    const count = countVarianceDivergences(mutantVarianceFlipReturn);
    // eslint-disable-next-line no-console
    console.log(`[mutation-a return-covariance-flip] lit ${count} cell(s)`);
    expect(count).toBeGreaterThan(0);
  });

  test('(b) flip param contravariance lights ≥1 variance cell', () => {
    const count = countVarianceDivergences(mutantVarianceFlipParam);
    // eslint-disable-next-line no-console
    console.log(`[mutation-b param-contravariance-flip] lit ${count} cell(s)`);
    expect(count).toBeGreaterThan(0);
  });

  test('(c) break cycle-guard lights ≥1 subtype cell', () => {
    const count = countSubtypeDivergences(mutantSubtypeNoCycleGuard);
    // eslint-disable-next-line no-console
    console.log(`[mutation-c cycle-guard-break] lit ${count} cell(s)`);
    expect(count).toBeGreaterThan(0);
  });
});

// ── Return-statement reachability (every return of both lifted fns hit) ──────

describe('return-statement reachability', () => {
  test('isNominalSubtype: all four return statements reachable from matrix', () => {
    // The four returns: 'unknown'(undef), true(sub===sup), 'unknown'(not in map),
    // true(reached in walk), false(end/cycle). Collapsed observably to the three
    // distinct values + the cycle-false vs end-false both present.
    const results = SUBTYPE_CELLS.map((c) => ({
      label: c.label,
      r: liftIsNominalSubtype(c.sub, c.sup, c.classByName),
    }));
    // undef-sentinel 'unknown'
    expect(results.some((x) => x.label.startsWith('undef') && x.r === 'unknown')).toBe(true);
    // sub===sup true (empty-map self proves the early === return, pre-map-check)
    expect(results.some((x) => x.label === 'empty map self' && x.r === true)).toBe(true);
    // not-in-map 'unknown'
    expect(results.some((x) => x.label.startsWith('absent') && x.r === 'unknown')).toBe(true);
    // reached-in-walk true
    expect(results.some((x) => x.label === 'chain D<:A' && x.r === true)).toBe(true);
    // end-of-chain false (non-cycle)
    expect(results.some((x) => x.label === 'chain A<:D' && x.r === false)).toBe(true);
    // cycle-traversed false
    expect(results.some((x) => x.label.includes('cycle') && x.label.includes('false') && x.r === false)).toBe(true);
  });

  test('checkOverrideVariance: all return statements reachable from matrix', () => {
    const results = VARIANCE_CELLS.map((c) => ({
      label: c.label,
      r: liftCheckOverrideVariance(c.member, c.base, c.classByName),
    }));
    // kind-mismatch null
    expect(results.some((x) => x.label === 'kindpair method/getter' && x.r === null)).toBe(true);
    // field null
    expect(results.some((x) => x.label === 'field skip' && x.r === null)).toBe(true);
    // method arity-mismatch null
    expect(results.some((x) => x.label === 'method arity-mismatch' && x.r === null)).toBe(true);
    // method return-mismatch
    expect(results.some((x) => x.label.includes('ret widen') && x.r === 'return-mismatch')).toBe(true);
    // method param-mismatch
    expect(results.some((x) => x.label.includes('param narrow') && x.r === 'param-mismatch')).toBe(true);
    // method null (ok path)
    expect(results.some((x) => x.label.includes('ret narrow') && x.r === null)).toBe(true);
    // getter return-mismatch + null
    expect(results.some((x) => x.label === 'getter widen FAIL' && x.r === 'return-mismatch')).toBe(true);
    expect(results.some((x) => x.label === 'getter narrow ok' && x.r === null)).toBe(true);
    // setter param-mismatch + null
    expect(results.some((x) => x.label.includes('setter narrow') && x.r === 'param-mismatch')).toBe(true);
    expect(results.some((x) => x.label.includes('setter widen') && x.r === null)).toBe(true);
  });
});
