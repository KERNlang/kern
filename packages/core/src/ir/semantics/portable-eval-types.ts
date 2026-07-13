import type { ValueIR } from '../../value-ir.js';
import type { SemanticEnv } from './index.js';
import type { PortableScalar } from './portable-scalar-domain.js';

export type EvalPortableValue = (node: ValueIR, env: SemanticEnv) => PortableScalar;

export const PORTABLE_EVAL_NOT_HANDLED: unique symbol = Symbol('portableEvalNotHandled');
export type PortableEvalNotHandled = typeof PORTABLE_EVAL_NOT_HANDLED;

/** Host-only scalar extensions. The shared evaluator owns recursion and all
 * portable operations; hosts may only service function/class leaves. */
export interface PortableEvaluatorHost {
  readonly classMember: (
    node: Extract<ValueIR, { kind: 'member' }>,
    env: SemanticEnv,
    evaluate: EvalPortableValue,
  ) => PortableScalar | PortableEvalNotHandled;
  readonly classMethod: (
    node: Extract<ValueIR, { kind: 'call' }>,
    env: SemanticEnv,
    evaluate: EvalPortableValue,
  ) => PortableScalar | PortableEvalNotHandled;
  readonly functionCall: (
    name: string,
    args: readonly ValueIR[],
    env: SemanticEnv,
    evaluate: EvalPortableValue,
  ) => PortableScalar;
}
