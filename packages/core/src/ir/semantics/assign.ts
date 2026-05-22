/**
 * `assign` runtime semantics — reassignment of an existing mutable binding.
 *
 * Operational semantics:
 *   1. Resolve the existing binding named by `target` in the current
 *      environment (it MUST already exist — implicit declaration-by-assign
 *      diverges: Python auto-creates a local, strict TS rejects it).
 *   2. Evaluate the RHS exactly once over the shared portable-scalar domain.
 *   3. Apply the operator in place (`=` stores the RHS; `+=` adds numbers or
 *      concatenates strings) and emit one observable trace event
 *      `{op:"assign", target, value}` carrying the *new* value.
 *   4. Complete normally.
 *
 * Portability domain:
 *   - `target` is a simple, non-reserved identifier already bound to a number,
 *     string, or boolean. (A null/undefined-typed binding can't be portably
 *     reassigned — TS infers a narrow type that rejects the new value.)
 *   - `op` is `=` or `+=` only. Plain `=` MUST preserve the binding's type;
 *     `+=` requires both operands to be numbers (add) or both strings (concat).
 *   - The RHS is a portable scalar expression (see `./portable-scalar.ts`).
 *
 * Exclusions (out of domain — must fail preconditions):
 *   Implicit declaration via assign; assigning an undeclared name; `const`
 *   reassignment (rejected at emit time, not reachable here); cross-type
 *   reassignment (`number = "x"`); cross-type compound (`number += "x"`);
 *   postfix `++`/`--` and compound ops other than `+=`; destructuring,
 *   property, and index targets.
 */

import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import { type NodeContract, type NodeFixture, registerContract, type SemanticEnv } from './index.js';
import { evalPortableValue, isPortableBindingName, type PortableScalar } from './portable-scalar.js';
import type { Trace } from './trace.js';

type AssignOp = '=' | '+=';

interface AssignProps {
  target?: string;
  op?: unknown;
  value?: unknown;
}

function asAssignProps(ir: IRNode): AssignProps {
  return (ir.props ?? {}) as AssignProps;
}

function normalizeOp(rawOp: unknown): AssignOp {
  if (rawOp === undefined || rawOp === '' || rawOp === '=') return '=';
  if (rawOp === '+=') return '+=';
  throw new Error(`assign: operator "${String(rawOp)}" is outside the portable domain (only "=" and "+=")`);
}

interface ResolvedAssign {
  target: string;
  value: PortableScalar;
}

/**
 * Pure resolution shared by preconditions and effects — never mutates `env`.
 * Throws on any out-of-domain shape so `preconditions` translates the throw
 * into a rejection while `effects` reuses the exact same computation (no
 * read-modify-write reordering between the two).
 */
function resolveAssign(ir: IRNode, env: SemanticEnv): ResolvedAssign {
  const props = asAssignProps(ir);
  const target = props.target;
  if (!isPortableBindingName(target)) throw new Error('assign: target must be a simple portable identifier');
  const op = normalizeOp(props.op);
  if (!Object.hasOwn(ir.props ?? {}, 'value') || props.value === '') {
    throw new Error('assign: value is required');
  }
  if (!env.bindings.has(target)) {
    throw new Error(`assign: "${target}" is not an existing binding (implicit declaration diverges across targets)`);
  }
  const current = env.bindings.get(target);
  if (typeof current !== 'number' && typeof current !== 'string' && typeof current !== 'boolean') {
    throw new Error('assign: target must currently hold a number, string, or boolean');
  }
  const rhs = evalPortableValue(parseExpression(String(props.value)), env);
  if (op === '=') {
    if (typeof rhs !== typeof current) {
      throw new Error('assign: "=" must preserve the binding type (cross-type reassignment diverges)');
    }
    return { target, value: rhs };
  }
  // op === '+='
  if (typeof current === 'number' && typeof rhs === 'number') {
    const next = current + rhs;
    if (!Number.isFinite(next)) throw new Error('assign: "+=" produced a non-finite number');
    return { target, value: next };
  }
  if (typeof current === 'string' && typeof rhs === 'string') {
    return { target, value: current + rhs };
  }
  throw new Error('assign: "+=" requires both operands to be numbers or both strings');
}

function assignPreconditions(ir: IRNode, env: SemanticEnv): boolean {
  try {
    resolveAssign(ir, env);
    return true;
  } catch {
    return false;
  }
}

function assignEffects(ir: IRNode, env: SemanticEnv): Trace {
  const { target, value } = resolveAssign(ir, env);
  env.bindings.set(target, value);
  return { events: [{ op: 'assign', target, value }], completion: { kind: 'normal' } };
}

function assignCompletion(ir: IRNode, env: SemanticEnv) {
  return assignEffects(ir, env).completion;
}

const FORBIDDEN_REWRITES: readonly string[] = Object.freeze([
  'inject Python global/nonlocal',
  'collapse an assign into a declaration',
  'lower `x += y` to `x = x + y`',
  'reorder the read-modify-write',
  'elide the assign event when the value is unchanged',
]);

/**
 * Every assign fixture is a block: a `let kind=let` declaration (so the TS
 * target emits a reassignable `let`, not `const`) followed by the reassignment.
 * `__semanticContract: 'assign'` switches on the assign trace hook in both
 * emitter legs.
 */
function assignFixture(
  description: string,
  setup: IRNode,
  mutation: IRNode,
  expectedEvents: Trace['events'],
): NodeFixture {
  return {
    description,
    ir: {
      type: '__block',
      props: { __semanticContract: 'assign' },
      children: [setup, mutation],
    },
    expected: { events: expectedEvents, completion: { kind: 'normal' } },
  };
}

function letDecl(name: string, value: string): IRNode {
  return { type: 'let', props: { name, kind: 'let', value } };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  assignFixture(
    'assign: plain `=` reassigns a number binding in place',
    letDecl('n', '0'),
    { type: 'assign', props: { target: 'n', value: '5' } },
    [
      { op: 'assign', target: 'n', value: 0 },
      { op: 'assign', target: 'n', value: 5 },
    ],
  ),
  assignFixture(
    'assign: plain `=` reassigns a string binding',
    letDecl('s', '"a"'),
    { type: 'assign', props: { target: 's', value: '"b"' } },
    [
      { op: 'assign', target: 's', value: 'a' },
      { op: 'assign', target: 's', value: 'b' },
    ],
  ),
  assignFixture(
    'assign: plain `=` reassigns a boolean binding',
    letDecl('flag', 'true'),
    { type: 'assign', props: { target: 'flag', value: 'false' } },
    [
      { op: 'assign', target: 'flag', value: true },
      { op: 'assign', target: 'flag', value: false },
    ],
  ),
  assignFixture(
    'assign: `+=` numeric add reads the current value once',
    letDecl('n', '2'),
    { type: 'assign', props: { target: 'n', op: '+=', value: '3' } },
    [
      { op: 'assign', target: 'n', value: 2 },
      { op: 'assign', target: 'n', value: 5 },
    ],
  ),
  assignFixture(
    'assign: `+=` concatenates two strings',
    letDecl('s', '"a"'),
    { type: 'assign', props: { target: 's', op: '+=', value: '"b"' } },
    [
      { op: 'assign', target: 's', value: 'a' },
      { op: 'assign', target: 's', value: 'ab' },
    ],
  ),
  assignFixture(
    'assign: a self-referential `=` performs read-modify-write',
    letDecl('n', '1'),
    { type: 'assign', props: { target: 'n', value: 'n + 1' } },
    [
      { op: 'assign', target: 'n', value: 1 },
      { op: 'assign', target: 'n', value: 2 },
    ],
  ),
]);

export const assignContract: NodeContract = {
  nodeType: 'assign',
  preconditions: assignPreconditions,
  effects: assignEffects,
  completion: assignCompletion,
  forbiddenRewrites: FORBIDDEN_REWRITES,
  fixtures: FIXTURES,
};

let registered = false;

/** Idempotent registration. Test cleanup that clears the registry must re-call. */
export function registerAssignContract(): void {
  if (registered) return;
  registerContract(assignContract);
  registered = true;
}

/** Reset registration flag — only for test cleanup that clears the registry. */
export function _resetAssignContractForTest(): void {
  registered = false;
}
