import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  approvedSafePatternHelper,
  safePatternSyntaxDigest,
} from './runtime-dynamic-loader-safe-pattern-kernel.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_PATH = resolve(REPO_ROOT, 'packages/core/src/ir/semantics/internal-effect-machine-class-graph.ts');
const BUILT_PATH = resolve(REPO_ROOT, 'packages/core/dist/ir/semantics/internal-effect-machine-class-graph.js');

export const RUNTIME_DYNAMIC_LOADER_SAFE_PATTERN_AUTHORITIES = Object.freeze([
  Object.freeze({
    label: 'source',
    declaredPath: SOURCE_PATH,
    expectedDigest: '313564f7395995386db660969746dfa038b97c80769d6f9765044da522348fe6',
  }),
  Object.freeze({
    label: 'built',
    declaredPath: BUILT_PATH,
    expectedDigest: '8cb2fdb53b0e0bb4559301759bb60dfa6dbdb0a54cbb26579ee80f362ebfe36c',
  }),
]);
export const APPROVED_CLASS_BODY_BUDGET_SCAN_PATHS = Object.freeze(
  RUNTIME_DYNAMIC_LOADER_SAFE_PATTERN_AUTHORITIES.map(({ declaredPath }) => declaredPath),
);
export const SAFE_PATTERN_STATUS = Object.freeze({
  approved: 'approved',
  authorityDrift: 'authority-drift',
  notApplicable: 'not-applicable',
});

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

function canonicalPath(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

function authorityResolution(sourcePath) {
  if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath)) return { status: 'unauthorized' };
  const normalized = resolve(sourcePath);
  const callerCanonicalPath = canonicalPath(normalized);
  const records = RUNTIME_DYNAMIC_LOADER_SAFE_PATTERN_AUTHORITIES.map((authority) => ({
    ...authority,
    canonicalPath: canonicalPath(authority.declaredPath),
  }));
  if (!callerCanonicalPath) {
    const declaredAuthority = records.find(({ declaredPath }) => declaredPath === normalized);
    return { status: declaredAuthority ? 'drift' : 'unauthorized' };
  }
  const matches = records.filter(({ canonicalPath: authorityPath }) => authorityPath === callerCanonicalPath);
  if (matches.length > 1) return { status: 'drift' };
  return matches.length === 1 ? { status: 'matched', authority: matches[0] } : { status: 'unauthorized' };
}

export function classBodyBudgetScanStatus(ts, node, sourceFile, sourcePath) {
  if (!isCandidateScan(ts, node)) return SAFE_PATTERN_STATUS.notApplicable;
  const resolution = authorityResolution(sourcePath);
  if (resolution.status === 'unauthorized') return SAFE_PATTERN_STATUS.notApplicable;
  if (resolution.status === 'drift') return SAFE_PATTERN_STATUS.authorityDrift;
  const helper = approvedSafePatternHelper(ts, sourceFile);
  if (!helper) return SAFE_PATTERN_STATUS.authorityDrift;
  return safePatternSyntaxDigest(ts, helper, sourceFile) === resolution.authority.expectedDigest
    ? SAFE_PATTERN_STATUS.approved
    : SAFE_PATTERN_STATUS.authorityDrift;
}
