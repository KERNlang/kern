import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_PATH = resolve(REPO_ROOT, 'packages/core/src/ir/semantics/internal-effect-machine-class-graph.ts');
const BUILT_PATH = resolve(REPO_ROOT, 'packages/core/dist/ir/semantics/internal-effect-machine-class-graph.js');

export const APPROVED_CLASS_BODY_BUDGET_SCAN_PATHS = Object.freeze([SOURCE_PATH, BUILT_PATH]);
export const SAFE_PATTERN_STATUS = Object.freeze({
  approved: 'approved',
  authorityDrift: 'authority-drift',
  notApplicable: 'not-applicable',
});

// Token-tree safety authorities for the source and emitted non-invoking body scan.
const APPROVED_HELPER_DIGESTS = new Map([
  [SOURCE_PATH, '313564f7395995386db660969746dfa038b97c80769d6f9765044da522348fe6'],
  [BUILT_PATH, '8cb2fdb53b0e0bb4559301759bb60dfa6dbdb0a54cbb26579ee80f362ebfe36c'],
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

function isRootMember(ts, node, member) {
  const current = transparent(ts, node);
  return ts.isPropertyAccessExpression(current) &&
    current.name.text === member &&
    isIdentifier(ts, current.expression, 'cls');
}

function isConstructorSpread(ts, node) {
  if (!ts.isSpreadElement(node)) return false;
  const expression = transparent(ts, node.expression);
  if (!ts.isConditionalExpression(expression) || !isRootMember(ts, expression.condition, 'constructor')) return false;
  const whenTrue = transparent(ts, expression.whenTrue);
  const whenFalse = transparent(ts, expression.whenFalse);
  return ts.isArrayLiteralExpression(whenTrue) &&
    whenTrue.elements.length === 1 &&
    isRootMember(ts, whenTrue.elements[0], 'constructor') &&
    ts.isArrayLiteralExpression(whenFalse) &&
    whenFalse.elements.length === 0;
}

function isValuesSpread(ts, node, member) {
  if (!ts.isSpreadElement(node)) return false;
  const call = transparent(ts, node.expression);
  if (!ts.isCallExpression(call) || call.arguments.length !== 0) return false;
  const callee = transparent(ts, call.expression);
  return ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'values' &&
    isRootMember(ts, callee.expression, member);
}

function isBudgetCallback(ts, node) {
  const callback = transparent(ts, node);
  if (!ts.isArrowFunction(callback) || callback.parameters.length !== 1 || ts.isBlock(callback.body)) return false;
  const [parameter] = callback.parameters;
  if (!isIdentifier(ts, parameter.name, 'member') || parameter.initializer || parameter.dotDotDotToken) return false;
  const body = transparent(ts, callback.body);
  if (!ts.isCallExpression(body) || body.arguments.length !== 1 ||
      !isIdentifier(ts, body.expression, 'classBodyRequiresIterationBudget')) return false;
  const argument = transparent(ts, body.arguments[0]);
  return ts.isPropertyAccessExpression(argument) &&
    argument.name.text === 'body' &&
    isIdentifier(ts, argument.expression, 'member');
}

function hasOuterClsBinding(ts, node) {
  const callback = node.parent;
  if (!ts.isArrowFunction(callback) || transparent(ts, callback.body) !== node || callback.parameters.length !== 1 ||
      !isIdentifier(ts, callback.parameters[0].name, 'cls')) return false;
  const call = callback.parent;
  if (!ts.isCallExpression(call) || call.arguments.length !== 1 || call.arguments[0] !== callback) return false;
  const callee = transparent(ts, call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'some') return false;
  const receiver = transparent(ts, callee.expression);
  return ts.isArrayLiteralExpression(receiver) &&
    receiver.elements.length === 1 &&
    ts.isSpreadElement(receiver.elements[0]) &&
    isIdentifier(ts, receiver.elements[0].expression, 'seen');
}

function isCandidateScan(ts, node) {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1 || !hasOuterClsBinding(ts, node)) return false;
  const callee = transparent(ts, node.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'some') return false;
  const receiver = transparent(ts, callee.expression);
  return ts.isArrayLiteralExpression(receiver) &&
    receiver.elements.length === 3 &&
    isConstructorSpread(ts, receiver.elements[0]) &&
    isValuesSpread(ts, receiver.elements[1], 'methods') &&
    isValuesSpread(ts, receiver.elements[2], 'getters') &&
    isBudgetCallback(ts, node.arguments[0]);
}

function bindingIdentifiers(ts, name, out = []) {
  if (ts.isIdentifier(name)) out.push(name);
  else for (const element of name.elements ?? []) {
    if (ts.isBindingElement(element)) bindingIdentifiers(ts, element.name, out);
  }
  return out;
}

function helperBindings(ts, sourceFile) {
  const bindings = [];
  function add(name) {
    for (const identifier of bindingIdentifiers(ts, name)) {
      if (identifier.text === 'classBodyRequiresIterationBudget') bindings.push(identifier);
    }
  }
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) add(node.name);
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) add(node.name);
    if (ts.isImportClause(node) && node.name) add(node.name);
    if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)) add(node.name);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return bindings;
}

function approvedHelper(ts, sourceFile) {
  const helpers = sourceFile.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'classBodyRequiresIterationBudget');
  if (helpers.length !== 1) return null;
  const bindings = helperBindings(ts, sourceFile);
  return bindings.length === 1 && bindings[0] === helpers[0].name ? helpers[0] : null;
}

function syntaxDigest(ts, root, sourceFile) {
  function encode(node) {
    const children = node.getChildren(sourceFile).filter((child) => !(ts.isJSDoc?.(child) ?? false));
    if (children.length === 0) {
      const text = node.getText(sourceFile);
      return `L${node.kind}:${Buffer.byteLength(text)}:${text}`;
    }
    const payload = children.map((child) => encode(child)).map((child) => `${Buffer.byteLength(child)}:${child}`).join('');
    return `N${node.kind}:${children.length}:${Buffer.byteLength(payload)}:${payload}`;
  }
  return createHash('sha256').update(encode(root)).digest('hex');
}

function exactAuthorityPath(sourcePath) {
  if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath)) return null;
  const normalized = resolve(sourcePath);
  return APPROVED_HELPER_DIGESTS.has(normalized) ? normalized : null;
}

export function classBodyBudgetScanStatus(ts, node, sourceFile, sourcePath) {
  const authorityPath = exactAuthorityPath(sourcePath);
  if (!authorityPath || !isCandidateScan(ts, node)) return SAFE_PATTERN_STATUS.notApplicable;
  const helper = approvedHelper(ts, sourceFile);
  if (!helper) return SAFE_PATTERN_STATUS.authorityDrift;
  return syntaxDigest(ts, helper, sourceFile) === APPROVED_HELPER_DIGESTS.get(authorityPath)
    ? SAFE_PATTERN_STATUS.approved
    : SAFE_PATTERN_STATUS.authorityDrift;
}
