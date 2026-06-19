/**
 * Slice 0 — the THIN core-runtime ↔ ReferenceRunner parity probe.
 *
 * packages/core ships TWO disjoint TS interpreters that have never been
 * cross-checked:
 *   - core-runtime (product):  `evalCoreExpression(expr, env) -> KernValue`.
 *   - ReferenceRunner (oracle): `referenceRun(node, env) -> Trace`.
 *
 * This module observes each engine's serialized OBSERVABLE output for a literal
 * expression string, reducing BOTH sides to the same comparison type (a raw JS
 * scalar / CoreFixtureValue) through the EXISTING serializers — no new
 * serializer, no per-fixture / per-value-kind branching. That sameness is the
 * THIN invariant the Slice-0 gate proves.
 */

import { kernValueToCoreFixtureValue } from '../../core-runtime/contract-adapter.js';
import { createCoreRuntimeEnv, evalCoreExpression, type KernValue } from '../../core-runtime/index.js';
import { makeEnv, ReferenceRunnerError, referenceRun } from './index.js';
import type { Trace } from './trace.js';

/** Result of observing one engine. `value` is present only when `ok === true`. */
export interface Observed {
  ok: boolean;
  value?: unknown;
}

/**
 * Observe the core-runtime (product) leg.
 *
 * Only the EVALUATION step is wrapped in the reject-catch: a throw from
 * `evalCoreExpression` is the engine's genuine reject path. Serialization runs
 * OUTSIDE the catch on purpose — a `kernValueToCoreFixtureValue` failure is a
 * PROBE bug (an accepted value the probe cannot serialize), not a language
 * reject, so it must propagate and fail the test loudly rather than masquerade
 * as `{ ok: false }`. (Review consensus: the original blanket catch conflated
 * the two and would have produced false parity.)
 */
export function observeCore(expr: string): Observed {
  let value: KernValue;
  try {
    value = evalCoreExpression(expr, createCoreRuntimeEnv());
  } catch {
    return { ok: false };
  }
  return { ok: true, value: kernValueToCoreFixtureValue(value) };
}

/**
 * Observe the ReferenceRunner (oracle) leg.
 *
 * The oracle's genuine abstain path is a `ReferenceRunnerError` (precondition
 * failure / no registered contract). We catch ONLY that — any other throw (a
 * trace-shape bug, an unexpected runtime error) propagates so probe defects are
 * never silently scored as a reject. The caller is responsible for registering
 * the `expression-v1` contract + primitives first (the Slice-0 test does so in
 * `beforeEach`); without that, `referenceRun` raises `ReferenceRunnerError`.
 *
 * The `expression-v1` contract emits exactly one `assign` event; its `value` is
 * the observable. A missing or non-`assign` first event is a contract-shape
 * violation, NOT a legitimate "accepted with no value" — we throw rather than
 * return an ambiguous `{ ok: true, value: undefined }`.
 */
export function observeReference(expr: string): Observed {
  let trace: Trace;
  try {
    trace = referenceRun({ type: 'expression-v1', props: { name: 'r0', expr } }, makeEnv({ bindings: new Map() }));
  } catch (error) {
    if (error instanceof ReferenceRunnerError) return { ok: false };
    throw error;
  }
  const first = trace.events[0];
  if (first === undefined || first.op !== 'assign') {
    throw new Error(
      `parity-probe: expected a single assign event from expression-v1, got ${JSON.stringify(trace.events)}`,
    );
  }
  return { ok: true, value: first.value };
}
