/**
 * THE DECLARATION-WALKER EQUIVALENCE GATE (slice 2).
 *
 * Asserts `checkProgram` (packages/check/src/walk.ts) is STRUCTURALLY
 * equivalent to core's live `validateClassOverrides` on the SHARED SURFACE —
 * the two override rules `class-override-return-mismatch` /
 * `class-override-param-mismatch` (nero C5). Equivalence is SET equality over
 * (rule, className, memberName) tuples: for every synthetic program below, the
 * set of override tuples `checkProgram` emits equals the set the live
 * validator emits, with cardinality mirrored exactly (one diagnostic per
 * member, not per param — probe 3).
 *
 * The corpus encodes the Liskov conformance shapes: covariant-return OK,
 * contravariant-param OK, both-reversed REJECT, grandparent chain, mixed
 * accessors (skip), builtin base (skip), unknown types (skip),
 * static-vs-instance same-name (skip), and arity mismatch.
 *
 * A second block applies TWO live mutations to the pair-matching and proves
 * each lights ≥1 corpus case as a divergence from `checkProgram` (nero C3):
 *   (a) pair-matching ignores member KIND,
 *   (b) pair-matching ignores STATIC/instance separation.
 * Dead mutations would be theatre; the counts are asserted > 0.
 */
import { describe, expect, test } from '../../../scripts/node-test-compat.ts';
import { parseDocumentWithDiagnostics } from '../../core/dist/parser.js';
import type { ClassInfo, ClassMemberInfo } from '../../core/dist/semantic-validator.js';
import { collectClassInfos, validateSemantics } from '../../core/dist/semantic-validator.js';
import { checkOverrideVariance } from '../dist/assignable.js';
import type { CheckDiagnostic } from '../dist/walk.js';
import { checkProgram } from '../dist/walk.js';

// ── KERN program corpus (Liskov conformance shapes) ──────────────────────────

const ANIMAL_KINGDOM = ['class name=Animal', 'class name=Dog extends=Animal', 'class name=Cat extends=Animal'];

function program(...lines: string[]): string {
  return [...ANIMAL_KINGDOM, ...lines].join('\n');
}

interface Corpus {
  readonly label: string;
  readonly source: string;
}

const CORPUS: readonly Corpus[] = [
  {
    label: 'covariant-return OK (Dog<:Animal)',
    source: program(
      'class name=Base',
      '  method name=make returns=Animal',
      '    handler lang=kern',
      '      return value="new Animal()"',
      'class name=Sub extends=Base',
      '  method name=make returns=Dog',
      '    handler lang=kern',
      '      return value="new Dog()"',
    ),
  },
  {
    label: 'covariant-return REJECT (widen Animal over Dog)',
    source: program(
      'class name=Base',
      '  method name=make returns=Dog',
      '    handler lang=kern',
      '      return value="new Dog()"',
      'class name=Sub extends=Base',
      '  method name=make returns=Animal',
      '    handler lang=kern',
      '      return value="new Animal()"',
    ),
  },
  {
    label: 'contravariant-param OK (widen Dog→Animal)',
    source: program(
      'class name=Base',
      '  method name=greet returns=string',
      '    param name=other type=Dog',
      '    handler lang=kern',
      '      return value="\'hi\'"',
      'class name=Sub extends=Base',
      '  method name=greet returns=string',
      '    param name=other type=Animal',
      '    handler lang=kern',
      '      return value="\'woof\'"',
    ),
  },
  {
    label: 'contravariant-param REJECT (narrow Animal→Dog)',
    source: program(
      'class name=Base',
      '  method name=greet returns=string',
      '    param name=other type=Animal',
      '    handler lang=kern',
      '      return value="\'hi\'"',
      'class name=Sub extends=Base',
      '  method name=greet returns=string',
      '    param name=other type=Dog',
      '    handler lang=kern',
      '      return value="\'woof\'"',
    ),
  },
  {
    label: 'both-reversed REJECT (return-widen wins via continue)',
    source: program(
      'class name=Base',
      '  method name=g returns=Dog',
      '    param name=a type=Animal',
      '    handler lang=kern',
      '      return value="new Dog()"',
      'class name=Sub extends=Base',
      '  method name=g returns=Animal',
      '    param name=a type=Dog',
      '    handler lang=kern',
      '      return value="new Animal()"',
    ),
  },
  {
    label: 'grandparent-chain covariant-return OK (A<-B<-C)',
    source: [
      'class name=A',
      '  method name=spawn returns=A',
      '    handler lang=kern',
      '      return value="new A()"',
      'class name=B extends=A',
      'class name=C extends=B',
      '  method name=spawn returns=C',
      '    handler lang=kern',
      '      return value="new C()"',
    ].join('\n'),
  },
  {
    label: 'grandparent-chain return-widen REJECT (C widens A)',
    source: [
      'class name=A',
      'class name=B extends=A',
      '  method name=spawn returns=B',
      '    handler lang=kern',
      '      return value="new B()"',
      'class name=A2',
      'class name=B2 extends=A2',
      'class name=C2 extends=B2',
      '  method name=q returns=number',
      '    handler lang=kern',
      '      return value=1',
    ].join('\n'),
  },
  {
    label: 'mixed accessors getter-over-setter SKIP',
    source: program(
      'class name=Base',
      '  setter name=tag',
      '    param name=next type=Animal',
      '    handler lang=kern',
      '      assign target="this._tag" value="next"',
      'class name=Sub extends=Base',
      '  getter name=tag returns=Dog',
      '    handler lang=kern',
      '      return value="this._tag"',
    ),
  },
  {
    label: 'getter-over-getter return-widen REJECT',
    source: program(
      'class name=Base',
      '  getter name=tag returns=Dog',
      '    handler lang=kern',
      '      return value="this._tag"',
      'class name=Sub extends=Base',
      '  getter name=tag returns=Animal',
      '    handler lang=kern',
      '      return value="this._tag"',
    ),
  },
  {
    label: 'setter-over-setter param-narrow REJECT',
    source: program(
      'class name=Base',
      '  setter name=tag',
      '    param name=next type=Animal',
      '    handler lang=kern',
      '      assign target="this._tag" value="next"',
      'class name=Sub extends=Base',
      '  setter name=tag',
      '    param name=next type=Dog',
      '    handler lang=kern',
      '      assign target="this._tag" value="next"',
    ),
  },
  {
    label: 'builtin base SKIP (extends Error)',
    source: program(
      'class name=AppError extends=Error',
      '  method name=make returns=Animal',
      '    handler lang=kern',
      '      return value="new Animal()"',
    ),
  },
  {
    label: 'unknown types SKIP (non-class return/param names)',
    source: program(
      'class name=Base',
      '  method name=load returns=Widget',
      '    param name=a type=Gadget',
      '    handler lang=kern',
      '      return value="new Widget()"',
      'class name=Sub extends=Base',
      '  method name=load returns=Sprocket',
      '    param name=a type=Cog',
      '    handler lang=kern',
      '      return value="new Sprocket()"',
    ),
  },
  {
    label: 'static-vs-instance same-name SKIP (statics separated)',
    source: program(
      'class name=Base',
      '  method name=m static=true returns=Dog',
      '    handler lang=kern',
      '      return value="new Dog()"',
      'class name=Sub extends=Base',
      '  method name=m returns=Animal',
      '    handler lang=kern',
      '      return value="new Animal()"',
    ),
  },
  {
    label: 'static-over-static return-widen REJECT (statics match)',
    source: program(
      'class name=Base',
      '  method name=m static=true returns=Dog',
      '    handler lang=kern',
      '      return value="new Dog()"',
      'class name=Sub extends=Base',
      '  method name=m static=true returns=Animal',
      '    handler lang=kern',
      '      return value="new Animal()"',
    ),
  },
  {
    label: 'arity-mismatch SKIP (variance not evaluated)',
    source: program(
      'class name=Base',
      '  method name=load returns=string',
      '    param name=id type=Animal',
      '    handler lang=kern',
      '      return value="\'x\'"',
      'class name=Sub extends=Base',
      '  method name=load returns=string',
      '    param name=id type=Dog',
      '    param name=extra type=Dog',
      '    handler lang=kern',
      '      return value="\'y\'"',
    ),
  },
  {
    label: 'method-over-getter same-name SKIP (kind separated)',
    // Base method `tag` returns Dog; Sub getter `tag` returns Animal. Kinds
    // differ, so variance is NOT evaluated (the validator emits a
    // kind-mismatch, outside the shared surface). A kind-BLIND pair-matcher
    // would wrongly variance-check this (Animal widens Dog) and fire a spurious
    // return-mismatch — this case is the discriminator for mutation (a).
    source: program(
      'class name=Base',
      '  method name=tag returns=Dog',
      '    handler lang=kern',
      '      return value="new Dog()"',
      'class name=Sub extends=Base',
      '  getter name=tag returns=Animal',
      '    handler lang=kern',
      '      return value="this._tag"',
    ),
  },
  {
    label: 'multi-param narrow AGGREGATED to one param diagnostic',
    source: program(
      'class name=Base',
      '  method name=f returns=string',
      '    param name=a type=Animal',
      '    param name=b type=Animal',
      '    handler lang=kern',
      '      return value="\'x\'"',
      'class name=Sub extends=Base',
      '  method name=f returns=string',
      '    param name=a type=Dog',
      '    param name=b type=Dog',
      '    handler lang=kern',
      '      return value="\'y\'"',
    ),
  },
];

// ── Tuple extraction on the shared surface ───────────────────────────────────

type SharedTuple = string; // `${rule}|${className}|${memberName}`

const SHARED_CHECK_RULES = new Set<CheckDiagnostic['rule']>(['check-override-return', 'check-override-param']);

/** validator rule name → the check rule it mirrors. */
const CHECK_RULE_BY_VALIDATOR: Record<string, CheckDiagnostic['rule']> = {
  'class-override-return-mismatch': 'check-override-return',
  'class-override-param-mismatch': 'check-override-param',
};

function checkTuples(source: string): Set<SharedTuple> {
  const root = parseDocumentWithDiagnostics(source).root;
  const set = new Set<SharedTuple>();
  for (const d of checkProgram(root as never)) {
    if (SHARED_CHECK_RULES.has(d.rule)) set.add(`${d.rule}|${d.className}|${d.memberName}`);
  }
  return set;
}

function validatorTuples(source: string): Set<SharedTuple> {
  const root = parseDocumentWithDiagnostics(source).root;
  const set = new Set<SharedTuple>();
  for (const v of validateSemantics(root)) {
    const checkRule = CHECK_RULE_BY_VALIDATOR[v.rule];
    if (!checkRule) continue;
    // The validator encodes className/member only in its message; recover them
    // so tuples are comparable across the two diagnostic shapes.
    const m = /Class '([^']+)' (?:member|method) '([^']+)'/.exec(v.message);
    if (!m) continue;
    set.add(`${checkRule}|${m[1]}|${m[2]}`);
  }
  return set;
}

function setEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ── Equivalence assertions ───────────────────────────────────────────────────

describe('declaration-walker equivalence gate — checkProgram ≡ validator (shared surface)', () => {
  test(`structural set-equality on ${CORPUS.length} synthetic programs`, () => {
    for (const { label, source } of CORPUS) {
      const checkSet = checkTuples(source);
      const validatorSet = validatorTuples(source);
      expect({ label, equal: setEqual(checkSet, validatorSet), check: [...checkSet].sort() }).toEqual({
        label,
        equal: true,
        check: [...validatorSet].sort(),
      });
    }
  });

  test('corpus exercises both rules + a clean (zero-diagnostic) shape', () => {
    const rules = new Set<string>();
    let sawClean = false;
    for (const { source } of CORPUS) {
      const t = checkTuples(source);
      if (t.size === 0) sawClean = true;
      for (const tuple of t) rules.add(tuple.split('|')[0]);
    }
    expect(rules.has('check-override-return')).toBe(true);
    expect(rules.has('check-override-param')).toBe(true);
    expect(sawClean).toBe(true);
  });

  test('multi-param narrow yields exactly ONE param diagnostic (aggregated cardinality)', () => {
    const entry = CORPUS.find((c) => c.label.startsWith('multi-param narrow'));
    if (!entry) throw new Error('missing multi-param corpus entry');
    const params = [...checkTuples(entry.source)].filter((t) => t.startsWith('check-override-param'));
    expect(params).toEqual(['check-override-param|Sub|f']);
  });
});

// ── Live-mutation discrimination (nero C3) ───────────────────────────────────
//
// Two reimplementations of checkProgram whose ONLY change is a widened pair-
// matcher. Each must diverge from the real checkProgram on ≥1 corpus program.

type Diag = Pick<CheckDiagnostic, 'rule' | 'className' | 'memberName'>;

/** Real dispatch reused by both mutants; only `findBaseMember` differs. */
function walkWith(
  source: string,
  findBaseMember: (
    info: ClassInfo,
    member: ClassMemberInfo,
    classByName: ReadonlyMap<string, ClassInfo>,
  ) => ClassMemberInfo | undefined,
): Diag[] {
  const root = parseDocumentWithDiagnostics(source).root;
  const classes = collectClassInfos(root) as readonly ClassInfo[];
  const classByName = new Map<string, ClassInfo>();
  for (const info of classes) if (!classByName.has(info.name)) classByName.set(info.name, info);
  const out: Diag[] = [];
  for (const info of classes) {
    for (const member of info.members) {
      const baseMember = findBaseMember(info, member, classByName);
      if (!baseMember) continue;
      const variance = checkOverrideVariance(member, baseMember, classByName);
      if (variance === 'return-mismatch') {
        out.push({ rule: 'check-override-return', className: info.name, memberName: member.name });
        continue;
      }
      if (variance === 'param-mismatch') {
        out.push({ rule: 'check-override-param', className: info.name, memberName: member.name });
      }
    }
  }
  return out;
}

/** REAL pair-matcher (name AND static). */
function realFindBaseMember(
  info: ClassInfo,
  member: ClassMemberInfo,
  classByName: ReadonlyMap<string, ClassInfo>,
): ClassMemberInfo | undefined {
  let current = info.baseName ? classByName.get(info.baseName) : undefined;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.name)) return undefined;
    visited.add(current.name);
    const found = current.members.find((c) => c.name === member.name && c.static === member.static);
    if (found) return found;
    current = current.baseName ? classByName.get(current.baseName) : undefined;
  }
  return undefined;
}

/** MUTATION (b): ignore STATIC separation — match by name only. */
function mutantIgnoreStatic(
  info: ClassInfo,
  member: ClassMemberInfo,
  classByName: ReadonlyMap<string, ClassInfo>,
): ClassMemberInfo | undefined {
  let current = info.baseName ? classByName.get(info.baseName) : undefined;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.name)) return undefined;
    visited.add(current.name);
    const found = current.members.find((c) => c.name === member.name); // static dropped
    if (found) return found;
    current = current.baseName ? classByName.get(current.baseName) : undefined;
  }
  return undefined;
}

function diagsEqual(a: readonly Diag[], b: readonly Diag[]): boolean {
  const key = (d: Diag) => `${d.rule}|${d.className}|${d.memberName}`;
  const sa = new Set(a.map(key));
  const sb = new Set(b.map(key));
  return setEqual(sa, sb);
}

describe('live-mutation discrimination (nero C3)', () => {
  test('(a) pair-matching that ignores KIND lights ≥1 corpus case', () => {
    // checkOverrideVariance returns null when kinds differ, so a kind-ignoring
    // MATCHER alone cannot change variance verdicts. To prove the matrix kills a
    // kind-blind matcher we widen BOTH the matcher (name-only) AND the variance
    // dispatch to ignore kind — exactly the "pair-matching ignores kind"
    // defect. We compare against the real checkProgram on the corpus.
    let lit = 0;
    for (const { source } of CORPUS) {
      const real = walkWith(source, realFindBaseMember);
      const mutant = walkKindBlind(source);
      if (!diagsEqual(real, mutant)) lit += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`[mutation-a kind-blind pair-matching] lit ${lit} corpus case(s)`);
    expect(lit).toBeGreaterThan(0);
  });

  test('(b) pair-matching that ignores STATIC separation lights ≥1 corpus case', () => {
    let lit = 0;
    for (const { source } of CORPUS) {
      const real = walkWith(source, realFindBaseMember);
      const mutant = walkWith(source, mutantIgnoreStatic);
      if (!diagsEqual(real, mutant)) lit += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`[mutation-b static-blind pair-matching] lit ${lit} corpus case(s)`);
    expect(lit).toBeGreaterThan(0);
  });
});

/**
 * MUTATION (a) body: a checkProgram variant whose pair-matcher ignores kind AND
 * whose variance dispatch ignores the kind guard, so a getter overriding a
 * setter (or any cross-kind pair) is wrongly variance-checked. This is the
 * "pair-matching ignores kind" defect made observable.
 */
function walkKindBlind(source: string): Diag[] {
  const root = parseDocumentWithDiagnostics(source).root;
  const classes = collectClassInfos(root) as readonly ClassInfo[];
  const classByName = new Map<string, ClassInfo>();
  for (const info of classes) if (!classByName.has(info.name)) classByName.set(info.name, info);
  const out: Diag[] = [];
  for (const info of classes) {
    for (const member of info.members) {
      // kind-blind matcher: name + static, kind ignored (so a getter can match a setter).
      let current = info.baseName ? classByName.get(info.baseName) : undefined;
      const visited = new Set<string>();
      let baseMember: ClassMemberInfo | undefined;
      while (current) {
        if (visited.has(current.name)) break;
        visited.add(current.name);
        const found = current.members.find((c) => c.name === member.name && c.static === member.static);
        if (found) {
          baseMember = found;
          break;
        }
        current = current.baseName ? classByName.get(current.baseName) : undefined;
      }
      if (!baseMember) continue;
      // kind-blind variance: treat both members as the OVERRIDER's kind so a
      // cross-kind pair gets variance-checked instead of skipped.
      const coercedBase: ClassMemberInfo = { ...baseMember, kind: member.kind };
      const variance = checkOverrideVariance(member, coercedBase, classByName);
      if (variance === 'return-mismatch') {
        out.push({ rule: 'check-override-return', className: info.name, memberName: member.name });
        continue;
      }
      if (variance === 'param-mismatch') {
        out.push({ rule: 'check-override-param', className: info.name, memberName: member.name });
      }
    }
  }
  return out;
}
