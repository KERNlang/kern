/**
 * `for` counted range runtime semantics.
 *
 * KERN body-statement `for name=i from=A to=B step=S` follows Python
 * `range(A, B, S)` exactly for the executable surface: `to` is exclusive,
 * `step` defaults to `1`, a zero step is an error, negative steps count down,
 * and the three range expressions are evaluated exactly once before the first
 * iteration. The loop binding is iteration-local for the reference runner, so
 * body-side writes cannot perturb the next index.
 */

import type { IRNode } from '../../types.js';
import { forPreconditions, forRuntimeRange } from './for-runtime.js';
import {
  childEnv,
  defineIntBinding,
  markRepeatableLoopBody,
  type NodeContract,
  type NodeFixture,
  registerContract,
  type SemanticEnv,
} from './index.js';
import { referenceRunSequence } from './reference-runner.js';
import { emptyTrace, type Trace } from './trace.js';

export type { ForProps, ForRuntimeRange } from './for-runtime.js';
export {
  forPreconditions,
  forRuntimeRange,
  forShapePreconditions,
} from './for-runtime.js';

function forEffects(ir: IRNode, env: SemanticEnv): Trace {
  const { name, from, to, step, children } = forRuntimeRange(ir, env);
  const out: Trace = emptyTrace();

  for (let i = from; step > 0 ? i < to : i > to; i += step) {
    out.events.push({ op: 'iter-next', binding: name, value: i });

    // Each iteration runs in a FRESH CHILD scope. The loop variable and any inner
    // `let` declared in the body live only in this child — so they are fresh per
    // iteration and do not leak after the loop (a post-loop read fails closed,
    // matching TS block-scoping; Python would leak it, so it is non-portable).
    // An `assign` to an OUTER binding writes THROUGH to its declaring scope, so
    // mutable accumulators persist across iterations — byte-identical to the
    // emitted TS/Python loops. (Previously this forked `new Map(env.bindings)`,
    // discarding outer mutations: a `sum += i` accumulator returned 0, not 15.)
    const iterEnv = childEnv(env);
    markRepeatableLoopBody(iterEnv);
    defineIntBinding(iterEnv, name, i);

    const childTrace = referenceRunSequence(children, iterEnv);
    out.events.push(...childTrace.events);

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

function forCompletion(ir: IRNode, env: SemanticEnv) {
  return forEffects(ir, env).completion;
}

const FORBIDDEN_REWRITES: readonly string[] = Object.freeze([
  're-evaluate from/to/step after loop entry',
  'treat to= as inclusive',
  'rewrite negative steps as positive forward iteration',
  'allow body mutation of the loop binding to affect the next index',
  'silently accept step=0',
]);

function iterNext(binding: string, value: unknown): Trace['events'][number] {
  return { op: 'iter-next', binding, value };
}

function trc(text: string): IRNode {
  return { type: '__trace', props: { event: { op: 'stdout', text } } };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  {
    description: 'for: forward half-open range 0..3 yields 0, 1, 2',
    ir: { type: 'for', props: { name: 'i', from: '0', to: '3' }, children: [trc('body')] },
    expected: {
      events: [
        iterNext('i', 0),
        { op: 'stdout', text: 'body' },
        iterNext('i', 1),
        { op: 'stdout', text: 'body' },
        iterNext('i', 2),
        { op: 'stdout', text: 'body' },
      ],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'for: reverse range 2 to -1 step -1 yields 2, 1, 0',
    ir: { type: 'for', props: { name: 'i', from: '2', to: '-1', step: '-1' }, children: [trc('body')] },
    expected: {
      events: [
        iterNext('i', 2),
        { op: 'stdout', text: 'body' },
        iterNext('i', 1),
        { op: 'stdout', text: 'body' },
        iterNext('i', 0),
        { op: 'stdout', text: 'body' },
      ],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'for: stepped range 0 to 5 step 2 yields 0, 2, 4',
    ir: { type: 'for', props: { name: 'i', from: '0', to: '5', step: '2' }, children: [trc('body')] },
    expected: {
      events: [
        iterNext('i', 0),
        { op: 'stdout', text: 'body' },
        iterNext('i', 2),
        { op: 'stdout', text: 'body' },
        iterNext('i', 4),
        { op: 'stdout', text: 'body' },
      ],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'for: empty range 0 to 0 yields no iterations',
    ir: { type: 'for', props: { name: 'i', from: '0', to: '0' }, children: [trc('unreached')] },
    expected: emptyTrace(),
  },
  {
    description: 'for: mismatched negative step on forward bounds yields no iterations',
    ir: { type: 'for', props: { name: 'i', from: '0', to: '5', step: '-1' }, children: [trc('unreached')] },
    expected: emptyTrace(),
  },
  {
    description: 'for: range bounds are evaluated once before body mutation',
    ir: {
      type: 'for',
      props: { name: 'i', from: '0', to: 'bounds[0]' },
      children: [{ type: '__assignIndex', props: { target: 'bounds', index: 0, value: 0 } }],
    },
    env: { bindings: new Map([['bounds', [3]]]) },
    expected: {
      events: [iterNext('i', 0), iterNext('i', 1), iterNext('i', 2)],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'for: break at i == 1 exits with normal completion',
    ir: {
      type: 'for',
      props: { name: 'i', from: '0', to: '3' },
      children: [{ type: '__breakIfEqual', props: { name: 'i', value: 1 } }],
    },
    expected: { events: [iterNext('i', 0), iterNext('i', 1)], completion: { kind: 'normal' } },
  },
  {
    description: 'for: continue skips remaining body events but keeps iterating',
    ir: {
      type: 'for',
      props: { name: 'i', from: '0', to: '3' },
      children: [{ type: 'continue' }, trc('unreached')],
    },
    expected: { events: [iterNext('i', 0), iterNext('i', 1), iterNext('i', 2)], completion: { kind: 'normal' } },
  },
]);

export const forContract: NodeContract = {
  nodeType: 'for',
  preconditions: forPreconditions,
  effects: forEffects,
  completion: forCompletion,
  forbiddenRewrites: FORBIDDEN_REWRITES,
  fixtures: FIXTURES,
};

let registered = false;

export function registerForContract(): void {
  if (registered) return;
  registerContract(forContract);
  registered = true;
}

export function _resetForContractForTest(): void {
  registered = false;
}
