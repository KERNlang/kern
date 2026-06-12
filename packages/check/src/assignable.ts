/**
 * @kernlang/check — nominal assignability core.
 *
 * Pure functions lifted VERBATIM (logic-identical, signature-identical) from
 * packages/core/src/semantic-validator.ts so the Liskov subtype / override-
 * variance checks can be consumed standalone. The originals remain the source
 * of truth; tests/equivalence.test.ts asserts this lift is behaviourally
 * identical to them on every matrix cell.
 *
 * Structural types below mirror EXACTLY the fields the two functions read from
 * core's `ClassInfo` / `ClassMemberInfo` (name/baseName, and
 * kind/arity/returns/paramTypes). They are intentionally narrow so this package
 * carries no compile-time dependency on core's internals; core's real
 * `ClassInfo`/`ClassMemberInfo` are structurally assignable to them.
 */

/** Member kind, matching core's `ClassMemberKind`. */
export type ClassMemberKind = 'field' | 'method' | 'getter' | 'setter';

/**
 * Structural subset of core's `ClassInfo` consumed by {@link isNominalSubtype}:
 * the nominal name and its (optional) base-class name for the subtype walk.
 */
export interface NominalClassInfo {
  name: string;
  baseName?: string;
}

/**
 * Structural subset of core's `ClassMemberInfo` consumed by
 * {@link checkOverrideVariance}: kind, arity, return type, and param types.
 */
export interface OverrideMemberInfo {
  kind: ClassMemberKind;
  arity: number;
  returns?: string;
  paramTypes: readonly string[];
}

/**
 * Nominal subtype check: is `sub` a (non-strict) subtype of `sup`?
 *  - undefined on either side → 'unknown' (gradual: caller skips).
 *  - sub === sup → true.
 *  - either name not a known class in classByName → 'unknown' (primitives /
 *    external / unresolved types are not compared).
 *  - else cycle-safe walk of sub's baseName chain; reaching sup → true; chain
 *    ends or cycles without reaching sup → false.
 *
 * Lifted verbatim from semantic-validator.ts:isNominalSubtype.
 */
export function isNominalSubtype(
  sub: string | undefined,
  sup: string | undefined,
  classByName: ReadonlyMap<string, NominalClassInfo>,
): true | false | 'unknown' {
  if (sub === undefined || sup === undefined) return 'unknown';
  if (sub === sup) return true;
  if (!classByName.has(sub) || !classByName.has(sup)) return 'unknown';
  let current = classByName.get(sub);
  const visited = new Set<string>();
  while (current) {
    if (current.name === sup) return true;
    if (visited.has(current.name)) return false;
    visited.add(current.name);
    current = current.baseName ? classByName.get(current.baseName) : undefined;
  }
  return false;
}

/**
 * Liskov substitutability check for a member override against its base member.
 *
 * Runs ONLY when kinds are strictly equal (method/method, getter/getter,
 * setter/setter). Mixed accessor pairs (getter overriding setter, or vice
 * versa) and fields return null (skip) to preserve existing behavior. For
 * methods, it assumes arity has already matched (arity-mismatch fires first).
 *
 * Variance rules:
 *  - Return position is COVARIANT: an override may narrow the return type
 *    (override.returns must be a subtype of base.returns). A non-subtype is a
 *    'return-mismatch'.
 *  - Param positions are CONTRAVARIANT: an override may widen a param type
 *    (base.paramTypes[i] must be a subtype of override.paramTypes[i]). A
 *    non-subtype is a 'param-mismatch'.
 *
 * 'unknown' subtype results (gradual typing — primitives, unannotated, or
 * non-class names) are skipped, so the check produces zero false positives.
 *
 * Lifted verbatim from semantic-validator.ts:checkOverrideVariance.
 */
export function checkOverrideVariance(
  member: OverrideMemberInfo,
  baseMember: OverrideMemberInfo,
  classByName: ReadonlyMap<string, NominalClassInfo>,
): 'return-mismatch' | 'param-mismatch' | null {
  if (member.kind !== baseMember.kind) return null;
  if (member.kind === 'field') return null;
  if (member.kind === 'method') {
    if (member.arity !== baseMember.arity) return null;
    if (isNominalSubtype(member.returns, baseMember.returns, classByName) === false) {
      return 'return-mismatch';
    }
    for (let index = 0; index < member.paramTypes.length; index += 1) {
      if (isNominalSubtype(baseMember.paramTypes[index], member.paramTypes[index], classByName) === false) {
        return 'param-mismatch';
      }
    }
    return null;
  }
  if (member.kind === 'getter') {
    if (isNominalSubtype(member.returns, baseMember.returns, classByName) === false) {
      return 'return-mismatch';
    }
    return null;
  }
  // setter: param position 0 only, same contravariant direction.
  if (isNominalSubtype(baseMember.paramTypes[0], member.paramTypes[0], classByName) === false) {
    return 'param-mismatch';
  }
  return null;
}

/** Result of {@link assignable}. */
export interface AssignableResult {
  ok: true | false | 'unknown';
  reason?: string;
}

/**
 * Ergonomic wrapper over {@link isNominalSubtype}: is a value of nominal type
 * `src` assignable to a slot of nominal type `dst`? Assignability here is
 * (non-strict) nominal subtyping — `src` must be `dst` or a descendant of it.
 *
 * Returns `{ ok }` mirroring the tri-state subtype result, with a human reason
 * on the false / unknown branches.
 */
export function assignable(
  src: string | undefined,
  dst: string | undefined,
  classByName: ReadonlyMap<string, NominalClassInfo>,
): AssignableResult {
  const result = isNominalSubtype(src, dst, classByName);
  if (result === true) return { ok: true };
  if (result === 'unknown') {
    return {
      ok: 'unknown',
      reason: `cannot decide ${describe(src)} <: ${describe(dst)} (non-class or undefined name)`,
    };
  }
  return { ok: false, reason: `${describe(src)} is not a subtype of ${describe(dst)}` };
}

function describe(name: string | undefined): string {
  return name === undefined ? 'undefined' : name;
}
