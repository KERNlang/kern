/**
 * Normalized observable traces — the single comparison surface for differential parity.
 *
 * A trace is an ordered list of observable events plus a completion record.
 * Comparison is structural equality on traces, NOT on emitter strings or raw runtime values.
 *
 * Normalization rules (enforced by [[harness]] before comparison):
 *   - RNG seeded; clocks frozen.
 *   - Errors canonicalized to {kind, messagePattern} — never raw exception text.
 *   - Event order is the source of truth for side-effect ordering.
 */

export type CompletionKind = 'normal' | 'return' | 'throw' | 'break' | 'continue';

export interface CompletionRecord {
  kind: CompletionKind;
  /** Present on `return`. Structurally cloned at write time. */
  value?: unknown;
  /** Present on `throw`. Canonicalized error shape. */
  error?: CanonicalError;
  /** Present on `break`/`continue` if a label was specified. */
  label?: string;
}

/**
 * Canonical error shape. Cross-target equality compares `kind` exactly and
 * `messagePattern` as a regex match against the runtime error message —
 * NOT raw text, which diverges between V8 and CPython.
 *
 * `message` carries an EVALUATED LITERAL message and is ONLY set for an
 * EXPLICIT `throw new Error("…")` body-statement (where the message text is
 * authored as a string literal and is therefore byte-identical across V8 and
 * CPython — `Error("x").message` === `str(Exception("x"))`). It exists so a
 * caught-binding `.message` read can return the exact literal. The
 * messagePattern-based canonicalization (used by the fixture differential
 * harness for IMPLICIT/primitive throws, whose raw text diverges) is left
 * untouched: `message` and `messagePattern` are independent, and an error may
 * carry either, both, or neither.
 */
export interface CanonicalError {
  kind: string;
  messagePattern?: RegExp;
  /** Evaluated literal message of an explicit `throw new Error("…")`. */
  message?: string;
}

export type TraceEvent =
  | { op: 'stdout'; text: string }
  | { op: 'stderr'; text: string }
  | { op: 'assign'; target: string; value: unknown }
  | { op: 'call'; fn: string; args: unknown[] }
  | { op: 'iter-next'; binding: string; value: unknown }
  | { op: 'iter-done' }
  | { op: 'enter'; nodeType: string }
  | { op: 'exit'; nodeType: string };

export interface Trace {
  events: TraceEvent[];
  completion: CompletionRecord;
}

/** Empty starter trace — used by reference runner before any event is recorded. */
export function emptyTrace(): Trace {
  return { events: [], completion: { kind: 'normal' } };
}

/**
 * Structural trace equality. Two traces are equal iff their event lists match
 * element-wise and their completion records agree on kind + value/error.
 * `RegExp` patterns compare by source+flags, not identity.
 */
export function tracesEqual(a: Trace, b: Trace): boolean {
  if (a.events.length !== b.events.length) return false;
  for (let i = 0; i < a.events.length; i += 1) {
    if (!eventsEqual(a.events[i], b.events[i])) return false;
  }
  return completionsEqual(a.completion, b.completion);
}

/**
 * Recursive structural equality for trace payloads. Handles the cross-target
 * surface honestly:
 *
 *   - `Object.is` for primitive identity so `NaN === NaN` and `+0 !== -0`.
 *   - `undefined` is a real value, not silently dropped (vs `JSON.stringify`).
 *   - `RegExp` compares by source + flags.
 *   - `Map` and `Set` get true structural comparison (not `{}`).
 *   - Arrays and plain objects recurse.
 *   - Circular references throw — traces should never contain cycles.
 *
 * Exported so contracts that need bespoke comparison can reuse it.
 */
export function deepEqual(a: unknown, b: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  // Object.is for primitives so `NaN === NaN` is true and `+0 !== -0`. We do NOT
  // short-circuit on `Object.is(a, b)` for objects — that would skip the circular
  // detection below when callers pass the same reference twice.
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return Object.is(a, b);
  if (seen.has(a as object)) {
    throw new Error('deepEqual: circular reference in trace value');
  }
  seen.add(a as object);
  if (a === b) {
    // Same object reference, no cycles below this point — equal. But we already
    // marked `a` in `seen`, so a later visit through a cycle still throws.
    return true;
  }

  if (a instanceof RegExp || b instanceof RegExp) {
    return a instanceof RegExp && b instanceof RegExp && a.source === b.source && a.flags === b.flags;
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map)) return false;
    if (a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (!b.has(k)) return false;
      if (!deepEqual(v, b.get(k), seen)) return false;
    }
    return true;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set)) return false;
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i], seen)) return false;
    }
    return true;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.hasOwn(b as object, k)) return false;
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    if (!deepEqual(va, vb, seen)) return false;
  }
  return true;
}

export function eventsEqual(a: TraceEvent, b: TraceEvent): boolean {
  if (a.op !== b.op) return false;
  return deepEqual(a, b);
}

export function completionsEqual(a: CompletionRecord, b: CompletionRecord): boolean {
  if (a.kind !== b.kind) return false;
  if (a.label !== b.label) return false;
  if (!deepEqual(a.value, b.value)) return false;
  if (!a.error && !b.error) return true;
  if (!a.error || !b.error) return false;
  if (a.error.kind !== b.error.kind) return false;
  // Evaluated literal message (explicit `throw new Error("…")`). Additive: when
  // both sides omit it (the messagePattern-canonicalized path), this is a no-op.
  if (a.error.message !== b.error.message) return false;
  if (!a.error.messagePattern && !b.error.messagePattern) return true;
  if (!a.error.messagePattern || !b.error.messagePattern) return false;
  return (
    a.error.messagePattern.source === b.error.messagePattern.source &&
    a.error.messagePattern.flags === b.error.messagePattern.flags
  );
}
