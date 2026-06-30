/**
 * try / catch / finally runtime semantics — catch-all, canonical errors (D2).
 *
 * Structure: `catch` and `finally` are CHILD nodes of `try` (the way `branch`
 * models its `path` children); everything else under `try` is the protected
 * body. At most one `catch` and one `finally`; a `try` with neither is an
 * orphan and fails preconditions.
 *
 * Operational semantics:
 *   1. Run the try body.
 *   2. If it completes `{kind:"throw"}` AND a `catch` is present, run the catch
 *      body; the catch's completion replaces the body's. (Catch-all only this
 *      slice — the single catch handles every canonical error.)
 *   3. If a `finally` is present, run it on EVERY path. It is cleanup-only: it
 *      must complete normally, and it preserves the prior completion. A finally
 *      that itself completes abruptly is out of domain (the finally-overrides-
 *      completion trap) and raises a reference error.
 *   4. Event order: try/catch events first, then finally events, then the final
 *      completion (normal | return | throw{error:{kind,messagePattern}}).
 *
 * Domain / exclusions (D2):
 *   - The only error source is an EXPLICIT `throw` of a canonical KERN error
 *     (modeled by the `throw` primitive -> `{kind, messagePattern}`).
 *   - Catch bodies may read only the caught binding's `.message` field when the
 *     error came from an explicit `throw new Error("...")`. Raw-error reads
 *     such as `e`, `e.name`, or `e.stack` diverge and are out of domain.
 *   - When a `catch` is present the try body must not `return` (in the emitter
 *     legs a body `return` lowers to a sentinel the `catch`/`except Exception`
 *     would wrongly intercept; the reference would propagate it). A finally-
 *     only `try` (no catch) MAY contain a propagating return/throw.
 *   - Typed/multi-catch, implicit runtime errors (null-deref, div-by-zero),
 *     throwing primitives, and abrupt finally are deferred to a later contract.
 */

import type { IRNode } from '../../types.js';
import { defineBinding, type NodeContract, type NodeFixture, registerContract, type SemanticEnv } from './index.js';
import { makeCaughtErrorValue } from './portable-error.js';
import { referenceRunSequence } from './reference-runner.js';
import { type CompletionRecord, emptyTrace, type Trace } from './trace.js';

export const UNAVAILABLE_CAUGHT_ERROR = Object.freeze({ message: Object.freeze({}) });

export interface TryParts {
  body: IRNode[];
  catchNode: IRNode | null;
  finallyNode: IRNode | null;
}

export function tryRuntimeParts(children: readonly IRNode[]): TryParts {
  return {
    body: children.filter((c) => c.type !== 'catch' && c.type !== 'finally'),
    catchNode: children.find((c) => c.type === 'catch') ?? null,
    finallyNode: children.find((c) => c.type === 'finally') ?? null,
  };
}

export function tryPreconditions(ir: IRNode, _env: SemanticEnv): boolean {
  if (!Array.isArray(ir.children)) return false;
  const catches = ir.children.filter((c) => c.type === 'catch');
  const finallies = ir.children.filter((c) => c.type === 'finally');
  if (catches.length > 1 || finallies.length > 1) return false;
  if (catches.length === 0 && finallies.length === 0) return false; // orphan try
  const catchNode = catches[0];
  if (catchNode) {
    const name = catchNode.props?.name;
    if (typeof name !== 'string' || name === '') return false;
    if (!Array.isArray(catchNode.children)) return false;
  }
  if (finallies[0] && !Array.isArray(finallies[0].children)) return false;
  return true;
}

function tryEffects(ir: IRNode, env: SemanticEnv): Trace {
  const { body, catchNode, finallyNode } = tryRuntimeParts(ir.children ?? []);
  const out: Trace = emptyTrace();

  const bodyTrace = referenceRunSequence(body, env);
  out.events.push(...bodyTrace.events);
  let completion: CompletionRecord = bodyTrace.completion;

  if (completion.kind === 'return' && catchNode) {
    throw new Error('try: body return with catch is outside the portable domain');
  }

  if (completion.kind === 'throw' && catchNode) {
    // Catch-all: the single catch handles the canonical error. Error-substrate
    // Slice 1 — bind the caught error to the catch `name` so the catch body can
    // read `<name>.message` (the ONLY admitted error-binding read; see
    // portable-scalar's `member` case). The binding is a TAGGED caught-error
    // value carrying the EVALUATED LITERAL message of the explicit
    // `throw new Error("…")`. An error WITHOUT a literal message (an implicit/
    // primitive throw modeled by messagePattern) yields `null` from
    // makeCaughtErrorValue → the binding stays UNSET → any read of it abstains
    // (out of domain). The catch runs in the same env; its completion replaces
    // the body's. The binding is local to this catch execution; a finally-only
    // `try` never reaches here.
    const caught = catchNode.props?.name;
    const hasBinding = typeof caught === 'string' && caught !== '';
    // SCOPE the catch binding to the catch body. After the catch body completes,
    // leave a non-portable tombstone in this scope instead of restoring any
    // same-named prior binding: TS would expose an outer binding to `finally` /
    // following statements, while Python deletes the exception target. The only
    // portable post-catch behavior for this name is therefore abstention.
    if (hasBinding) {
      const caughtValue = completion.error ? makeCaughtErrorValue(completion.error) : null;
      defineBinding(env, caught as string, caughtValue ?? UNAVAILABLE_CAUGHT_ERROR);
    }
    let catchTrace: Trace;
    try {
      catchTrace = referenceRunSequence(catchNode.children ?? [], env);
    } finally {
      if (hasBinding) {
        defineBinding(env, caught as string, UNAVAILABLE_CAUGHT_ERROR);
      }
    }
    out.events.push(...catchTrace.events);
    completion = catchTrace.completion;
  }

  if (finallyNode) {
    const finallyTrace = referenceRunSequence(finallyNode.children ?? [], env);
    out.events.push(...finallyTrace.events);
    if (finallyTrace.completion.kind !== 'normal') {
      // finally is cleanup-only this slice; an abrupt finally would override
      // the pending completion (the trap D2 defers).
      throw new Error('try: finally must complete normally (cleanup-only this slice)');
    }
    // finally preserves the prior completion.
  }

  out.completion = completion;
  return out;
}

function tryCompletion(ir: IRNode, env: SemanticEnv) {
  return tryEffects(ir, env).completion;
}

const FORBIDDEN_REWRITES: readonly string[] = Object.freeze([
  'swallow errors silently',
  'reorder or skip finally',
  'run finally before catch',
  'widen or narrow the exception type',
  'drop the {kind,message} canonicalization or leak the raw platform error to catch',
  'compare raw error message text instead of the canonical kind + pattern',
]);

function trc(text: string): IRNode {
  return { type: '__trace', props: { event: { op: 'stdout', text } } };
}

function throwErr(kind: string): IRNode {
  return { type: 'throw', props: { errorKind: kind } };
}

function catchBlock(children: IRNode[], name = 'e'): IRNode {
  return { type: 'catch', props: { name }, children };
}

function finallyBlock(children: IRNode[]): IRNode {
  return { type: 'finally', children };
}

function stdoutEvent(text: string): Trace['events'][number] {
  return { op: 'stdout', text };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  {
    description: 'try/catch: a thrown canonical error is caught and the loop completes normally',
    ir: { type: 'try', children: [trc('try'), throwErr('Error'), catchBlock([trc('caught')])] },
    expected: { events: [stdoutEvent('try'), stdoutEvent('caught')], completion: { kind: 'normal' } },
  },
  {
    description: 'try/catch: a body that does not throw skips the catch',
    ir: { type: 'try', children: [trc('ok'), catchBlock([trc('unreached')])] },
    expected: { events: [stdoutEvent('ok')], completion: { kind: 'normal' } },
  },
  {
    description: 'try/finally: finally runs after a normal body',
    ir: { type: 'try', children: [trc('work'), finallyBlock([trc('cleanup')])] },
    expected: { events: [stdoutEvent('work'), stdoutEvent('cleanup')], completion: { kind: 'normal' } },
  },
  {
    description: 'try/finally: an uncaught throw runs finally, then propagates as the completion',
    ir: { type: 'try', children: [trc('work'), throwErr('Error'), finallyBlock([trc('cleanup')])] },
    expected: {
      events: [stdoutEvent('work'), stdoutEvent('cleanup')],
      completion: { kind: 'throw', error: { kind: 'Error' } },
    },
  },
  {
    description: 'try/catch/finally: caught throw runs catch then finally, completes normally',
    ir: {
      type: 'try',
      children: [trc('try'), throwErr('Error'), catchBlock([trc('caught')]), finallyBlock([trc('cleanup')])],
    },
    expected: {
      events: [stdoutEvent('try'), stdoutEvent('caught'), stdoutEvent('cleanup')],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'try/catch/finally: a normal body skips catch but still runs finally',
    ir: {
      type: 'try',
      children: [trc('ok'), catchBlock([trc('unreached')]), finallyBlock([trc('cleanup')])],
    },
    expected: { events: [stdoutEvent('ok'), stdoutEvent('cleanup')], completion: { kind: 'normal' } },
  },
  {
    description: 'try/finally: a body return runs finally, then propagates the return',
    ir: {
      type: 'try',
      children: [trc('work'), { type: 'return', props: { value: 9 } }, finallyBlock([trc('cleanup')])],
    },
    expected: {
      events: [stdoutEvent('work'), stdoutEvent('cleanup')],
      completion: { kind: 'return', value: 9 },
    },
  },
]);

export const tryContract: NodeContract = {
  nodeType: 'try',
  preconditions: tryPreconditions,
  effects: tryEffects,
  completion: tryCompletion,
  forbiddenRewrites: FORBIDDEN_REWRITES,
  fixtures: FIXTURES,
};

let registered = false;

/** Idempotent registration. Test cleanup that clears the registry must re-call. */
export function registerTryContract(): void {
  if (registered) return;
  registerContract(tryContract);
  registered = true;
}

/** Reset registration flag — only for test cleanup that clears the registry. */
export function _resetTryContractForTest(): void {
  registered = false;
}
