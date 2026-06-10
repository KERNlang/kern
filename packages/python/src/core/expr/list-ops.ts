/**
 * Portable Array → Python lowering — the SINGLE source shared by both Python
 * emission paths:
 *   - the route/expression emitter (`core/expr/index.ts`), and
 *   - the class-method body emitter (`codegen-body-python.ts`).
 *
 * A route handler's `arr.push(x)` and a class method's `arr.push(x)` MUST lower
 * to the same Python. Before this module the two emitters open-coded their own
 * dispatch tables and drifted — the route path lowered `.push`, the class path
 * did not, so `this.items.push(x)` inside a class method emitted invalid
 * `self.items.push(x)`. Routing both paths through one function makes the
 * portable lowering identical by construction (the parity invariant KERN
 * exists to enforce), so the two can never drift again.
 *
 * The TypeScript target keeps the native host syntax (`arr.push(x)` already
 * returns the new length); only Python needs a shim, so this module is
 * Python-only.
 *
 * Scope note: the lambda-taking methods (`.map`/`.filter`) are NOT shared here.
 * They operate on representation-specific inputs (the route path rewrites arrow
 * *strings*; the class path lowers `ValueIR` *lambdas*), so a single
 * string-based helper cannot express them cleanly — each path keeps its own.
 *
 * Migrated into this shared source: `.length` (property hook), `.slice`, and
 * single-arg `.concat`. They were previously route-only, so a class method's
 * `this.items.length` emitted invalid `self.items.length`; routing them here
 * makes both paths identical by construction.
 *   - `.length` (property hook, arg-free by construction): JS `.length` works on
 *     arrays AND strings, and Python `len()` on lists AND strings — so the blind
 *     syntactic lowering `recv.length → len(recv)` is parity-correct (the same
 *     dual-type precedent the `.push`/`.slice` shims rely on). The documented
 *     tradeoff: an object with a literal `length` property would lower wrongly,
 *     which is out of scope (see the route/class hooks' Out-of-scope note).
 *   - `.slice`: all 4 JS arg combos — none → `recv[:]`, start only →
 *     `recv[start:]`, end only → `recv[:end]`, both → `recv[start:end]`. There is
 *     NO `None`-sentinel convention; the absent bound is simply omitted.
 *   - `.concat`: SINGLE-ARG ONLY — `recv + (x if isinstance(x, list) else [x])`
 *     (array arg spread, scalar arg appended). Multi-arg concat returns null
 *     (caller falls through — the same gap as before the migration).
 *
 * The remaining scalar methods (`.includes`/`.indexOf`/`.join`/`.some`/`.every`/
 * `.reduce*`/`.sort`/`.flat`/`.at`/`.reverse`/`.fill`/`.lastIndexOf`) stay
 * route-only (no class-path counterpart yet, so no drift). This module owns the
 * methods that are actually shared.
 */

/**
 * Method names this module lowers. Kept module-private (reached only through the
 * `isSharedPortableArrayMethod` predicate) so the gate cannot be mutated by a
 * consumer — exporting the `Set` itself would be a runtime footgun, since a
 * `ReadonlySet` type does not freeze the underlying `Set`.
 */
const SHARED_PORTABLE_ARRAY_METHODS: ReadonlySet<string> = new Set(['push', 'slice', 'concat']);

/**
 * Property names this module lowers (arg-free, non-call member access). Kept
 * module-private behind `isSharedPortableArrayProperty` for the same
 * mutation-safety reason as the method set above.
 */
const SHARED_PORTABLE_ARRAY_PROPERTIES: ReadonlySet<string> = new Set(['length']);

/**
 * True when `method` is a portable Array method this module lowers. A peek-style
 * caller (the class-method body emitter) gates on this BEFORE emitting receiver
 * and argument strings, avoiding duplicated emission when the method isn't ours.
 */
export function isSharedPortableArrayMethod(method: string): boolean {
  return SHARED_PORTABLE_ARRAY_METHODS.has(method);
}

/**
 * Lower a portable Array *method call* to its Python form, operating purely on
 * already-emitted receiver/argument strings so both call sites (which hold
 * different input representations) can delegate to it. Returns `null` when the
 * method is not a shared portable method, so callers fall through to their
 * existing handling.
 */
export function lowerPortableArrayMethodPy(receiver: string, method: string, args: string[]): string | null {
  if (method === 'push' && args.length === 1) {
    // JS `Array.push` mutates AND returns the new length; Python `list.append`
    // mutates but returns `None`. `(recv.append(x) or len(recv))` reproduces
    // both effects: append runs, then the falsy `None` yields to `len(recv)`,
    // which is always >= 1 after an append — exact parity with the JS return.
    return `(${receiver}.append(${args[0]}) or len(${receiver}))`;
  }
  if (method === 'slice') {
    // COPIED VERBATIM from the route path's slice lowering (the canonical source
    // before this migration). JS `Array.slice(start, end)` maps directly to a
    // Python slice; an absent bound is OMITTED (no `None` sentinel). Negative
    // indices work identically in both. The receiver is named once.
    const start = args[0];
    const end = args[1];
    if (!start && !end) return `${receiver}[:]`;
    if (start && !end) return `${receiver}[${start}:]`;
    if (!start && end) return `${receiver}[:${end}]`;
    return `${receiver}[${start}:${end}]`;
  }
  if (method === 'concat' && args.length === 1) {
    // COPIED VERBATIM from the route path's concat lowering. JS `Array.concat`
    // returns a NEW array; an array arg is spread, a scalar arg is appended.
    // `recv + (x if isinstance(x, list) else [x])` mirrors both. Single-arg
    // only; multi-arg concat returns null so the caller falls through (the same
    // gap as the pre-migration route path).
    return `(${receiver} + (${args[0]} if isinstance(${args[0]}, list) else [${args[0]}]))`;
  }
  return null;
}

/**
 * True when `name` is a portable Array property this module lowers (`'length'`).
 * A peek-style caller gates on this BEFORE emitting the property access, so a
 * non-shared property falls through to the existing `recv.prop` handling.
 */
export function isSharedPortableArrayProperty(name: string): boolean {
  return SHARED_PORTABLE_ARRAY_PROPERTIES.has(name);
}

/**
 * Lower a portable Array *property read* to its Python form, operating on the
 * already-emitted receiver string. `'length'` → `len(recv)`; anything else →
 * `null` (caller falls through). Arg-free by construction — a property access
 * has no arguments — so there is no arity to gate on.
 */
export function lowerPortableArrayPropertyPy(receiver: string, name: string): string | null {
  if (name === 'length') {
    // JS `.length` reads array/string length; Python `len()` does both, so the
    // blind syntactic lowering is parity-correct (same dual-type precedent as
    // the `.slice` shim above).
    return `len(${receiver})`;
  }
  return null;
}
