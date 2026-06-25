/**
 * Portable array-literal VALUES for the ReferenceRunner (slice-2a).
 *
 * Mirrors the product runtime (`core-runtime`'s `arrayLit` case): a `[...]`
 * literal eagerly, recursively evaluates its elements into ONE array value.
 * Elements are the portable-scalar domain (number/string/bool/null) plus NESTED
 * array literals of the same. A non-portable element (Decimal, regex, object, an
 * unsupported call) makes evaluation THROW, which the `let` precondition catches
 * -> the runner ABSTAINS (fail-close).
 *
 * Arrays bind as PLAIN frozen JS arrays (not a tagged wrapper) because `each`
 * consumes native arrays directly (for...of). A plain array is NOT a portable
 * scalar, so any SCALAR-context read of an array binding (`print xs`, `xs + 1`,
 * `while cond=xs`, index `xs[0]`) still throws via `assertPortableScalar` ->
 * abstains. Only `each` iteration observes the array in this slice; whole-array
 * print, index access, and `.length` are deferred (they keep abstaining).
 */
import type { ValueIR } from '../../value-ir.js';
import type { SemanticEnv } from './index.js';
import { evalPortableValue, type PortableScalar } from './portable-scalar.js';

export type PortableArrayElement = PortableScalar | ReadonlyArray<PortableArrayElement>;

/** True iff `node` is an array-literal expression (`[...]`). */
export function isArrayLiteralExpression(node: ValueIR): node is Extract<ValueIR, { kind: 'arrayLit' }> {
  return node.kind === 'arrayLit';
}

/** Eagerly, recursively evaluate an array literal into a frozen array value.
 *  Scalar elements go through `evalPortableValue` (an out-of-domain element
 *  THROWS); nested array literals recurse. Throws on a non-arrayLit root. */
export function evalArrayLiteralValue(node: ValueIR, env: SemanticEnv): ReadonlyArray<PortableArrayElement> {
  if (node.kind !== 'arrayLit') {
    throw new Error('portable-array: expected an array literal expression');
  }
  const items = node.items.map((item) =>
    item.kind === 'arrayLit' ? evalArrayLiteralValue(item, env) : evalPortableValue(item, env),
  );
  return Object.freeze(items);
}
