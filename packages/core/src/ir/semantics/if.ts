/**
 * `if` / sibling `else` runtime semantics.
 *
 * Operational semantics:
 *   1. Evaluate `cond` exactly once for the current `if` arm.
 *   2. If truthy, run the `if` children and skip every paired `else` arm.
 *   3. If falsy and an immediate sibling `else` exists, run that `else`.
 *      The reference runner pairs siblings before dispatching this contract.
 *   4. `else > [if]` and `else > [if, else]` are just nested body sequences
 *      in the reference semantics; TS/Python emitters are free to collapse
 *      them to `else if` / `elif` because the chosen branch and completion
 *      records are identical.
 *
 * Truthiness portability:
 *   This Phase 1 contract deliberately restricts `cond` to a cross-target
 *   primitive truthiness domain: booleans, finite numbers, strings, null, and
 *   undefined/None. Arrays and objects are rejected because JS and Python
 *   disagree on empty container truthiness.
 */

import type { IRNode } from '../../types.js';
import {
  getBinding,
  hasBinding,
  type NodeContract,
  type NodeFixture,
  registerContract,
  type SemanticEnv,
} from './index.js';
import { referenceRunSequence } from './reference-runner.js';
import { emptyTrace, type Trace } from './trace.js';

export interface IfProps {
  cond?: string;
  __pairedElse?: IRNode;
}

function asIfProps(ir: IRNode): IfProps {
  return (ir.props ?? {}) as IfProps;
}

function ifPreconditions(ir: IRNode, env: SemanticEnv): boolean {
  return validateIfNode(ir, env);
}

function validateIfNode(ir: IRNode, env: SemanticEnv): boolean {
  const p = asIfProps(ir);
  if (typeof p.cond !== 'string' || p.cond.trim().length === 0) return false;
  try {
    portableTruthy(conditionValue(p.cond, env));
  } catch {
    return false;
  }
  if (p.__pairedElse !== undefined && !validateElseNode(p.__pairedElse, env)) return false;
  return true;
}

function validateElseNode(ir: IRNode, env: SemanticEnv): boolean {
  if (ir.type !== 'else') return false;
  const children = ir.children ?? [];
  if (children.length === 1 && children[0].type === 'if') return validateIfNode(children[0], env);
  if (children.length === 2 && children[0].type === 'if' && children[1].type === 'else') {
    const pairedIf: IRNode = {
      ...children[0],
      props: {
        ...(children[0].props ?? {}),
        __pairedElse: children[1],
      },
    };
    return validateIfNode(pairedIf, env);
  }
  return true;
}

function conditionValue(cond: string, env: SemanticEnv): unknown {
  const trimmed = cond.trim();
  if (trimmed === 'true' || trimmed === 'True') return true;
  if (trimmed === 'false' || trimmed === 'False') return false;
  if (trimmed === 'null' || trimmed === 'undefined' || trimmed === 'None') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return parseStringLiteral(trimmed);
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) {
    if (!hasBinding(env, trimmed)) {
      throw new Error(`if: binding "${trimmed}" not found in env`);
    }
    return getBinding(env, trimmed);
  }
  if (trimmed.startsWith('!')) return !portableTruthy(conditionValue(trimmed.slice(1), env));
  throw new Error(`if: unsupported condition expression "${cond}" in semantic contract fixture`);
}

function parseStringLiteral(text: string): string {
  if (text.startsWith('"')) return JSON.parse(text) as string;
  const inner = text.slice(1, -1);
  return inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

export function portableTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('if: condition number must be finite');
    return value !== 0;
  }
  if (typeof value === 'string') return value.length > 0;
  throw new Error('if: condition value is outside the portable truthiness domain');
}

function ifEffects(ir: IRNode, env: SemanticEnv): Trace {
  const p = asIfProps(ir);
  const cond = p.cond as string;
  if (portableTruthy(conditionValue(cond, env))) {
    return referenceRunSequence(ir.children ?? [], env);
  }
  const elseNode = p.__pairedElse;
  if (elseNode) return referenceRunSequence(elseNode.children ?? [], env);
  return emptyTrace();
}

function ifCompletion(ir: IRNode, env: SemanticEnv) {
  return ifEffects(ir, env).completion;
}

const FORBIDDEN_REWRITES: readonly string[] = Object.freeze([
  'evaluate if cond more than once',
  'evaluate later else-if conditions after an earlier branch matched',
  'run more than one if/else branch from the same chain',
  'change else > [if, else] chain collapse into a different branch order',
  'widen condition truthiness to arrays or objects without a cross-target contract revision',
]);

function trc(text: string): IRNode {
  return { type: '__trace', props: { event: { op: 'stdout', text } } };
}

function block(children: IRNode[], bindings?: Array<[string, unknown]>): NodeFixture {
  return {
    description: '',
    ir: { type: '__block', children },
    env: bindings ? { bindings: new Map(bindings) } : undefined,
    expected: emptyTrace(),
  };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  {
    ...block([{ type: 'if', props: { cond: 'flag' }, children: [trc('then')] }], [['flag', true]]),
    description: 'if-true: truthy condition runs then branch',
    expected: { events: [{ op: 'stdout', text: 'then' }], completion: { kind: 'normal' } },
  },
  {
    ...block([{ type: 'if', props: { cond: 'flag' }, children: [trc('then')] }], [['flag', false]]),
    description: 'if-false-no-else: falsy condition runs no branch',
    expected: emptyTrace(),
  },
  {
    ...block(
      [
        { type: 'if', props: { cond: 'flag' }, children: [trc('then')] },
        { type: 'else', children: [trc('else')] },
      ],
      [['flag', false]],
    ),
    description: 'if-else: false condition runs else branch only',
    expected: { events: [{ op: 'stdout', text: 'else' }], completion: { kind: 'normal' } },
  },
  {
    ...block(
      [
        { type: 'if', props: { cond: 'a' }, children: [trc('a')] },
        {
          type: 'else',
          children: [
            { type: 'if', props: { cond: 'b' }, children: [trc('b')] },
            { type: 'else', children: [trc('fallback')] },
          ],
        },
      ],
      [
        ['a', false],
        ['b', true],
      ],
    ),
    description: 'if-else-if-else: three-arm chain evaluates in order and runs middle arm',
    expected: { events: [{ op: 'stdout', text: 'b' }], completion: { kind: 'normal' } },
  },
  {
    ...block(
      [
        {
          type: 'if',
          props: { cond: 'outer' },
          children: [
            { type: 'if', props: { cond: 'inner' }, children: [trc('inner-then')] },
            { type: 'else', children: [trc('inner-else')] },
          ],
        },
        { type: 'else', children: [trc('outer-else')] },
      ],
      [
        ['outer', true],
        ['inner', false],
      ],
    ),
    description: 'nested-if: nested sibling else binds to the inner if before the outer else',
    expected: { events: [{ op: 'stdout', text: 'inner-else' }], completion: { kind: 'normal' } },
  },
  {
    ...block(
      [
        { type: 'if', props: { cond: 'zero' }, children: [trc('zero')] },
        { type: 'if', props: { cond: 'empty' }, children: [trc('empty')] },
        { type: 'if', props: { cond: 'nil' }, children: [trc('nil')] },
        { type: 'if', props: { cond: 'missing' }, children: [trc('missing')] },
        { type: 'if', props: { cond: 'nonzero' }, children: [trc('nonzero')] },
        { type: 'if', props: { cond: 'word' }, children: [trc('word')] },
      ],
      [
        ['zero', 0],
        ['empty', ''],
        ['nil', null],
        ['missing', undefined],
        ['nonzero', 7],
        ['word', 'x'],
      ],
    ),
    description: 'truthiness-edge: portable falsy and truthy primitives match across targets',
    expected: {
      events: [
        { op: 'stdout', text: 'nonzero' },
        { op: 'stdout', text: 'word' },
      ],
      completion: { kind: 'normal' },
    },
  },
  {
    ...block(
      [
        { type: 'if', props: { cond: 'flag' }, children: [{ type: 'return', props: { value: 42 } }] },
        { type: 'else', children: [trc('unreached')] },
      ],
      [['flag', true]],
    ),
    description: 'completion: return in selected branch propagates and skips else',
    expected: { events: [], completion: { kind: 'return', value: 42 } },
  },
]);

export const ifContract: NodeContract = {
  nodeType: 'if',
  preconditions: ifPreconditions,
  effects: ifEffects,
  completion: ifCompletion,
  forbiddenRewrites: FORBIDDEN_REWRITES,
  fixtures: FIXTURES,
};

let registered = false;

/** Idempotent registration. Test cleanup that clears the registry must re-call. */
export function registerIfContract(): void {
  if (registered) return;
  registerContract(ifContract);
  registered = true;
}

/** Reset registration flag — only for test cleanup that clears the registry. */
export function _resetIfContractForTest(): void {
  registered = false;
}
