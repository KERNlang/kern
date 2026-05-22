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

import { type NodeContract, type NodeFixture, registerContract } from './index.js';
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

export const returnContract: NodeContract = {
  nodeType: 'return',
  preconditions: () => true,
  effects: (ir) => ({
    events: [],
    completion: { kind: 'return', value: ir.props?.value },
  }),
  completion: (ir) => ({ kind: 'return', value: ir.props?.value }),
  forbiddenRewrites: [],
  fixtures: NO_FIXTURES,
};

export const throwContract: NodeContract = {
  nodeType: 'throw',
  preconditions: (ir) => typeof ir.props?.errorKind === 'string',
  effects: (ir) => {
    const error: CanonicalError = {
      kind: ir.props?.errorKind as string,
      messagePattern: ir.props?.messagePattern as RegExp | undefined,
    };
    return { events: [], completion: { kind: 'throw', error } };
  },
  completion: (ir) => ({
    kind: 'throw',
    error: {
      kind: ir.props?.errorKind as string,
      messagePattern: ir.props?.messagePattern as RegExp | undefined,
    },
  }),
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
