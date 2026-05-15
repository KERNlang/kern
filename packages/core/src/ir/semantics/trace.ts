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
 */
export interface CanonicalError {
  kind: string;
  messagePattern?: RegExp;
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

function eventsEqual(a: TraceEvent, b: TraceEvent): boolean {
  if (a.op !== b.op) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function completionsEqual(a: CompletionRecord, b: CompletionRecord): boolean {
  if (a.kind !== b.kind) return false;
  if (a.label !== b.label) return false;
  if (JSON.stringify(a.value) !== JSON.stringify(b.value)) return false;
  if (!a.error && !b.error) return true;
  if (!a.error || !b.error) return false;
  if (a.error.kind !== b.error.kind) return false;
  if (!a.error.messagePattern && !b.error.messagePattern) return true;
  if (!a.error.messagePattern || !b.error.messagePattern) return false;
  return (
    a.error.messagePattern.source === b.error.messagePattern.source &&
    a.error.messagePattern.flags === b.error.messagePattern.flags
  );
}
