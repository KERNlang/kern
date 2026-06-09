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
 * The remaining scalar methods (`.length`, `.slice`, `.concat`, …) are a
 * tracked follow-up; today they are route-only (no class-path counterpart, so
 * no drift). This module owns the methods that are actually shared.
 */

/**
 * Method names this module lowers. Kept module-private (reached only through the
 * `isSharedPortableArrayMethod` predicate) so the gate cannot be mutated by a
 * consumer — exporting the `Set` itself would be a runtime footgun, since a
 * `ReadonlySet` type does not freeze the underlying `Set`.
 */
const SHARED_PORTABLE_ARRAY_METHODS: ReadonlySet<string> = new Set(['push']);

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
  return null;
}
