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
 * sync pair-mode. The PR-3 audit will reveal if Python's `async for` actually
 * diverges; that becomes a spec revision, not a runner bug.
 *
 * Out of scope for PR-2 (deferred):
 *   - mutation during iteration (implementation-defined for now)
 *   - non-identifier `in=` expressions
 *   - lazy / infinite iterables (the runner materializes through `for...of`)
 */

import type { IRNode } from '../../types.js';
import { type NodeContract, type NodeFixture, registerContract, type SemanticEnv } from './index.js';
import { referenceRunSequence } from './reference-runner.js';
import { emptyTrace, type Trace } from './trace.js';

export type EachShape = 'array' | 'array-indexed' | 'pair-sync' | 'pair-async' | 'entry-key' | 'entry-value';

export interface EachProps {
  name?: string;
  index?: string;
  pairKey?: string;
  pairValue?: string;
  entryKey?: string;
  entryValue?: string;
  entries?: boolean;
  await?: boolean;
  in?: string;
  type?: string;
  key?: string;
}

function asEachProps(ir: IRNode): EachProps {
  return (ir.props ?? {}) as EachProps;
}

/**
 * Detect the iteration shape from props. Returns null if no shape matches OR
 * if multiple shape-defining props are mixed (which is a precondition failure
 * in the contract). Pure: never reads bindings or environment.
 */
export function detectEachShape(p: EachProps): EachShape | null {
  const hasName = typeof p.name === 'string';
  const hasIndex = typeof p.index === 'string';
  const hasPairKey = typeof p.pairKey === 'string';
  const hasPairValue = typeof p.pairValue === 'string';
  const hasEntryKey = typeof p.entryKey === 'string';
  const hasEntryValue = typeof p.entryValue === 'string';
  const isAwait = p.await === true;
  const isEntries = p.entries === true;

  // Array and pair modes must be mutually exclusive with the entry surface —
  // `entries=true` is an entry-mode marker only.
  const arrayMode = hasName && !hasPairKey && !hasPairValue && !hasEntryKey && !hasEntryValue && !isEntries;
  const pairMode = hasPairKey && hasPairValue && !hasName && !hasEntryKey && !hasEntryValue && !hasIndex && !isEntries;
  const entryKeyMode = hasEntryKey && !hasName && !hasPairKey && !hasPairValue && !hasEntryValue && !hasIndex;
  const entryValueMode = hasEntryValue && !hasName && !hasPairKey && !hasPairValue && !hasEntryKey && !hasIndex;

  if (arrayMode) {
    // `await=true` over an array has no defined shape in PR-2. The emitter
    // could plausibly select `for await (const x of arr)` — but the
    // observable trace for an array of resolved values is identical to the
    // sync form, so allowing it would silently strip the await flag from
    // codegen. Reject explicitly; PR-3's audit decides whether async-array
    // is its own shape.
    if (isAwait) return null;
    return hasIndex ? 'array-indexed' : 'array';
  }
  if (pairMode) return isAwait ? 'pair-async' : 'pair-sync';
  // Entry modes are sync-only — `await=true` over object keys/values is not
  // a supported KERN shape.
  if (entryKeyMode && isEntries && !isAwait) return 'entry-key';
  if (entryValueMode && isEntries && !isAwait) return 'entry-value';
  return null;
}

function eachPreconditions(ir: IRNode, _env: SemanticEnv): boolean {
  const p = asEachProps(ir);
  if (typeof p.in !== 'string') return false;
  const shape = detectEachShape(p);
  if (shape === null) return false;
  if (!Array.isArray(ir.children) || ir.children.length === 0) return false;
  return true;
}

interface IterationStep {
  bindings: Array<[string, unknown]>;
  /** The "primary" binding surfaced in the `iter-next` trace event. */
  primary: [string, unknown];
}

/**
 * Guard entry-mode collections against silent zero-iteration bugs. `Object.keys(42)`
 * returns `[]` without throwing — indistinguishable from a real empty object — so
 * a buggy IR feeding a non-object into entry mode would pass the reference runner
 * with no diagnostic. Reject anything that isn't a plain object.
 */
function assertPlainObject(collection: unknown, shape: string): void {
  if (
    typeof collection !== 'object' ||
    collection === null ||
    Array.isArray(collection) ||
    collection instanceof Map ||
    collection instanceof Set
  ) {
    throw new Error(`each ${shape} mode: \`in=\` must resolve to a plain object`);
  }
}

/** Yields one IterationStep per loop iteration, in observable order. */
function* iterateCollection(shape: EachShape, collection: unknown, p: EachProps): Generator<IterationStep> {
  switch (shape) {
    case 'array': {
      const arr = collection as unknown[];
      const name = p.name as string;
      for (const value of arr) {
        yield { bindings: [[name, value]], primary: [name, value] };
      }
      return;
    }
    case 'array-indexed': {
      const arr = collection as unknown[];
      const name = p.name as string;
      const idx = p.index as string;
      let i = 0;
      for (const value of arr) {
        yield {
          bindings: [
            [name, value],
            [idx, i],
          ],
          primary: [name, value],
        };
        i += 1;
      }
      return;
    }
    case 'pair-sync':
    case 'pair-async': {
      const kName = p.pairKey as string;
      const vName = p.pairValue as string;
      if (collection instanceof Map) {
        for (const [k, v] of collection) {
          yield {
            bindings: [
              [kName, k],
              [vName, v],
            ],
            primary: [vName, v],
          };
        }
      } else if (Array.isArray(collection)) {
        for (const pair of collection) {
          if (!Array.isArray(pair) || pair.length !== 2) {
            throw new Error('each pair-mode array element is not a [k, v] tuple');
          }
          const [k, v] = pair as [unknown, unknown];
          yield {
            bindings: [
              [kName, k],
              [vName, v],
            ],
            primary: [vName, v],
          };
        }
      } else {
        throw new Error('each pair-mode `in=` must resolve to a Map or array of [k, v] pairs');
      }
      return;
    }
    case 'entry-key': {
      const name = p.entryKey as string;
      assertPlainObject(collection, 'entry-key');
      const obj = collection as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        yield { bindings: [[name, k]], primary: [name, k] };
      }
      return;
    }
    case 'entry-value': {
      const name = p.entryValue as string;
      assertPlainObject(collection, 'entry-value');
      const obj = collection as Record<string, unknown>;
      for (const v of Object.values(obj)) {
        yield { bindings: [[name, v]], primary: [name, v] };
      }
      return;
    }
  }
}

function eachEffects(ir: IRNode, env: SemanticEnv): Trace {
  const p = asEachProps(ir);
  const shape = detectEachShape(p);
  if (shape === null) {
    throw new Error('each: invariant violated — preconditions passed but shape is null');
  }
  const inName = p.in as string;
  if (!env.bindings.has(inName)) {
    throw new Error(`each: binding "${inName}" not found in env`);
  }
  const collection = env.bindings.get(inName);
  if (collection === null || collection === undefined) {
    throw new Error(`each: binding "${inName}" is nullish`);
  }

  const out: Trace = emptyTrace();
  const children = ir.children ?? [];

  for (const step of iterateCollection(shape, collection, p)) {
    out.events.push({ op: 'iter-next', binding: step.primary[0], value: step.primary[1] });

    const childEnv: SemanticEnv = {
      bindings: new Map(env.bindings),
      seed: env.seed,
      now: env.now,
    };
    for (const [k, v] of step.bindings) childEnv.bindings.set(k, v);

    const childTrace = referenceRunSequence(children, childEnv);
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
