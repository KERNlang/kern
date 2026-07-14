import { isValueIR, type ValueIR } from '../../value-ir.js';
import { evalArrayLiteralValue, type PortableArrayElement } from './portable-array.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import { assertPortableScalar } from './portable-scalar-domain.js';
import type { SemanticEnv } from './semantic-env.js';

/**
 * Evaluate a returned array without widening stored-array semantics.
 *
 * Only top-level elements may be computed portable scalars. Nested arrays keep
 * the literal-only provenance enforced by evalArrayLiteralValue.
 */
export function evalPortableReturnArrayValue(
  node: ValueIR,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): ReadonlyArray<PortableArrayElement> {
  if (node.kind !== 'arrayLit') throw new Error('portable return array: expected an array literal');
  const items: PortableArrayElement[] = [];
  for (let index = 0; index < node.items.length; index += 1) {
    if (!(index in node.items)) throw new Error('portable return array: items must not contain sparse holes');
    const item = node.items[index];
    if (!isValueIR(item)) throw new Error('portable return array: items must be value IR nodes');
    items.push(
      item.kind === 'arrayLit'
        ? evalArrayLiteralValue(item, env, evaluate)
        : assertPortableScalar(evaluate(item, env), `return array element ${index}`),
    );
  }
  return Object.freeze(items);
}
