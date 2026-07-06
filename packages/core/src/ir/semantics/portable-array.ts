/**
 * Portable array-literal VALUES for the ReferenceRunner (slice-2a).
 *
 * Mirrors the product runtime (`core-runtime`'s `arrayLit` case): a `[...]`
 * literal eagerly, recursively evaluates its elements into ONE array value.
 * Elements are literal portable scalars (safe-integer number/string/bool/null)
 * plus NESTED array literals of the same. A non-portable element (non-canonical
 * numeric literal, computed numeric expression, Decimal, regex, object, an
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
import { isValueIR, type ValueIR } from '../../value-ir.js';
import type { SemanticEnv } from './index.js';
import { evalPortableValue, type PortableScalar } from './portable-scalar.js';

export type PortableArrayElement = PortableScalar | ReadonlyArray<PortableArrayElement>;

/** True iff `node` is an array-literal expression (`[...]`). */
export function isArrayLiteralExpression(node: ValueIR): node is Extract<ValueIR, { kind: 'arrayLit' }> {
  return node.kind === 'arrayLit';
}

function isCanonicalSafeIntegerLiteral(node: Extract<ValueIR, { kind: 'numLit' }>): boolean {
  if (node.bigint || !/^-?[0-9]+$/.test(node.raw)) return false;
  const value = Number(node.raw);
  return Number.isSafeInteger(value) && String(value) === node.raw && node.value === value;
}

function evalArrayLiteralItem(item: unknown, env: SemanticEnv): PortableArrayElement {
  if (!isValueIR(item)) {
    throw new Error('portable-array: array literal items must be value IR nodes');
  }
  const node: ValueIR = item;
  if (node.kind === 'arrayLit') return evalArrayLiteralValue(node, env);
  if (node.kind === 'numLit' && !isCanonicalSafeIntegerLiteral(node)) {
    throw new Error('portable-array: numeric elements must be canonical safe integers');
  }
  if (node.kind !== 'numLit' && node.kind !== 'strLit' && node.kind !== 'boolLit' && node.kind !== 'nullLit') {
    throw new Error('portable-array: elements must be literal scalars or nested array literals');
  }
  const value = evalPortableValue(node, env);
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error('portable-array: numeric elements must evaluate to safe integers');
  }
  return value;
}

/** Eagerly, recursively evaluate an array literal into a frozen array value.
 *  Scalar elements go through `evalPortableValue` (an out-of-domain element
 *  THROWS); nested array literals recurse. Throws on a non-arrayLit root. */
export function evalArrayLiteralValue(node: ValueIR, env: SemanticEnv): ReadonlyArray<PortableArrayElement> {
  if (node.kind !== 'arrayLit') {
    throw new Error('portable-array: expected an array literal expression');
  }
  if (!Array.isArray(node.items)) {
    throw new Error('portable-array: array literal items must be an array');
  }
  const items: PortableArrayElement[] = [];
  for (let index = 0; index < node.items.length; index += 1) {
    if (!(index in node.items)) {
      throw new Error('portable-array: array literal items must not contain sparse holes');
    }
    items.push(evalArrayLiteralItem(node.items[index], env));
  }
  return Object.freeze(items);
}
