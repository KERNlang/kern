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
 * Migrated in the scalar-method sweep: the 8 argument-shape (non-lambda) scalar
 * methods `.includes`/`.indexOf`/`.join`/`.flat`/`.reverse`/`.at`/`.fill`/
 * `.lastIndexOf`. They were previously route-only, so a class method's
 * `this.items.includes(x)` emitted invalid `self.items.includes(x)`; routing them
 * here lowers both paths identically by construction. Their lowerings are byte-
 * copied from the route path (the canonical source pre-sweep).
 *
 * The remaining methods that stay per-path BY DESIGN are the lambda-bearing ones
 * (`.some`/`.every`/`.map`/`.filter`/`.reduce`/`.reduceRight`/`.sort`/the
 * `.find`-family): they operate on representation-specific inputs (route rewrites
 * arrow *strings*; the class path lowers `ValueIR` *lambdas*), so a single
 * string-based helper cannot express them cleanly — each path keeps its own.
 */

/**
 * Method names this module lowers. Kept module-private (reached only through the
 * `isSharedPortableArrayMethod` predicate) so the gate cannot be mutated by a
 * consumer — exporting the `Set` itself would be a runtime footgun, since a
 * `ReadonlySet` type does not freeze the underlying `Set`.
 */
const SHARED_PORTABLE_ARRAY_METHODS: ReadonlySet<string> = new Set([
  'push',
  'slice',
  'concat',
  'includes',
  'indexOf',
  'join',
  'flat',
  'reverse',
  'at',
  'fill',
  'lastIndexOf',
]);

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
 * Methods whose lowering names the RECEIVER more than once (or mutates it),
 * so a side-effectful receiver — `makeBox().items.reverse()` — would run its
 * effects twice on Python and break JS parity. The class-body emitter gates
 * these on a provably-pure receiver; single-eval methods (slice/includes/
 * join/flat/concat) accept impure receivers. (`indexOf` moved INTO this set
 * when its str-receiver branch landed — the isinstance probe names the
 * receiver again.)
 * Receiver eval counts: push x2, reverse x2, at x3, fill x1-4 (3-arg form),
 * indexOf x2-3 (isinstance probe + the chosen str/array branch), lastIndexOf x4.
 * NOT tracked: argument multi-eval (concat arg x3, at n x3, indexOf needle x2,
 * lastIndexOf needle x3, fill bounds multi) — the route path has no purity
 * analysis at all and lowers impure args blindly; the class path matches that
 * behavior for args (documented divergence, candidate follow-up).
 */
const PURE_RECEIVER_REQUIRED: ReadonlySet<string> = new Set([
  'push',
  'reverse',
  'at',
  'fill',
  'indexOf',
  'lastIndexOf',
]);

export function sharedPortableMethodRequiresPureReceiver(method: string): boolean {
  return PURE_RECEIVER_REQUIRED.has(method);
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
  // COPIED VERBATIM from the route path's inline branches (the canonical source
  // before the scalar-method sweep), including the `??` arg defaults — byte-
  // identity with the route lowerings is a hard requirement so routes and class
  // methods can't drift.
  if (method === 'includes') {
    const needle = args[0] ?? '';
    return `(${needle} in ${receiver})`;
  }
  if (method === 'indexOf') {
    const needle = args[0] ?? '';
    const fromIndex = args[1] ?? null;
    // String receivers use str.find (correct for multi-char substrings, -1 when
    // absent); array receivers scan by element equality. Mirrors lastIndexOf's
    // str/array split below. JS `"hello".indexOf("ll")` is 2 — the old element
    // scan treated the string char-by-char and never matched the 2-char needle.
    if (fromIndex) {
      // JS CLAMPS a negative fromIndex to 0 on string receivers; Python's
      // str.find treats a negative start as from-the-end — `max(…, 0)` keeps
      // parity ("hello".indexOf("h", -2) is 0 in JS). The ARRAY branch's
      // negative-fromIndex semantics (JS counts from the end there) remain a
      // pre-existing route divergence — documented, deferred.
      return `(${receiver}.find(${needle}, max(${fromIndex}, 0)) if isinstance(${receiver}, str) else (next((__i for __i, __v in enumerate(${receiver}) if __i >= ${fromIndex} and __v == ${needle}), -1)))`;
    }
    return `(${receiver}.find(${needle}) if isinstance(${receiver}, str) else (next((__i for __i, __v in enumerate(${receiver}) if __v == ${needle}), -1)))`;
  }
  if (method === 'join') {
    // Treat an EMPTY arg as absent (default to comma): the route path's
    // `splitTopLevelArgs('')` returns `['']` for a bare `.join()`, so `args[0]`
    // is the empty STRING (not undefined) and `?? '","'` would keep it, emitting
    // an invalid `.join(...)` with no separator. `args[0] ? args[0] : '","'`
    // falls back to the JS default comma. The class path never produces '' here.
    const sep = args[0] ? args[0] : '","';
    return `${sep}.join(str(__v) for __v in ${receiver})`;
  }
  if (method === 'flat') {
    // one level: flatten nested lists, keep scalars
    return `[__y for __x in ${receiver} for __y in (__x if isinstance(__x, list) else [__x])]`;
  }
  if (method === 'reverse') {
    // JS Array.reverse mutates AND returns the (same, reversed) array; Python
    // list.reverse returns None -> `(recv.reverse() or recv)` mutates + returns it.
    return `(${receiver}.reverse() or ${receiver})`;
  }
  if (method === 'at') {
    const n = args[0] ?? '0';
    return `(${receiver}[${n}] if -len(${receiver}) <= ${n} < len(${receiver}) else None)`;
  }
  if (method === 'fill') {
    const v = args[0] ?? 'None';
    if (args.length <= 1) {
      return `[${v} for __ in ${receiver}]`;
    }
    // fill(value, start, end) fills [start, end) with JS negative-index
    // normalization; untouched positions keep their original element.
    const s = args[1];
    const e = args[2] ?? `len(${receiver})`;
    return `[(${v} if (${s} if ${s} >= 0 else ${s} + len(${receiver})) <= __i < (${e} if ${e} >= 0 else ${e} + len(${receiver})) else __x) for __i, __x in enumerate(${receiver})]`;
  }
  if (method === 'lastIndexOf') {
    const needle = args[0] ?? '';
    // String receivers use rfind (correct for multi-char substrings, -1 when
    // absent); array receivers reverse-scan by element equality.
    return `(${receiver}.rfind(${needle}) if isinstance(${receiver}, str) else (len(${receiver}) - 1 - ${receiver}[::-1].index(${needle}) if ${needle} in ${receiver} else -1))`;
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
