/**
 * Primitive node contracts — minimal stubs to support `each` testing.
 *
 * Phase 1 PR-2 registers contracts for the control-flow primitives that
 * `each` fixtures need to compose realistic bodies:
 *
 *   - `__trace`  — test-only node; emits one configurable trace event
 *   - `break`    — sets completion to `{kind: 'break'}`
 *   - `continue` — sets completion to `{kind: 'continue'}`
 *   - `return`   — sets completion to `{kind: 'return', value}`
 *   - `throw`    — sets completion to `{kind: 'throw', error}`
 *   - `__breakIfEqual` — fixture helper for conditional loop exits
 *   - `__assignIndex`  — fixture helper for mutating an indexed binding
 *
 * These are explicitly minimal and stay until Phase 2 lands full
 * contracts for `do`/`let`/`assign`. `__trace` is a permanent fixture
 * helper — it is never emitted by user code.
 */

import { parseExpression } from '../../parser-expression.js';
import { type NodeContract, type NodeFixture, registerContract, type SemanticEnv } from './index.js';
import { evalExplicitThrowError } from './portable-error.js';
import { evalPortableValue } from './portable-scalar.js';
import type { CanonicalError, TraceEvent } from './trace.js';

const NO_FIXTURES: readonly NodeFixture[] = [];

/** Test-only: emits one trace event. Props.event must be a serialized TraceEvent. */
export const traceContract: NodeContract = {
  nodeType: '__trace',
  preconditions: (ir) => {
    const ev = ir.props?.event;
    return typeof ev === 'object' && ev !== null && typeof (ev as TraceEvent).op === 'string';
  },
  effects: (ir) => {
    const ev = ir.props?.event as TraceEvent;
    return { events: [ev], completion: { kind: 'normal' } };
  },
  completion: () => ({ kind: 'normal' }),
  forbiddenRewrites: [],
  fixtures: NO_FIXTURES,
};

export const breakContract: NodeContract = {
  nodeType: 'break',
  preconditions: () => true,
  effects: () => ({ events: [], completion: { kind: 'break' } }),
  completion: () => ({ kind: 'break' }),
  forbiddenRewrites: [],
  fixtures: NO_FIXTURES,
};

export const continueContract: NodeContract = {
  nodeType: 'continue',
  preconditions: () => true,
  effects: () => ({ events: [], completion: { kind: 'continue' } }),
  completion: () => ({ kind: 'continue' }),
  forbiddenRewrites: [],
  fixtures: NO_FIXTURES,
};

/**
 * Resolve a `return` node's value. Two shapes:
 *
 *   1. A NON-string `props.value` (a hand-built fixture's raw `42` / `9` / `7`,
 *      or `undefined`) — passed through verbatim, exactly as before. Reference-
 *      runner fixtures (each/branch/while/if/try) rely on this raw passthrough.
 *   2. A STRING `props.value` (the parser's `return value="m"` /
 *      `return value="e.message"`) — evaluated as a portable expression against
 *      the current env, so a binding read resolves to its value and the
 *      error-substrate `<caughtBinding>.message` read returns the literal
 *      message. A string that is NOT a portable expression (`return e` bare,
 *      `return e.name`/`e.stack`) throws → the runner abstains (fail-close).
 *
 * `import`s are deferred-resolved (parser/portable evaluator) at call time, so
 * this stays a tiny primitive.
 */
function resolveReturnValue(ir: { props?: Record<string, unknown> }, env: SemanticEnv): unknown {
  const value = ir.props?.value;
  if (typeof value !== 'string') return value;
  return evalPortableValue(parseExpression(value), env);
}

export const returnContract: NodeContract = {
  nodeType: 'return',
  preconditions: (ir, env) => {
    // A non-string value always admits (raw passthrough). A string value must be
    // a portable expression resolvable in the current env, else the runner
    // abstains cleanly here instead of throwing from effects.
    if (typeof ir.props?.value !== 'string') return true;
    try {
      resolveReturnValue(ir, env);
      return true;
    } catch {
      return false;
    }
  },
  effects: (ir, env) => ({
    events: [],
    completion: { kind: 'return', value: resolveReturnValue(ir, env) },
  }),
  completion: (ir, env) => ({ kind: 'return', value: resolveReturnValue(ir, env) }),
  forbiddenRewrites: [],
  fixtures: NO_FIXTURES,
};

/**
 * Resolve a `throw` node to its canonical error, supporting BOTH forms:
 *
 *   1. The fixture/primitive form `{ errorKind: "Error", messagePattern?: … }`
 *      — used by the try/each/branch contract fixtures. Unchanged.
 *   2. The body-statement form `throw value="new Error(\"boom\")"` — the
 *      EXPLICIT canonical-Error throw the parser produces. Its `value` is a
 *      string expression; it is admitted ONLY when it parses to the canonical
 *      `new Error(<string-expr>)` shape (see {@link evalExplicitThrowError}),
 *      carrying the EVALUATED LITERAL message. A bare-value throw
 *      (`throw "raw"`, `throw 42`, `new TypeError(...)`) is NOT admitted here —
 *      it throws, so the precondition fails and the runner abstains (the
 *      error-substrate fail-close fence).
 *
 * Throws on an unrecognized shape so the precondition (which wraps this in a
 * try) returns false → `referenceRun` raises the normal "Preconditions failed".
 */
function resolveThrowError(ir: { props?: Record<string, unknown> }, env: SemanticEnv): CanonicalError {
  if (typeof ir.props?.errorKind === 'string') {
    return {
      kind: ir.props.errorKind,
      messagePattern: ir.props.messagePattern as RegExp | undefined,
    };
  }
  if (typeof ir.props?.value === 'string') {
    // Body-statement explicit throw. parseExpression is INSIDE the caller's try.
    return evalExplicitThrowError(parseExpression(ir.props.value), env);
  }
  throw new Error('throw: missing errorKind or explicit `new Error(...)` value');
}

export const throwContract: NodeContract = {
  nodeType: 'throw',
  preconditions: (ir, env) => {
    try {
      resolveThrowError(ir, env);
      return true;
    } catch {
      return false;
    }
  },
  effects: (ir, env) => ({ events: [], completion: { kind: 'throw', error: resolveThrowError(ir, env) } }),
  completion: (ir, env) => ({ kind: 'throw', error: resolveThrowError(ir, env) }),
  forbiddenRewrites: [],
  fixtures: NO_FIXTURES,
};

export const breakIfEqualContract: NodeContract = {
  nodeType: '__breakIfEqual',
  preconditions: (ir) => typeof ir.props?.name === 'string' && Object.hasOwn(ir.props, 'value'),
  effects: (ir, env) => {
    const name = ir.props?.name as string;
    return {
      events: [],
      completion: Object.is(env.bindings.get(name), ir.props?.value) ? { kind: 'break' } : { kind: 'normal' },
    };
  },
  completion: (ir, env) => breakIfEqualContract.effects(ir, env).completion,
  forbiddenRewrites: [],
  fixtures: NO_FIXTURES,
};

export const assignIndexContract: NodeContract = {
  nodeType: '__assignIndex',
  preconditions: (ir) =>
    typeof ir.props?.target === 'string' &&
    typeof ir.props?.index === 'number' &&
    Number.isSafeInteger(ir.props.index) &&
    Object.hasOwn(ir.props, 'value'),
  effects: (ir, env) => {
    const targetName = ir.props?.target as string;
    const target = env.bindings.get(targetName);
    if (!Array.isArray(target)) {
      throw new Error(`__assignIndex: binding "${targetName}" must be an array`);
    }
    target[ir.props?.index as number] = ir.props?.value;
    return { events: [], completion: { kind: 'normal' } };
  },
  completion: () => ({ kind: 'normal' }),
  forbiddenRewrites: [],
  fixtures: NO_FIXTURES,
};

let registered = false;

/**
 * Idempotently register all primitive contracts. Safe to call from multiple
 * test files; subsequent calls are no-ops. Test cleanup that clears the
 * registry must re-call this.
 */
export function registerPrimitives(): void {
  if (registered) return;
  registerContract(traceContract);
  registerContract(breakContract);
  registerContract(continueContract);
  registerContract(returnContract);
  registerContract(throwContract);
  registerContract(breakIfEqualContract);
  registerContract(assignIndexContract);
  registered = true;
}

/** Reset the registered flag — only for test cleanup that clears the registry. */
export function _resetPrimitivesForTest(): void {
  registered = false;
}
