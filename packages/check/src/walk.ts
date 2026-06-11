/**
 * @kernlang/check — declaration walker over IR (slice 2).
 *
 * `checkProgram` walks the class declarations of a parsed KERN program and
 * reports Liskov override-variance violations plus a probe-derived duplicate-
 * class rule. It is the standalone twin of core's `validateClassOverrides`
 * (semantic-validator.ts:validateClassOverrides) over the two override rules
 * it shares with that validator.
 *
 * REUSE, NOT MIRROR (nero C1): the IR→ClassInfo extraction is the validator's
 * OWN `collectClassInfos` builder, exported additively from core. We do NOT
 * re-implement member collection — that would invite extraction drift. The
 * only logic re-implemented here is the cross-package-safe pair-matching and
 * the rule dispatch, both mirroring the validator verbatim:
 *
 *   - pair-matching mirrors `findBaseMember`: walk the base chain via
 *     `classByName`, matching a base member by `name === member.name &&
 *     static === member.static` (statics are SEPARATED — probe 2), cycle-safe
 *     via a visited set.
 *   - variance dispatch reuses the lifted `checkOverrideVariance` and mirrors
 *     `validateClassOverrides`'s control flow: a return-mismatch short-circuits
 *     (no param check — probe 4 / "continue" semantics), and a member's param
 *     verdict is AGGREGATED to a single diagnostic (probe 3: one per member,
 *     not one per offending param).
 *
 * DUPLICATE rule (probe-derived, nero C2): the live validator DOES emit a
 * diagnostic for duplicate class names (`duplicate-sibling-name`), keeping the
 * FIRST declaration in `classByName` (probe 1). `checkProgram` mirrors that
 * observable behaviour: it reports `check-duplicate-class` for every class
 * declaration after the first of a given name, and the first declaration wins
 * the override base resolution. This rule lives OUTSIDE the structural
 * equivalence surface (which compares only the two override rules); it is
 * gated by the zero-FP corpus plus a positive duplicate fixture.
 */

import type { ClassInfo, ClassMemberInfo } from '../../core/dist/semantic-validator.js';
import { collectClassInfos } from '../../core/dist/semantic-validator.js';
import { checkOverrideVariance } from './assignable.js';
import type { IRNode } from './shared.js';

/** A node accepted by the reused core builder. Canonical definition lives in
 *  `shared.ts` (single source — agon review); re-exported here so slice-2
 *  consumers keep importing it from this module unchanged. */
export type { IRNode } from './shared.js';

/** A check rule identifier. The two override rules are the structural-
 *  equivalence surface shared with core's validator; the duplicate rule is
 *  probe-derived and gated separately. */
export type CheckRule = 'check-override-return' | 'check-override-param' | 'check-duplicate-class';

/** A single diagnostic produced by {@link checkProgram}. */
export interface CheckDiagnostic {
  rule: CheckRule;
  className: string;
  memberName?: string;
  reason: string;
}

/**
 * Walk a parsed KERN program's class declarations and report override-variance
 * and duplicate-class violations.
 *
 * @param root the parsed program IR (a `module`/document root).
 */
export function checkProgram(root: IRNode): CheckDiagnostic[] {
  const diagnostics: CheckDiagnostic[] = [];

  // Reuse core's builder verbatim — zero extraction drift by construction.
  const classes = collectClassInfos(root as never) as readonly ClassInfo[];

  // classByName mirrors the validator: FIRST declaration of a name wins
  // (semantic-validator.ts:validateClassGraphRoots — `if (!prev) set`).
  const classByName = new Map<string, ClassInfo>();
  for (const info of classes) {
    if (!classByName.has(info.name)) {
      classByName.set(info.name, info);
    } else {
      // Probe-derived duplicate rule: the live validator emits a diagnostic for
      // every class after the first of a given name (probe 1, first-wins).
      const first = classByName.get(info.name);
      diagnostics.push({
        rule: 'check-duplicate-class',
        className: info.name,
        reason:
          first?.node.loc?.line !== undefined
            ? `Duplicate class '${info.name}' — first defined at line ${first.node.loc.line}`
            : `Duplicate class '${info.name}'`,
      });
    }
  }

  // Override-variance walk — mirrors validateClassOverrides over its two
  // shared rules. Iterate the ORIGINAL class list (every declaration, like the
  // validator) but resolve bases through the first-wins classByName.
  for (const info of classes) {
    for (const member of info.members) {
      const baseMember = findBaseMember(info, member, classByName);
      if (!baseMember) continue;
      const variance = checkOverrideVariance(member, baseMember, classByName);
      if (variance === 'return-mismatch') {
        diagnostics.push({
          rule: 'check-override-return',
          className: info.name,
          memberName: member.name,
          reason:
            `Class '${info.name}' member '${member.name}' overrides a base member returning ` +
            `'${baseMember.returns}' with return type '${member.returns}'. Overrides must be ` +
            `covariant in their return type (the override's return must be a subtype of the base's).`,
        });
        // 'continue' semantics (probe 4): a return-mismatch suppresses the
        // param check for the same member.
        continue;
      }
      if (variance === 'param-mismatch') {
        // Aggregated cardinality (probe 3): one diagnostic per member, not per
        // offending param.
        diagnostics.push({
          rule: 'check-override-param',
          className: info.name,
          memberName: member.name,
          reason:
            `Class '${info.name}' member '${member.name}' narrows a parameter type when ` +
            `overriding a base member. Overrides must be contravariant in their parameter types ` +
            `(the override's parameter must be a supertype of the base's).`,
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Find the nearest base-chain member that `member` overrides — verbatim mirror
 * of core's `findBaseMember`. Walks `info.baseName` through `classByName`,
 * matching by name AND static-ness (statics are separated from instance
 * members — probe 2). Cycle-safe via a visited set.
 */
function findBaseMember(
  info: ClassInfo,
  member: ClassMemberInfo,
  classByName: ReadonlyMap<string, ClassInfo>,
): ClassMemberInfo | undefined {
  let current = info.baseName ? classByName.get(info.baseName) : undefined;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.name)) return undefined;
    visited.add(current.name);
    const found = current.members.find(
      (candidate) => candidate.name === member.name && candidate.static === member.static,
    );
    if (found) return found;
    current = current.baseName ? classByName.get(current.baseName) : undefined;
  }
  return undefined;
}
