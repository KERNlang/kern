import { Node, SyntaxKind } from 'ts-morph';

const OBSERVER_SIGNAL_NAMES = new Set(['wake', 'notify', 'signal']);
const CONSOLE_METHOD_NAMES = new Set(['error', 'info', 'log', 'warn']);

export function hasHandledSynchronousThenObserver(callExpr: import('ts-morph').CallExpression): boolean {
  const args = callExpr.getArguments();
  return args.length >= 2 && isSynchronousObserver(args[0]) && isSynchronousObserver(args[1]);
}

function isSynchronousObserver(node: import('ts-morph').Node): boolean {
  if (!Node.isArrowFunction(node) && !Node.isFunctionExpression(node)) return false;
  if (node.isAsync() || node.getDescendantsOfKind(SyntaxKind.AwaitExpression).length > 0) return false;

  const body = node.getBody();
  if (!Node.isBlock(body)) return false;
  if (body.getDescendantsOfKind(SyntaxKind.NewExpression).length > 0) return false;
  if (body.getDescendantsOfKind(SyntaxKind.ThrowStatement).length > 0) return false;
  if (body.getDescendantsOfKind(SyntaxKind.ReturnStatement).some((statement) => statement.getExpression() != null))
    return false;

  const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression);
  if (calls.some((call) => !isObserverCall(call))) return false;
  const parameterNames = new Set(node.getParameters().map((parameter) => parameter.getName()));
  const accesses = body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
  return (
    accesses.every((access) => isObserverPropertyAccess(access, parameterNames)) &&
    calls.length + countAssignments(body) > 0
  );
}

function isObserverCall(call: import('ts-morph').CallExpression): boolean {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return call.getArguments().length === 0 && OBSERVER_SIGNAL_NAMES.has(callee.getText());
  if (!Node.isPropertyAccessExpression(callee)) return false;
  return callee.getExpression().getText() === 'console' && CONSOLE_METHOD_NAMES.has(callee.getName());
}

function isObserverPropertyAccess(
  access: import('ts-morph').PropertyAccessExpression,
  parameterNames: ReadonlySet<string>,
): boolean {
  const parent = access.getParent();
  if (Node.isCallExpression(parent) && parent.getExpression() === access) return isObserverCall(parent);
  if (
    access.getName() === 'message' &&
    Node.isIdentifier(access.getExpression()) &&
    parameterNames.has(access.getExpression().getText()) &&
    Node.isCallExpression(parent) &&
    parent.getArguments().includes(access) &&
    isObserverCall(parent)
  ) {
    return true;
  }
  return (
    Node.isBinaryExpression(parent) &&
    parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
    parent.getLeft() === access &&
    access.getText() === 'process.exitCode'
  );
}

function countAssignments(body: import('ts-morph').Block): number {
  return body
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .filter((expression) => expression.getOperatorToken().getKind() === SyntaxKind.EqualsToken).length;
}
