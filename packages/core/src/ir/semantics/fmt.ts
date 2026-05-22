/**
 * `fmt` runtime semantics — string interpolation / template.
 *
 * Operational semantics:
 *   1. Parse the `template=` body into literal quasis + interpolation
 *      expressions (reusing KERN's template-literal parser).
 *   2. Evaluate each interpolation left-to-right over the portable scalar
 *      domain, exactly once.
 *   3. Format each value via KERN-canonical formatting (string = exact;
 *      finite integer = base-10; bool = "true"/"false"; null = "null") and
 *      concatenate with the literal quasis.
 *   4. Bind the result to `name` and emit one observable assignment event
 *      `{op:"assign", target:name, value}`. Complete normally.
 *
 * Portability domain:
 *   - `name` is a simple, non-reserved identifier, not already bound.
 *   - Interpolated values are portable scalars; bool and null are admitted
 *     ONLY as the canonical strings "true"/"false"/"null" — never raw host
 *     formatting (Python `str(True)`="True", `str(None)`="None" diverge).
 *     The Python emitter routes every interpolation through `_kern_fmt` to
 *     match TS template-literal coercion; this contract proves that parity.
 *
 * Exclusions (out of domain — fail preconditions):
 *   Floats / non-integers (TS `1.0`->"1" vs Python "1.0"); bigint; objects /
 *   arrays; undefined; escape sequences in the literal text (whose cooked
 *   runtime value would have to be replicated here); the `return=true`
 *   position form (no observable binding to compare).
 */

import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { type NodeContract, type NodeFixture, registerContract, type SemanticEnv } from './index.js';
import { evalPortableValue, isPortableBindingName, type PortableScalar } from './portable-scalar.js';
import type { Trace } from './trace.js';

interface FmtProps {
  name?: string;
  template?: unknown;
  return?: unknown;
}

function asFmtProps(ir: IRNode): FmtProps {
  return (ir.props ?? {}) as FmtProps;
}

/**
 * KERN-canonical interpolation formatting over the portable scalar domain.
 * Matches both JS template-literal coercion and the Python `_kern_fmt` helper.
 */
function canonicalFmt(value: PortableScalar): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (!Number.isInteger(value)) throw new Error('fmt: only finite integers are portable in interpolation');
  return String(value);
}

/**
 * Parse the `template=` body (the raw chars between backticks) by wrapping it
 * back in backticks and reusing the KERN template-literal parser. Fixtures
 * keep templates to plain text + `${portable scalar}` interpolations.
 */
function parseTemplate(template: string): { quasis: string[]; expressions: ValueIR[] } {
  const node = parseExpression(`\`${template}\``);
  if (node.kind !== 'tmplLit') throw new Error('fmt: template did not parse as a template literal');
  return { quasis: node.quasis, expressions: node.expressions };
}

function fmtResult(ir: IRNode, env: SemanticEnv): { name: string; value: string } {
  const props = asFmtProps(ir);
  if (props.return === true || props.return === 'true') {
    throw new Error('fmt: return-position form is outside this contract (no observable binding)');
  }
  if (!isPortableBindingName(props.name)) throw new Error('fmt: name must be a simple portable identifier');
  if (env.bindings.has(props.name)) throw new Error(`fmt: "${props.name}" is already bound (redeclaration)`);
  if (typeof props.template !== 'string') throw new Error('fmt: template is required');
  const { quasis, expressions } = parseTemplate(props.template);
  let out = '';
  for (let i = 0; i < quasis.length; i += 1) {
    // A backslash in a quasi is an escape whose cooked runtime value the
    // reference would have to replicate byte-for-byte across both targets —
    // out of this contract's domain (the existing fmt golden tests cover it).
    if (quasis[i].includes('\\')) throw new Error('fmt: escape sequences are outside this contract');
    out += quasis[i];
    if (i < expressions.length) out += canonicalFmt(evalPortableValue(expressions[i], env));
  }
  return { name: props.name, value: out };
}

function fmtPreconditions(ir: IRNode, env: SemanticEnv): boolean {
  try {
    fmtResult(ir, env);
    return true;
  } catch {
    return false;
  }
}

function fmtEffects(ir: IRNode, env: SemanticEnv): Trace {
  const { name, value } = fmtResult(ir, env);
  env.bindings.set(name, value);
  return { events: [{ op: 'assign', target: name, value }], completion: { kind: 'normal' } };
}

function fmtCompletion(ir: IRNode, env: SemanticEnv) {
  return fmtEffects(ir, env).completion;
}

const FORBIDDEN_REWRITES: readonly string[] = Object.freeze([
  'use raw Python str()/f-string coercion for bool/null without canonicalization',
  'integer -> float coercion in interpolation',
  'platform printf / %d codes or locale-dependent formatting',
  'reorder or double-evaluate an interpolation',
  'implicit object toString / __str__ in the portable domain',
]);

function fmtFixture(
  description: string,
  ir: IRNode,
  expectedValue: string,
  bindings?: Map<string, unknown>,
): NodeFixture {
  const name = (ir.props as FmtProps).name as string;
  return {
    description,
    ir,
    env: bindings ? { bindings } : undefined,
    expected: { events: [{ op: 'assign', target: name, value: expectedValue }], completion: { kind: 'normal' } },
  };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  fmtFixture(
    'fmt: integer interpolation renders as base-10',
    { type: 'fmt', props: { name: 'msg', template: 'count=${n}' } },
    'count=5',
    new Map([['n', 5]]),
  ),
  fmtFixture(
    'fmt: string interpolation is exact',
    { type: 'fmt', props: { name: 'msg', template: 'hi ${who}' } },
    'hi sam',
    new Map([['who', 'sam']]),
  ),
  fmtFixture(
    'fmt: boolean true canonicalizes to "true"',
    { type: 'fmt', props: { name: 'msg', template: 'flag=${b}' } },
    'flag=true',
    new Map([['b', true]]),
  ),
  fmtFixture(
    'fmt: boolean false canonicalizes to "false"',
    { type: 'fmt', props: { name: 'msg', template: 'flag=${b}' } },
    'flag=false',
    new Map([['b', false]]),
  ),
  fmtFixture(
    'fmt: null canonicalizes to "null"',
    { type: 'fmt', props: { name: 'msg', template: 'val=${v}' } },
    'val=null',
    new Map([['v', null]]),
  ),
  fmtFixture(
    'fmt: multiple interpolations interleave with literal text',
    { type: 'fmt', props: { name: 'msg', template: '${a} of ${total}' } },
    '3 of 10',
    new Map([
      ['a', 3],
      ['total', 10],
    ]),
  ),
  fmtFixture(
    'fmt: a template with no interpolation is the literal text',
    { type: 'fmt', props: { name: 'msg', template: 'ready' } },
    'ready',
  ),
]);

export const fmtContract: NodeContract = {
  nodeType: 'fmt',
  preconditions: fmtPreconditions,
  effects: fmtEffects,
  completion: fmtCompletion,
  forbiddenRewrites: FORBIDDEN_REWRITES,
  fixtures: FIXTURES,
};

let registered = false;

/** Idempotent registration. Test cleanup that clears the registry must re-call. */
export function registerFmtContract(): void {
  if (registered) return;
  registerContract(fmtContract);
  registered = true;
}

/** Reset registration flag — only for test cleanup that clears the registry. */
export function _resetFmtContractForTest(): void {
  registered = false;
}
