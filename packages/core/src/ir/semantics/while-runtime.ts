import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import type { SemanticEnv } from './semantic-env.js';

export const WHILE_MAX_ITERATIONS = 100_000;

interface WhileProps {
  cond?: unknown;
}

export function evaluateWhileConditionWithEvaluator(
  ir: IRNode,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): boolean {
  const cond = (ir.props as WhileProps)?.cond;
  if (typeof cond !== 'string' || cond === '') {
    throw new Error('while: cond= must be a non-empty string expression');
  }
  const value = evaluate(parseExpression(cond), env);
  if (typeof value !== 'boolean') {
    throw new Error('while: condition must evaluate to a strict boolean (no truthy/numeric/string conditions)');
  }
  return value;
}

export function whilePreconditionsWithEvaluator(ir: IRNode, env: SemanticEnv, evaluate: EvalPortableValue): boolean {
  if (!Array.isArray(ir.children)) return false;
  try {
    evaluateWhileConditionWithEvaluator(ir, env, evaluate);
    return true;
  } catch {
    return false;
  }
}
