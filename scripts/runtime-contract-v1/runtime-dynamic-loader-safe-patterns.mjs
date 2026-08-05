import { createHash } from 'node:crypto';

const CLASS_GRAPH_SUFFIXES = [
  '/packages/core/src/ir/semantics/internal-effect-machine-class-graph.ts',
  '/packages/core/dist/ir/semantics/internal-effect-machine-class-graph.js',
];

// Syntax-bound safety authority for the non-invoking body scan consumed below.
const CLASS_BODY_BUDGET_HELPER_DIGESTS = new Set([
  'c13d2a4925168a655849a952d5f0a90718214d849b012a8d337b5fe9ce8d3fb7',
  '34de452386889b0140d18c578ce09d48e9aa3162ae3607462a1742928d13a1d7',
]);

function transparent(ts, node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function isIdentifier(ts, node, name) {
  const current = transparent(ts, node);
  return ts.isIdentifier(current) && current.text === name;
}

function isRootMember(ts, node, root, member) {
  const current = transparent(ts, node);
  return ts.isPropertyAccessExpression(current) &&
    current.name.text === member &&
    isIdentifier(ts, current.expression, root);
}

function isConstructorSpread(ts, node, root) {
  if (!ts.isSpreadElement(node)) return false;
  const expression = transparent(ts, node.expression);
  if (!ts.isConditionalExpression(expression) || !isRootMember(ts, expression.condition, root, 'constructor')) {
    return false;
  }
  const whenTrue = transparent(ts, expression.whenTrue);
  const whenFalse = transparent(ts, expression.whenFalse);
  return ts.isArrayLiteralExpression(whenTrue) &&
    whenTrue.elements.length === 1 &&
    isRootMember(ts, whenTrue.elements[0], root, 'constructor') &&
    ts.isArrayLiteralExpression(whenFalse) &&
    whenFalse.elements.length === 0;
}

function isValuesSpread(ts, node, root, member) {
  if (!ts.isSpreadElement(node)) return false;
  const call = transparent(ts, node.expression);
  if (!ts.isCallExpression(call) || call.arguments.length !== 0) return false;
  const callee = transparent(ts, call.expression);
  return ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'values' &&
    isRootMember(ts, callee.expression, root, member);
}

function isBudgetCallback(ts, node) {
  const callback = transparent(ts, node);
  if (!ts.isArrowFunction(callback) || callback.parameters.length !== 1 || ts.isBlock(callback.body)) return false;
  const [parameter] = callback.parameters;
  if (!ts.isIdentifier(parameter.name) || parameter.initializer || parameter.dotDotDotToken) return false;
  const body = transparent(ts, callback.body);
  if (!ts.isCallExpression(body) || body.arguments.length !== 1 ||
      !isIdentifier(ts, body.expression, 'classBodyRequiresIterationBudget')) return false;
  const argument = transparent(ts, body.arguments[0]);
  return ts.isPropertyAccessExpression(argument) &&
    argument.name.text === 'body' &&
    isIdentifier(ts, argument.expression, parameter.name.text);
}

function syntaxDigest(ts, root) {
  function encode(node) {
    const parts = [String(node.kind)];
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) parts.push(node.text);
    node.forEachChild((child) => { parts.push(encode(child)); });
    return `(${parts.join('|')})`;
  }
  return createHash('sha256').update(encode(root)).digest('hex');
}

function hasApprovedHelper(ts, sourceFile) {
  const helpers = sourceFile.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'classBodyRequiresIterationBudget');
  return helpers.length === 1 && CLASS_BODY_BUDGET_HELPER_DIGESTS.has(syntaxDigest(ts, helpers[0]));
}

export function isApprovedClassBodyBudgetScan(ts, node, sourceFile, sourcePath) {
  const normalizedPath = sourcePath.replaceAll('\\', '/');
  if (!CLASS_GRAPH_SUFFIXES.some((suffix) => normalizedPath.endsWith(suffix)) || !hasApprovedHelper(ts, sourceFile)) {
    return false;
  }
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return false;
  const callee = transparent(ts, node.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'some') return false;
  const receiver = transparent(ts, callee.expression);
  if (!ts.isArrayLiteralExpression(receiver) || receiver.elements.length !== 3) return false;
  const first = receiver.elements[0];
  if (!ts.isSpreadElement(first)) return false;
  const condition = transparent(ts, first.expression);
  if (!ts.isConditionalExpression(condition)) return false;
  const rootExpression = transparent(ts, condition.condition);
  if (!ts.isPropertyAccessExpression(rootExpression) || !ts.isIdentifier(rootExpression.expression)) return false;
  const root = rootExpression.expression.text;
  return isConstructorSpread(ts, first, root) &&
    isValuesSpread(ts, receiver.elements[1], root, 'methods') &&
    isValuesSpread(ts, receiver.elements[2], root, 'getters') &&
    isBudgetCallback(ts, node.arguments[0]);
}
