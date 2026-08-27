import { Node } from 'ts-morph';

const RETURNED_ORDERING_OPERATIONS = new Set(['reverse', 'sort']);

export function isReturnedCollectionOrderingOperation(access: import('ts-morph').PropertyAccessExpression): boolean {
  if (!RETURNED_ORDERING_OPERATIONS.has(access.getName())) return false;
  const call = access.getParent();
  return Node.isCallExpression(call) && call.getExpression() === access && Node.isReturnStatement(call.getParent());
}
