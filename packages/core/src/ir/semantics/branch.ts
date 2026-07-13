/**
 * `branch` runtime semantics.
 *
 * Operational semantics, in order:
 *   1. Evaluate `on` once in the current environment. The contract domain is
 *      intentionally small: string/number literals or identifiers bound to
 *      string/number values.
 *   2. Evaluate every non-default `path value=...` in source order.
 *      Quoted values are string literals; unquoted numeric values are numbers;
 *      unquoted identifiers resolve through `env.bindings`.
 *   3. Execute the first matching path body. Matching uses target-portable
 *      strict value equality: same primitive type and same value.
 *   4. Execute `path default=true` iff no value path matched. The default
 *      path's source position is not observable because branch has no
 *      fallthrough.
 *   5. Run the chosen path body in a child environment so path-local bindings
 *      cannot leak to sibling paths or following statements.
 *
 * Equality portability:
 *   TS `switch` uses strict equality while Python lowers to idiomatic `==`.
 *   Python's bool is a numeric subtype (`True == 1`), so booleans are outside
 *   this executable contract. Keeping the contract to strings/numbers and
 *   identifiers that resolve to strings/numbers makes Python `==` equivalent
 *   to TS `===` for all differential fixtures without replacing either
 *   target's natural branch form.
 */

import type { IRNode } from '../../types.js';
import { branchPreconditions, selectBranchPath } from './branch-runtime.js';
import { childEnv, type NodeContract, type NodeFixture, registerContract, type SemanticEnv } from './index.js';
import { referenceRunSequence } from './reference-runner.js';
import { emptyTrace, type Trace } from './trace.js';

export type { BranchProps } from './branch-runtime.js';
export { branchPreconditions, branchShapePreconditions, selectBranchPath } from './branch-runtime.js';

function branchEffects(ir: IRNode, env: SemanticEnv): Trace {
  const selected = selectBranchPath(ir, env);
  if (!selected) return emptyTrace();
  // Run the selected path body in a CHILD scope: path-local `let`s stay scoped to
  // the case block (the "hoist path-local bindings out of their case block"
  // forbidden rewrite) while an `assign` to an OUTER binding writes THROUGH to its
  // declaring scope — so a branch nested in a loop accumulates correctly and stays
  // byte-identical to the emitted TS switch / Python if-chain. (Previously forked
  // `new Map(env.bindings)`: it discarded outer mutations AND severed the parent
  // chain, making outer bindings invisible when a branch ran inside a child scope.)
  return referenceRunSequence(selected.children ?? [], childEnv(env));
}

function branchCompletion(ir: IRNode, env: SemanticEnv) {
  return branchEffects(ir, env).completion;
}

const FORBIDDEN_REWRITES: readonly string[] = Object.freeze([
  'reorder non-default paths with overlapping values',
  'treat default source position as observable',
  'fall through from one path body into another',
  'hoist path-local bindings out of their case block',
  'compare branch values with cross-type coercion (Python bool/int trap)',
]);

/* ---------------------------------------------------------------------- *
 * Fixtures — machine-readable test vectors consumed by the harness.
 * ---------------------------------------------------------------------- */

function trc(text: string): IRNode {
  return { type: '__trace', props: { event: { op: 'stdout', text } } };
}

function binding(entries: ReadonlyArray<[string, unknown]>): Partial<SemanticEnv> {
  return { bindings: new Map(entries) };
}

function pathValue(value: string, children: IRNode[] = [trc(value)]): IRNode {
  return { type: 'path', props: { value }, __quotedProps: ['value'], children };
}

function pathNumber(value: string, children: IRNode[] = [trc(value)]): IRNode {
  return { type: 'path', props: { value }, children };
}

function pathIdentifier(value: string, children: IRNode[] = [trc(value)]): IRNode {
  return { type: 'path', props: { value }, children };
}

function pathDefault(children: IRNode[] = [trc('default')]): IRNode {
  return { type: 'path', props: { default: true }, children };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  {
    description: 'branch: single matching string path runs its body',
    ir: {
      type: 'branch',
      props: { on: 'kind' },
      children: [pathValue('paid', [trc('paid')])],
    },
    env: binding([['kind', 'paid']]),
    expected: { events: [{ op: 'stdout', text: 'paid' }], completion: { kind: 'normal' } },
  },
  {
    description: 'branch: no matching path falls through to default',
    ir: {
      type: 'branch',
      props: { on: 'kind' },
      children: [pathValue('paid', [trc('paid')]), pathDefault([trc('fallback')])],
    },
    env: binding([['kind', 'refunded']]),
    expected: { events: [{ op: 'stdout', text: 'fallback' }], completion: { kind: 'normal' } },
  },
  {
    description: 'branch: matching path skips default',
    ir: {
      type: 'branch',
      props: { on: 'kind' },
      children: [pathValue('paid', [trc('paid')]), pathDefault([trc('fallback')])],
    },
    env: binding([['kind', 'paid']]),
    expected: { events: [{ op: 'stdout', text: 'paid' }], completion: { kind: 'normal' } },
  },
  {
    description: 'branch: mid-default does not hide a later matching path',
    ir: {
      type: 'branch',
      props: { on: 'kind' },
      children: [pathValue('alpha', [trc('alpha')]), pathDefault([trc('fallback')]), pathValue('beta', [trc('beta')])],
    },
    env: binding([['kind', 'beta']]),
    expected: { events: [{ op: 'stdout', text: 'beta' }], completion: { kind: 'normal' } },
  },
  {
    description: 'branch: trailing default is equivalent to mid-default after a later match',
    ir: {
      type: 'branch',
      props: { on: 'kind' },
      children: [pathValue('alpha', [trc('alpha')]), pathValue('beta', [trc('beta')]), pathDefault([trc('fallback')])],
    },
    env: binding([['kind', 'beta']]),
    expected: { events: [{ op: 'stdout', text: 'beta' }], completion: { kind: 'normal' } },
  },
  {
    description: 'branch: numeric case values compare as numbers',
    ir: {
      type: 'branch',
      props: { on: 'code' },
      children: [pathNumber('1', [trc('one')]), pathNumber('2', [trc('two')]), pathDefault([trc('fallback')])],
    },
    env: binding([['code', 2]]),
    expected: { events: [{ op: 'stdout', text: 'two' }], completion: { kind: 'normal' } },
  },
  {
    description: 'branch: unquoted identifier path resolves enum-like bindings',
    ir: {
      type: 'branch',
      props: { on: 'status' },
      children: [pathIdentifier('ACTIVE', [trc('active')]), pathIdentifier('INACTIVE', [trc('inactive')])],
    },
    env: binding([
      ['status', 'active'],
      ['ACTIVE', 'active'],
      ['INACTIVE', 'inactive'],
    ]),
    expected: { events: [{ op: 'stdout', text: 'active' }], completion: { kind: 'normal' } },
  },
  {
    description: 'branch: empty matching path body completes normally',
    ir: {
      type: 'branch',
      props: { on: 'kind' },
      children: [pathValue('empty', []), pathDefault([trc('fallback')])],
    },
    env: binding([['kind', 'empty']]),
    expected: emptyTrace(),
  },
  {
    description: 'branch: duplicate matching values run the first matching path only',
    ir: {
      type: 'branch',
      props: { on: 'kind' },
      children: [pathValue('paid', [trc('first')]), pathValue('paid', [trc('second')])],
    },
    env: binding([['kind', 'paid']]),
    expected: { events: [{ op: 'stdout', text: 'first' }], completion: { kind: 'normal' } },
  },
  {
    description: 'branch: return completion from selected path propagates',
    ir: {
      type: 'branch',
      props: { on: 'kind' },
      children: [pathValue('paid', [{ type: 'return', props: { value: 42 } }]), pathDefault([trc('fallback')])],
    },
    env: binding([['kind', 'paid']]),
    expected: { events: [], completion: { kind: 'return', value: 42 } },
  },
]);

export const branchContract: NodeContract = {
  nodeType: 'branch',
  preconditions: branchPreconditions,
  effects: branchEffects,
  completion: branchCompletion,
  forbiddenRewrites: FORBIDDEN_REWRITES,
  fixtures: FIXTURES,
};

let registered = false;

/** Idempotent registration. Test cleanup that clears the registry must re-call. */
export function registerBranchContract(): void {
  if (registered) return;
  registerContract(branchContract);
  registered = true;
}

/** Reset registration flag — only for test cleanup that clears the registry. */
export function _resetBranchContractForTest(): void {
  registered = false;
}
