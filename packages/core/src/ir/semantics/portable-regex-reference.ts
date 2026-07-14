import type { ValueIR } from '../../value-ir.js';
import { evalRegexTestExpression as evalRegexTestExpressionWithEvaluator } from './portable-regex.js';
import { evalPortableValue } from './portable-scalar.js';
import type { SemanticEnv } from './semantic-env.js';

/** Reference-host compatibility adapter for the historical public two-argument API. */
export function evalRegexTestExpression(node: ValueIR, env: SemanticEnv): boolean {
  return evalRegexTestExpressionWithEvaluator(node, env, evalPortableValue);
}
