import { Node } from 'ts-morph';

const ORDERING_OPERATIONS = new Set(['reverse', 'sort']);
const TRANSPARENT_EXPRESSION_KINDS = new Set([
  'AsExpression',
  'NonNullExpression',
  'ParenthesizedExpression',
  'SatisfiesExpression',
  'TypeAssertionExpression',
]);

export function isConsumedCollectionOrderingOperation(access: import('ts-morph').PropertyAccessExpression): boolean {
  if (!ORDERING_OPERATIONS.has(access.getName())) return false;
  const call = access.getParent();
  if (!Node.isCallExpression(call) || call.getExpression() !== access) return false;

  let value: import('ts-morph').Node = call;
  let parent = value.getParent();
  while (parent && TRANSPARENT_EXPRESSION_KINDS.has(parent.getKindName())) {
    value = parent;
    parent = value.getParent();
  }
  return parent != null && !Node.isExpressionStatement(parent) && !Node.isVoidExpression(parent);
}
