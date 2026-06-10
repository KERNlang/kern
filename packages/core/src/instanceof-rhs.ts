/** Shared `instanceof` right-hand-side (RHS) classification — the single
 *  source of truth for which `x instanceof <RHS>` shapes KERN lowers, maps to a
 *  host type, or rejects fail-closed.
 *
 *  Two consumers share this table so the eligibility gate and the Python
 *  lowerer cannot drift (defense in depth — see native-eligibility-ast.ts §3
 *  and codegen-body-python.ts):
 *
 *    - the native-eligibility classifier walks the TS AST and rejects a body
 *      whose `instanceof` RHS is in the reject set (so the migrator never lifts
 *      an unlowerable body), and
 *    - the Python emitter both MAPS the accepted host RHS (`Array`→`list`,
 *      `Error`→`Exception`) and THROWS on a rejected RHS (so a gate bug can
 *      never silently emit a wrong-parity `isinstance`).
 *
 *  ## Why these RHS names are rejected (wrapper-parity trap)
 *  In JS, primitives are NOT instances of their wrapper objects:
 *  `"s" instanceof String` is `false`, but Python's `isinstance("s", str)` is
 *  `True`. There is no host type whose membership matches JS `instanceof`
 *  semantics for these, so they fail closed rather than emit wrong-parity code.
 *  `Object`/`Function`/`Date`/`RegExp`/`Promise`/`Map`/`Set`/`Symbol`/`BigInt`
 *  have no verified cross-target host mapping either (v2).
 *
 *  ## Accepted host RHS
 *    - `Array` → `list`      (`[1,2] instanceof Array` ≡ `isinstance(x, list)`)
 *    - `Error` → `Exception` (KERN-thrown errors lower to `Exception`, so
 *      `e instanceof Error` ≡ `isinstance(e, Exception)`; mirrors the
 *      `new Error(...)` → `Exception(...)` mapping in the Python emitter).
 *  `TypeError` is intentionally NOT listed: it maps to Python's native
 *  `TypeError` (same name) and emits as-is. RangeError/SyntaxError/etc. stay
 *  status-quo (emit as-is) — host mapping for them is v2.
 *
 *  Any RHS ident NOT in the reject set and NOT in the accept map emits as-is:
 *  user classes work (same-file Python classes), and an unknown name fails loud
 *  at Python runtime with `NameError` (registry-precedence hardening is v2). */

/** Reject reasons surfaced by the eligibility classifier and the emitter.
 *  Kebab-case slugs so `kern migrate`/`kern review` give actionable hints. */
export type InstanceofRhsRejectReason =
  | 'instanceof-rhs-wrapper-rejected'
  | 'instanceof-rhs-unsupported-builtin'
  | 'instanceof-rhs-not-a-type-name';

/** Primitive-wrapper RHS — the wrapper-parity trap (`"s" instanceof String`
 *  is FALSE in JS, `isinstance("s", str)` is True). */
export const INSTANCEOF_RHS_WRAPPER_REJECT: ReadonlySet<string> = new Set(['String', 'Number', 'Boolean']);

/** Built-in RHS with no verified cross-target host mapping (v2). */
export const INSTANCEOF_RHS_BUILTIN_REJECT: ReadonlySet<string> = new Set([
  'Object',
  'Function',
  'Date',
  'RegExp',
  'Promise',
  'Map',
  'Set',
  'Symbol',
  'BigInt',
]);

/** Accepted host-global RHS → Python type the `isinstance` call uses. */
const INSTANCEOF_RHS_PYTHON_MAP: ReadonlyMap<string, string> = new Map([
  ['Array', 'list'],
  ['Error', 'Exception'],
]);

/** The Python `isinstance` second argument for an accepted host-global RHS
 *  ident, or `null` when the name carries no host mapping (a user class /
 *  member RHS that emits as-is). Does NOT consult the reject set — callers
 *  reject first (see `instanceofRhsRejectReasonForName`). */
export function instanceofRhsPythonType(name: string): string | null {
  return INSTANCEOF_RHS_PYTHON_MAP.get(name) ?? null;
}

/** Reject reason for a bare RHS ident `name`, or `null` if the ident is
 *  acceptable (an accepted host global, a user class, or any other name that
 *  emits as-is). Non-ident RHS (call/literal/binary) is classified by the
 *  caller as `instanceof-rhs-not-a-type-name`. */
export function instanceofRhsRejectReasonForName(name: string): InstanceofRhsRejectReason | null {
  if (INSTANCEOF_RHS_WRAPPER_REJECT.has(name)) return 'instanceof-rhs-wrapper-rejected';
  if (INSTANCEOF_RHS_BUILTIN_REJECT.has(name)) return 'instanceof-rhs-unsupported-builtin';
  return null;
}
