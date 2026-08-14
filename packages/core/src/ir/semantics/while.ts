/**
 * `while` boolean-condition loop runtime semantics.
 *
 * Operational semantics:
 *   1. Evaluate the STRICT-BOOLEAN condition at the loop head. A non-boolean
 *      condition is out of domain (decision D1: `while` is strict-boolean, NOT
 *      `if`-style portable-truthy — fixpoint re-evaluation amplifies NaN /
 *      type-flip divergence, so an actual boolean is required).
 *   2. False -> the loop completes normally.
 *   3. True -> run the body in the SAME environment (so a body `assign n += 1`
 *      persists and the loop can terminate). Then:
 *        - body `break`         -> consumed; loop completes normally and exits.
 *        - body `continue`      -> ends the iteration; re-evaluate the condition.
 *        - body `return`/`throw` -> propagate as the loop completion.
 *        - body normal          -> repeat.
 *   4. Iterations are observed ONLY through the repeated body events (decision
 *      D3: `while` emits NO new trace op; `iter-next` stays collection-only).
 *
 * Termination: the reference enforces an iteration ceiling. Exceeding it is a
 * reference/harness error (a non-terminating fixture is a test bug), NOT a
 * `{kind:"throw"}` completion.
 *
 * Portability domain: the condition is a strict-boolean expression over the
 * shared portable-scalar evaluator (comparisons, equality, `!`/`&&`/`||` whose
 * result is a boolean). Truthy / numeric / string conditions and Python
 * `while ... else` are excluded.
 */

import type { IRNode } from '../../types.js';
import {
  childEnv,
  internalReferenceTraceRetentionForEnv,
  markRepeatableLoopBody,
  type NodeContract,
  type NodeFixture,
  registerContract,
  type SemanticEnv,
} from './index.js';
import { evalPortableValue } from './portable-scalar.js';
import { referenceRunSequence } from './reference-runner.js';
import { appendInternalReferenceTraceEvents, emptyTrace, type Trace } from './trace.js';
import {
  evaluateWhileConditionWithEvaluator,
  WHILE_MAX_ITERATIONS,
  whilePreconditionsWithEvaluator,
} from './while-runtime.js';

export { WHILE_MAX_ITERATIONS } from './while-runtime.js';

export function evaluateWhileCondition(ir: IRNode, env: SemanticEnv): boolean {
  return evaluateWhileConditionWithEvaluator(ir, env, evalPortableValue);
}

export function whilePreconditions(ir: IRNode, env: SemanticEnv): boolean {
  return whilePreconditionsWithEvaluator(ir, env, evalPortableValue);
}

function whileEffects(ir: IRNode, env: SemanticEnv): Trace {
  const children = ir.children ?? [];
  const out: Trace = emptyTrace();

  let iterations = 0;
  while (evaluateWhileCondition(ir, env)) {
    if (iterations >= WHILE_MAX_ITERATIONS) {
      throw new Error(`while: exceeded ${WHILE_MAX_ITERATIONS} iterations — non-terminating fixture`);
    }
    iterations += 1;

    // Each iteration runs in a fresh CHILD scope: an `assign` to an OUTER binding
    // (e.g. `n += 1`) writes THROUGH to its declaring scope, so the condition still
    // flips and the loop terminates; meanwhile any inner `let` in the body lives
    // only in the child scope and is fresh per iteration (no cross-iteration
    // redeclaration abstain, no post-loop leak) — matching TS/Python block scoping.
    const iterEnv = childEnv(env);
    markRepeatableLoopBody(iterEnv);
    const childTrace = referenceRunSequence(children, iterEnv);
    appendInternalReferenceTraceEvents(out, childTrace.events, internalReferenceTraceRetentionForEnv(env));

    const c = childTrace.completion;
    if (c.kind === 'break') break;
    if (c.kind === 'continue') continue;
    if (c.kind === 'return' || c.kind === 'throw') {
      out.completion = c;
      return out;
    }
  }
  return out;
}

function whileCompletion(ir: IRNode, env: SemanticEnv) {
  return whileEffects(ir, env).completion;
}

const FORBIDDEN_REWRITES: readonly string[] = Object.freeze([
  'rewrite to for / recursion',
  'loop-unroll',
  'hoist or cache the condition (it must be re-evaluated each pass)',
  'emit Python while...else',
  "let break/continue escape as the loop's final completion (they are consumed by the loop)",
]);

/** A counter declared `kind=let` so the TS target emits a reassignable `let`. */
function letCounter(name: string, value: string): IRNode {
  return { type: 'let', props: { name, kind: 'let', value } };
}

function assign(target: string, op: string, value: string): IRNode {
  return { type: 'assign', props: { target, op, value } };
}

function stdout(text: string): IRNode {
  return { type: '__trace', props: { event: { op: 'stdout', text } } };
}

function block(children: IRNode[]): IRNode {
  return { type: '__block', props: { __semanticContract: 'while' }, children };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  {
    description: 'while: counts up to a literal bound, one body pass per iteration',
    ir: block([
      letCounter('n', '0'),
      { type: 'while', props: { cond: 'n < 3' }, children: [stdout('tick'), assign('n', '+=', '1')] },
    ]),
    expected: {
      events: [
        { op: 'assign', target: 'n', value: 0 },
        { op: 'stdout', text: 'tick' },
        { op: 'assign', target: 'n', value: 1 },
        { op: 'stdout', text: 'tick' },
        { op: 'assign', target: 'n', value: 2 },
        { op: 'stdout', text: 'tick' },
        { op: 'assign', target: 'n', value: 3 },
      ],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'while: a condition false on entry runs the body zero times',
    ir: block([
      letCounter('n', '5'),
      { type: 'while', props: { cond: 'n < 3' }, children: [stdout('unreached'), assign('n', '+=', '1')] },
    ]),
    expected: { events: [{ op: 'assign', target: 'n', value: 5 }], completion: { kind: 'normal' } },
  },
  {
    description: 'while: a body break is consumed and the loop completes normally',
    ir: block([
      letCounter('n', '0'),
      {
        type: 'while',
        props: { cond: 'n < 10' },
        children: [assign('n', '+=', '1'), { type: '__breakIfEqual', props: { name: 'n', value: 2 } }, stdout('t')],
      },
    ]),
    expected: {
      events: [
        { op: 'assign', target: 'n', value: 0 },
        { op: 'assign', target: 'n', value: 1 },
        { op: 'stdout', text: 't' },
        { op: 'assign', target: 'n', value: 2 },
      ],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'while: a body continue skips the rest of the iteration but keeps looping',
    ir: block([
      letCounter('n', '0'),
      {
        type: 'while',
        props: { cond: 'n < 3' },
        children: [assign('n', '+=', '1'), { type: 'continue' }, stdout('unreached')],
      },
    ]),
    expected: {
      events: [
        { op: 'assign', target: 'n', value: 0 },
        { op: 'assign', target: 'n', value: 1 },
        { op: 'assign', target: 'n', value: 2 },
        { op: 'assign', target: 'n', value: 3 },
      ],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'while: a body return propagates as the loop completion',
    ir: block([
      letCounter('n', '0'),
      {
        type: 'while',
        props: { cond: 'n < 10' },
        children: [assign('n', '+=', '1'), { type: 'return', props: { value: 7 } }],
      },
    ]),
    expected: {
      events: [
        { op: 'assign', target: 'n', value: 0 },
        { op: 'assign', target: 'n', value: 1 },
      ],
      completion: { kind: 'return', value: 7 },
    },
  },
  {
    description: 'while: a body throw propagates as the loop completion',
    ir: block([
      letCounter('n', '0'),
      {
        type: 'while',
        props: { cond: 'n < 10' },
        children: [assign('n', '+=', '1'), { type: 'throw', props: { errorKind: 'Error' } }],
      },
    ]),
    expected: {
      events: [
        { op: 'assign', target: 'n', value: 0 },
        { op: 'assign', target: 'n', value: 1 },
      ],
      completion: { kind: 'throw', error: { kind: 'Error' } },
    },
  },
]);

export const whileContract: NodeContract = {
  nodeType: 'while',
  preconditions: whilePreconditions,
  effects: whileEffects,
  completion: whileCompletion,
  forbiddenRewrites: FORBIDDEN_REWRITES,
  fixtures: FIXTURES,
};

let registered = false;

/** Idempotent registration. Test cleanup that clears the registry must re-call. */
export function registerWhileContract(): void {
  if (registered) return;
  registerContract(whileContract);
  registered = true;
}

/** Reset registration flag — only for test cleanup that clears the registry. */
export function _resetWhileContractForTest(): void {
  registered = false;
}
