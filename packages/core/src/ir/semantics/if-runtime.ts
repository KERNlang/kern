import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import { getBinding, hasBinding, type SemanticEnv } from './semantic-env.js';

export interface IfProps {
  cond?: string;
  __pairedElse?: IRNode;
}

function asIfProps(ir: IRNode): IfProps {
  return (ir.props ?? {}) as IfProps;
}

export function ifPreconditionsWithEvaluator(ir: IRNode, env: SemanticEnv, evaluate: EvalPortableValue): boolean {
  return validateIfNodeWithEvaluator(ir, env, evaluate);
}

export function validateIfNodeWithEvaluator(ir: IRNode, env: SemanticEnv, evaluate: EvalPortableValue): boolean {
  const props = asIfProps(ir);
  if (typeof props.cond !== 'string' || props.cond.trim().length === 0) return false;
  try {
    portableTruthy(conditionValue(props.cond, env, evaluate));
  } catch {
    return false;
  }
  return props.__pairedElse === undefined || validateElseNode(props.__pairedElse, env, evaluate);
}

function validateElseNode(ir: IRNode, env: SemanticEnv, evaluate: EvalPortableValue): boolean {
  if (ir.type !== 'else') return false;
  const children = ir.children ?? [];
  if (children.length === 1 && children[0].type === 'if') {
    return validateIfNodeWithEvaluator(children[0], env, evaluate);
  }
  if (children.length === 2 && children[0].type === 'if' && children[1].type === 'else') {
    return validateIfNodeWithEvaluator(
      {
        ...children[0],
        props: { ...(children[0].props ?? {}), __pairedElse: children[1] },
      },
      env,
      evaluate,
    );
  }
  return true;
}

function parseStringLiteral(text: string): string {
  if (text.startsWith('"')) return JSON.parse(text) as string;
  return text.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

function conditionValue(cond: string, env: SemanticEnv, evaluate: EvalPortableValue): unknown {
  // `if` owns portable expression truthiness, so both source quote styles are
  // intentional here; `branch` separately owns a narrower equality grammar.
  const trimmed = cond.trim();
  if (trimmed === 'true' || trimmed === 'True') return true;
  if (trimmed === 'false' || trimmed === 'False') return false;
  if (trimmed === 'null' || trimmed === 'undefined' || trimmed === 'None') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return parseStringLiteral(trimmed);
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) {
    if (!hasBinding(env, trimmed)) throw new Error(`if: binding "${trimmed}" not found in env`);
    return getBinding(env, trimmed);
  }
  if (trimmed.startsWith('!')) return !portableTruthy(conditionValue(trimmed.slice(1), env, evaluate));
  return evaluate(parseExpression(trimmed), env);
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

export function evaluateIfConditionWithEvaluator(ir: IRNode, env: SemanticEnv, evaluate: EvalPortableValue): boolean {
  const props = asIfProps(ir);
  if (typeof props.cond !== 'string' || props.cond.trim().length === 0) {
    throw new Error('if: cond= must be a non-empty string expression');
  }
  return portableTruthy(conditionValue(props.cond, env, evaluate));
}
