/**
 * `each` runtime semantics — Phase 1 PR-2.
 *
 * Operational semantics, in order:
 *   1. Evaluate `in` — for PR-2, this is an identifier looked up in
 *      `env.bindings`. Future PRs may widen to arbitrary expressions.
 *   2. Determine iteration shape from props (six exclusive cases — see
 *      [[EachShape]]). Mixing shape props is a precondition failure.
 *   3. For each iteration step:
 *      - Bind iteration variables into a child env.
 *      - Emit one `iter-next` trace event with the primary binding.
 *      - Recursively run children via the reference runner.
 *      - Honor completion: `break` exits loop normally; `continue` proceeds;
 *        `return`/`throw` propagate.
 *   4. Loop exit completes normally unless propagated.
 *
 * `await=true` is recorded as emitter information (it selects `for await` /
 * `async for` at codegen time) but the observable trace is identical to the
 * sync pair-mode.
 *
 * Pair-mode portability — PR-4 outcome:
 *   The PR-3 differential harness surfaced three TS↔Python divergences in
 *   pair-mode iteration: sync over array-of-pairs (Python `.items()`
 *   AttributeError), async over sync Mapping, and async over empty sync
 *   Mapping (Python `async for` requires `__aiter__`). PR-4 closes all
 *   three by routing both targets through small runtime helpers — KERN
 *   pair-mode is defined to iterate via the abstract operations
 *   [[PairIterator]] (sync) and [[AsyncPairIterator]] (async). Both accept:
 *     - any Mapping (via `.items()` on Python; native destructuring on TS)
 *     - any iterable of `[k, v]` 2-tuples (positional destructure)
 *     - any async iterable yielding `[k, v]` (async case only; sync data
 *       is wrapped at iteration entry)
 *   Production codegen emits `_kern_pairs(src)` / `_kern_async_pairs(src)`
 *   on the Python target; TS uses native iteration since JS handles all
 *   three shapes intrinsically. The observable trace is identical across
 *   targets by construction.
 *
 * Out of scope for PR-2 (deferred):
 *   - mutation during iteration (implementation-defined for now)
 *   - non-identifier `in=` expressions
 *   - lazy / infinite iterables (the runner materializes through `for...of`)
 */

import type { IRNode } from '../../types.js';
import { eachPreconditions, eachRuntimeSteps } from './each-runtime.js';
import {
  childEnv,
  defineBinding,
  markRepeatableLoopBody,
  type NodeContract,
  type NodeFixture,
  registerContract,
  type SemanticEnv,
} from './index.js';
import { referenceRunSequence } from './reference-runner.js';
import { emptyTrace, type Trace } from './trace.js';

export type { EachIterationStep, EachProps, EachShape } from './each-runtime.js';
export {
  detectEachShape,
  eachPreconditions,
  eachRuntimeSteps,
  eachShapePreconditions,
  iterateEachRuntimeSteps,
} from './each-runtime.js';

function eachEffects(ir: IRNode, env: SemanticEnv): Trace {
  const out: Trace = emptyTrace();
  const children = ir.children ?? [];

  for (const step of eachRuntimeSteps(ir, env)) {
    out.events.push({ op: 'iter-next', binding: step.primary[0], value: step.primary[1] });

    // Fresh CHILD scope per element: the element binding(s) and any inner `let`
    // live only here (fresh per element, no post-loop leak), while an `assign` to
    // an OUTER binding writes THROUGH to its declaring scope — so an `each`
    // accumulator persists across elements, byte-identical to the emitted loops.
    // (Previously this forked `new Map(env.bindings)`, discarding outer mutations.)
    const iterEnv = childEnv(env);
    markRepeatableLoopBody(iterEnv);
    for (const [k, v] of step.bindings) defineBinding(iterEnv, k, v);

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

function eachCompletion(ir: IRNode, env: SemanticEnv) {
  return eachEffects(ir, env).completion;
}

const FORBIDDEN_REWRITES: readonly string[] = Object.freeze([
  'hoist iteration binding out of body',
  'reorder iteration body across iterations',
  'reuse iteration binding across iterations (Python late-binding closure bug)',
  'short-circuit empty-collection optimization that skips child evaluation effects',
]);

/* ---------------------------------------------------------------------- *
 * Fixtures — machine-readable test vectors consumed by the harness.
 * ---------------------------------------------------------------------- */

function iterNext(binding: string, value: unknown): Trace['events'][number] {
  return { op: 'iter-next', binding, value };
}

function trc(text: string): IRNode {
  return { type: '__trace', props: { event: { op: 'stdout', text } } };
}

function arrayBinding(name: string, value: unknown[]): Partial<SemanticEnv> {
  return { bindings: new Map([[name, value]]) };
}

function mapBinding(name: string, value: Map<unknown, unknown>): Partial<SemanticEnv> {
  return { bindings: new Map([[name, value]]) };
}

function objBinding(name: string, value: Record<string, unknown>): Partial<SemanticEnv> {
  return { bindings: new Map([[name, value]]) };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  // ----- array mode -----
  {
    description: 'array: empty iterable yields no iterations',
    ir: {
      type: 'each',
      props: { name: 'x', in: 'xs' },
      children: [trc('body')],
    },
    env: arrayBinding('xs', []),
    expected: emptyTrace(),
  },
  {
    description: 'array: single-element iteration emits iter-next then body event',
    ir: {
      type: 'each',
      props: { name: 'x', in: 'xs' },
      children: [trc('body')],
    },
    env: arrayBinding('xs', [10]),
    expected: {
      events: [iterNext('x', 10), { op: 'stdout', text: 'body' }],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'array: three-element iteration produces interleaved iter-next + body events',
    ir: {
      type: 'each',
      props: { name: 'x', in: 'xs' },
      children: [trc('hit')],
    },
    env: arrayBinding('xs', ['a', 'b', 'c']),
    expected: {
      events: [
        iterNext('x', 'a'),
        { op: 'stdout', text: 'hit' },
        iterNext('x', 'b'),
        { op: 'stdout', text: 'hit' },
        iterNext('x', 'c'),
        { op: 'stdout', text: 'hit' },
      ],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'array: break inside body exits loop with normal completion',
    ir: {
      type: 'each',
      props: { name: 'x', in: 'xs' },
      children: [{ type: 'break' }],
    },
    env: arrayBinding('xs', [1, 2, 3]),
    expected: { events: [iterNext('x', 1)], completion: { kind: 'normal' } },
  },
  {
    description: 'array: continue skips remaining body events but loop runs all iterations',
    ir: {
      type: 'each',
      props: { name: 'x', in: 'xs' },
      children: [{ type: 'continue' }, trc('unreached')],
    },
    env: arrayBinding('xs', [1, 2]),
    expected: {
      events: [iterNext('x', 1), iterNext('x', 2)],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'array: return inside body propagates completion with value',
    ir: {
      type: 'each',
      props: { name: 'x', in: 'xs' },
      children: [{ type: 'return', props: { value: 42 } }],
    },
    env: arrayBinding('xs', [1, 2, 3]),
    expected: {
      events: [iterNext('x', 1)],
      completion: { kind: 'return', value: 42 },
    },
  },
  {
    description: 'array: throw inside body propagates with canonical error',
    ir: {
      type: 'each',
      props: { name: 'x', in: 'xs' },
      children: [{ type: 'throw', props: { errorKind: 'TypeError' } }],
    },
    env: arrayBinding('xs', [1]),
    expected: {
      events: [iterNext('x', 1)],
      completion: { kind: 'throw', error: { kind: 'TypeError' } },
    },
  },

  // ----- array-indexed -----
  {
    description: 'array-indexed: name + index produces index 0..n-1 in order',
    ir: {
      type: 'each',
      props: { name: 'v', index: 'i', in: 'xs' },
      children: [trc('hit')],
    },
    env: arrayBinding('xs', ['a', 'b']),
    expected: {
      events: [iterNext('v', 'a'), { op: 'stdout', text: 'hit' }, iterNext('v', 'b'), { op: 'stdout', text: 'hit' }],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'array-indexed: empty array yields no iterations',
    ir: {
      type: 'each',
      props: { name: 'v', index: 'i', in: 'xs' },
      children: [trc('hit')],
    },
    env: arrayBinding('xs', []),
    expected: emptyTrace(),
  },
  {
    description: 'array-indexed: break on first iteration leaves no further iter-next',
    ir: {
      type: 'each',
      props: { name: 'v', index: 'i', in: 'xs' },
      children: [{ type: 'break' }],
    },
    env: arrayBinding('xs', [10, 20]),
    expected: { events: [iterNext('v', 10)], completion: { kind: 'normal' } },
  },

  // ----- pair-sync (Map) -----
  {
    description: 'pair-sync: Map with two entries iterates in insertion order',
    ir: {
      type: 'each',
      props: { pairKey: 'k', pairValue: 'v', in: 'm' },
      children: [trc('pair')],
    },
    env: mapBinding(
      'm',
      new Map([
        ['a', 1],
        ['b', 2],
      ] as [string, number][]),
    ),
    expected: {
      events: [iterNext('v', 1), { op: 'stdout', text: 'pair' }, iterNext('v', 2), { op: 'stdout', text: 'pair' }],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'pair-sync: empty Map yields no iterations',
    ir: {
      type: 'each',
      props: { pairKey: 'k', pairValue: 'v', in: 'm' },
      children: [trc('pair')],
    },
    env: mapBinding('m', new Map()),
    expected: emptyTrace(),
  },
  {
    description: 'pair-sync: array of [k, v] tuples iterates in array order',
    ir: {
      type: 'each',
      props: { pairKey: 'k', pairValue: 'v', in: 'pairs' },
      children: [trc('p')],
    },
    env: {
      bindings: new Map([
        [
          'pairs',
          [
            ['x', 100],
            ['y', 200],
          ],
        ],
      ] as [string, unknown][]),
    },
    expected: {
      events: [iterNext('v', 100), { op: 'stdout', text: 'p' }, iterNext('v', 200), { op: 'stdout', text: 'p' }],
      completion: { kind: 'normal' },
    },
  },

  // ----- pair-async -----
  {
    description: 'pair-async: await=true produces identical observable trace to pair-sync',
    ir: {
      type: 'each',
      props: { pairKey: 'k', pairValue: 'v', await: true, in: 'm' },
      children: [trc('async')],
    },
    env: mapBinding('m', new Map([['z', 99]] as [string, number][])),
    expected: {
      events: [iterNext('v', 99), { op: 'stdout', text: 'async' }],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'pair-async: empty async pair yields no iterations',
    ir: {
      type: 'each',
      props: { pairKey: 'k', pairValue: 'v', await: true, in: 'm' },
      children: [trc('async')],
    },
    env: mapBinding('m', new Map()),
    expected: emptyTrace(),
  },

  // ----- entry-key -----
  {
    description: 'entry-key: iterates object keys in insertion order',
    ir: {
      type: 'each',
      props: { entryKey: 'k', entries: true, in: 'o' },
      children: [trc('k')],
    },
    env: objBinding('o', { foo: 1, bar: 2 }),
    expected: {
      events: [iterNext('k', 'foo'), { op: 'stdout', text: 'k' }, iterNext('k', 'bar'), { op: 'stdout', text: 'k' }],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'entry-key: empty object yields no iterations',
    ir: {
      type: 'each',
      props: { entryKey: 'k', entries: true, in: 'o' },
      children: [trc('k')],
    },
    env: objBinding('o', {}),
    expected: emptyTrace(),
  },

  // ----- entry-value -----
  {
    description: 'entry-value: iterates object values in insertion order',
    ir: {
      type: 'each',
      props: { entryValue: 'v', entries: true, in: 'o' },
      children: [trc('v')],
    },
    env: objBinding('o', { a: 10, b: 20 }),
    expected: {
      events: [iterNext('v', 10), { op: 'stdout', text: 'v' }, iterNext('v', 20), { op: 'stdout', text: 'v' }],
      completion: { kind: 'normal' },
    },
  },
  {
    description: 'entry-value: continue on first iteration still runs all iterations',
    ir: {
      type: 'each',
      props: { entryValue: 'v', entries: true, in: 'o' },
      children: [{ type: 'continue' }, trc('unreached')],
    },
    env: objBinding('o', { a: 1, b: 2 }),
    expected: {
      events: [iterNext('v', 1), iterNext('v', 2)],
      completion: { kind: 'normal' },
    },
  },
]);

export const eachContract: NodeContract = {
  nodeType: 'each',
  preconditions: eachPreconditions,
  effects: eachEffects,
  completion: eachCompletion,
  forbiddenRewrites: FORBIDDEN_REWRITES,
  fixtures: FIXTURES,
};

let registered = false;

/** Idempotent registration. Test cleanup that clears the registry must re-call. */
export function registerEachContract(): void {
  if (registered) return;
  registerContract(eachContract);
  registered = true;
}

/** Reset registration flag — only for test cleanup that clears the registry. */
export function _resetEachContractForTest(): void {
  registered = false;
}
