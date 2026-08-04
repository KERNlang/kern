import { readFileSync } from 'node:fs';
import ts from 'typescript';

import {
  aggregateFlowCategory,
  assignmentFlowCategory,
  assignmentTargetRoot,
  bindAssignmentPattern,
  callFlowCategory,
  createAliasMap,
  functionFlowCategory,
  isFlowAssignment,
  isForbiddenCallableCategory,
  isFunctionCategory,
  joinFlowCategories,
  memberFlowCategory,
  objectFlowCategory,
  scopedAliasCategories,
  scopedAliasKey,
  transparentFlowExpression,
} from './runtime-dynamic-loader-flow.mjs';

const proofInventory = JSON.parse(readFileSync(
  new URL('./proof-inventory.json', import.meta.url), 'utf8'));
const forbiddenDynamicBindings = new Set(proofInventory.forbiddenDynamicBindings);
const forbiddenDirectBindings = new Set(
  [...forbiddenDynamicBindings].filter(
    (name) => !['constructor', 'module'].includes(name),
  ),
);
const forbiddenAliasBindings = new Set([
  ...forbiddenDirectBindings,
  'Reflect',
  'dynamic-constructor',
  'reflective-loader',
  'require',
]);
const globalLoaderMembers = new Set(['Function', 'eval', 'importScripts', 'process', 'require']);
const processLoaderMembers = new Set(['_linkedBinding', 'binding', 'getBuiltinModule']);
const reflectiveLoaderMembers = new Set([
  'construct',
  'get',
  'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors',
  'getPrototypeOf',
]);
const globalFunctionIdentifiers = new Set([
  'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'DataView', 'Date', 'Error', 'EvalError',
  'FinalizationRegistry', 'Map', 'Number', 'Object', 'Promise', 'Proxy', 'RangeError',
  'ReferenceError', 'RegExp', 'Set', 'SharedArrayBuffer', 'String', 'Symbol', 'SyntaxError',
  'TypeError', 'URIError', 'WeakMap', 'WeakRef', 'WeakSet',
]);
const globalFunctionNamespaces = new Set([...globalFunctionIdentifiers, 'JSON', 'Math', 'Reflect']);

export const RUNTIME_DYNAMIC_ESCAPE_BINDINGS = Object.freeze(
  [...proofInventory.forbiddenDynamicBindings],
);
export const RUNTIME_REFLECTIVE_ESCAPE_MEMBERS = Object.freeze(
  [...reflectiveLoaderMembers],
);

function fail(message) { throw new Error(`runtime-envelope import closure: ${message}`); }

function importHasRuntimeValue(node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings?.elements.some((element) => !element.isTypeOnly) ?? false;
}

function exportHasRuntimeValue(node) {
  if (node.isTypeOnly) return false;
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return true;
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function identifierIsNonRuntimeName(node) {
  const parent = node.parent;
  if (ts.isTypeNode(parent) || ts.isQualifiedName(parent)) return true;
  if (
    (ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertyAccessExpression(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  return (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isImportClause(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isBindingElement(parent)) &&
    parent.name === node
  );
}

function staticString(node, stringAliases) {
  const expression = transparentFlowExpression(ts, node);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans) {
      const substitution = staticString(span.expression, stringAliases);
      if (substitution === null) return null;
      value += substitution + span.literal.text;
    }
    return value;
  }
  if (ts.isIdentifier(expression)) {
    const values = stringAliases.get(expression.text);
    return values?.size === 1 ? values.values().next().value : null;
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(expression.left, stringAliases);
    const right = staticString(expression.right, stringAliases);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

function expressionCategory(node, aliases, stringAliases) {
  const expression = transparentFlowExpression(ts, node);
  if (ts.isIdentifier(expression)) {
    const categories = scopedAliasCategories(aliases, expression);
    if (categories?.size === 1) return categories.values().next().value;
    if (categories && categories.size > 1) return 'ambiguous-dynamic';
    if (expression.text === 'Reflect') return 'Reflect';
    if (expression.text === 'JSON' || expression.text === 'Math') return 'function-namespace';
    if (globalFunctionIdentifiers.has(expression.text)) return 'function-object';
    return forbiddenDynamicBindings.has(expression.text) ? expression.text : null;
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return functionFlowCategory(ts, expression);
  }
  if (ts.isClassExpression(expression)) return 'function-object';
  if (ts.isArrayLiteralExpression(expression) || ts.isObjectLiteralExpression(expression)) {
    return aggregateFlowCategory(ts, expression,
      (value) => expressionCategory(value, aliases, stringAliases),
      (name) => ts.isComputedPropertyName(name) ? staticString(name.expression, stringAliases) :
        'text' in name ? name.text : null);
  }
  if (ts.isConditionalExpression(expression)) {
    return joinFlowCategories(
      expressionCategory(expression.whenTrue, aliases, stringAliases),
      expressionCategory(expression.whenFalse, aliases, stringAliases),
    );
  }
  if (ts.isAwaitExpression(expression)) return expressionCategory(expression.expression, aliases, stringAliases);
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind;
    if (kind === ts.SyntaxKind.CommaToken) return expressionCategory(expression.right, aliases, stringAliases);
    if (
      kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return joinFlowCategories(
        expressionCategory(expression.left, aliases, stringAliases),
        expressionCategory(expression.right, aliases, stringAliases),
      );
    }
    if (isFlowAssignment(ts, kind)) {
      return assignmentFlowCategory(ts, expression, (value) => expressionCategory(value, aliases, stringAliases));
    }
  }
  if (ts.isCallExpression(expression)) {
    const flow = callFlowCategory(ts, expression, (value) => expressionCategory(value, aliases, stringAliases));
    if (flow) return flow;
    const callee = transparentFlowExpression(ts, expression.expression);
    const objectMember =
      (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
      ts.isIdentifier(transparentFlowExpression(ts, callee.expression)) &&
      transparentFlowExpression(ts, callee.expression).text === 'Object'
        ? (ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : staticString(callee.argumentExpression, stringAliases))
        : null;
    if (objectMember === 'getOwnPropertyDescriptor' && expression.arguments.length >= 2) {
      const member = staticString(expression.arguments[1], stringAliases);
      const target = expressionCategory(expression.arguments[0], aliases, stringAliases);
      if (member === 'constructor' || (member === null && target === 'function-object')) {
        return 'constructor-descriptor';
      }
    }
    if (
      objectMember === 'getOwnPropertyDescriptors' &&
      expression.arguments.length === 1 &&
      expressionCategory(expression.arguments[0], aliases, stringAliases) === 'function-object'
    ) return 'function-descriptors';
    if (
      objectMember === 'getPrototypeOf' &&
      expression.arguments.length === 1 &&
      expressionCategory(expression.arguments[0], aliases, stringAliases) === 'function-object'
    ) {
      return 'function-object';
    }
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const base = expressionCategory(expression.expression, aliases, stringAliases);
    const member = ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : staticString(expression.argumentExpression, stringAliases);
    if (isFunctionCategory(base) && member === null) return 'ambiguous-dynamic';
    if (base === 'function-namespace') return member === null ? 'ambiguous-dynamic' : 'function-object';
    const contained = memberFlowCategory(base, member);
    if (contained) return contained;
    if (base === 'derived-dynamic') {
      return member === null || ['apply', 'bind', 'call', 'constructor'].includes(member)
        ? base
        : null;
    }
    if (base === 'flow-constructor') return base;
    if (base === 'function-descriptors' && (member === null || member === 'constructor')) {
      return 'constructor-descriptor';
    }
    if (member === 'constructor') return isFunctionCategory(base) ? 'dynamic-constructor' : 'constructor';
    if (base === 'constructor-descriptor' && member === 'value') return 'dynamic-constructor';
    if ((base === 'globalThis' || base === 'global') && member && globalLoaderMembers.has(member)) return member;
    if (base === 'module' && member === 'require') return 'require';
    if (base === 'process' && member && processLoaderMembers.has(member)) return member;
    if (base === 'Reflect' && member && reflectiveLoaderMembers.has(member)) return 'reflective-loader';
    const receiver = transparentFlowExpression(ts, expression.expression);
    if (base && base !== 'Reflect' && forbiddenAliasBindings.has(base)) return base;
    if (ts.isIdentifier(receiver) && globalFunctionNamespaces.has(receiver.text) && member !== 'prototype') {
      return 'function-object';
    }
    if (
      member !== null &&
      (ts.isPropertyAccessExpression(receiver) || ts.isElementAccessExpression(receiver)) &&
      (ts.isPropertyAccessExpression(receiver)
        ? receiver.name.text === 'prototype'
        : staticString(receiver.argumentExpression, stringAliases) === 'prototype')
    ) {
      return 'function-object';
    }
  }
  return null;
}

function destructuredMemberCategory(base, member) {
  const contained = memberFlowCategory(base, member);
  if (contained) return contained;
  if (isFunctionCategory(base) && member === null) return 'ambiguous-dynamic';
  if (member === 'constructor' && isFunctionCategory(base)) return 'dynamic-constructor';
  if ((base === 'globalThis' || base === 'global') && member && globalLoaderMembers.has(member)) return member;
  if (base === 'module' && member === 'require') return 'require';
  if (base === 'process' && member && processLoaderMembers.has(member)) return member;
  if (base === 'Reflect' && member && reflectiveLoaderMembers.has(member)) return 'reflective-loader';
  return base && forbiddenAliasBindings.has(base) ? base : null;
}

function collectAliases(sourceFile) {
  const aliases = createAliasMap(ts, sourceFile);
  const stringAliases = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    function add(map, name, value) {
      const values = map.get(name) ?? new Set();
      if (values.has(value)) return;
      values.add(value);
      map.set(name, values);
      changed = true;
    }
    const categoryOf = (value) => expressionCategory(value, aliases, stringAliases);
    const memberNameOf = (name) => ts.isComputedPropertyName(name) ? staticString(name.expression, stringAliases) :
      'text' in name ? name.text : null;
    function bind(name, initializer) {
      if (!initializer) return;
      if (ts.isArrayBindingPattern(name) || ts.isObjectBindingPattern(name)) {
        bindAssignmentPattern(
          ts, name, categoryOf(initializer), categoryOf,
          memberNameOf, destructuredMemberCategory, bindCategoryTarget,
        );
        return;
      }
      if (!ts.isIdentifier(name)) return;
      const literal = staticString(initializer, stringAliases);
      if (literal !== null) add(stringAliases, name.text, literal);
      const category = categoryOf(initializer);
      if (category) add(aliases, scopedAliasKey(aliases, name, category), category);
    }
    function bindCategoryTarget(target, category) {
      const { container, root } = assignmentTargetRoot(ts, target);
      const value = container ? objectFlowCategory(category) : category;
      if (value && !ts.isIdentifier(root)) fail(`unresolved dynamic assignment target ${JSON.stringify(target.getText(sourceFile))}`);
      if (value) add(aliases, scopedAliasKey(aliases, root, value), value);
    }
    function visit(node) {
      if (ts.isVariableDeclaration(node)) bind(node.name, node.initializer);
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
        const category = ts.isFunctionDeclaration(node) ? functionFlowCategory(ts, node) : 'function-object';
        add(aliases, scopedAliasKey(aliases, node.name, category), category);
      }
      if (
        ts.isBinaryExpression(node) &&
        isFlowAssignment(ts, node.operatorToken.kind) &&
        (ts.isIdentifier(node.left) || ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
      ) {
        if (ts.isIdentifier(node.left) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) bind(node.left, node.right);
        else bindCategoryTarget(node.left, assignmentFlowCategory(ts, node, categoryOf));
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        (ts.isArrayLiteralExpression(transparentFlowExpression(ts, node.left)) ||
          ts.isObjectLiteralExpression(transparentFlowExpression(ts, node.left)))
      ) {
        bindAssignmentPattern(
          ts,
          node.left,
          categoryOf(node.right),
          categoryOf,
          memberNameOf,
          destructuredMemberCategory,
          bindCategoryTarget,
        );
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return { aliases, stringAliases };
}

function isDynamicConstructorAccess(node, aliases, stringAliases) {
  const member = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : staticString(node.argumentExpression, stringAliases);
  const base = expressionCategory(node.expression, aliases, stringAliases);
  if (member === null && isFunctionCategory(base)) return true;
  if (member !== 'constructor') return false;
  const parent = node.parent;
  const parentMember = ts.isPropertyAccessExpression(parent)
    ? parent.name.text
    : ts.isElementAccessExpression(parent)
      ? staticString(parent.argumentExpression, stringAliases)
      : null;
  if (
    ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) ||
    ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === node &&
      parentMember === 'constructor')
  ) {
    return true;
  }
  return isFunctionCategory(base);
}

function isHostLoaderAccess(node, aliases, stringAliases) {
  const host = expressionCategory(node.expression, aliases, stringAliases);
  const member = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : staticString(node.argumentExpression, stringAliases);
  if (host === 'process') return member === null || processLoaderMembers.has(member);
  if (host === 'module') return member === null || member === 'require';
  if (host === 'globalThis' || host === 'global') return member === null || globalLoaderMembers.has(member);
  if (host === 'Reflect') return member === null || reflectiveLoaderMembers.has(member);
  return false;
}

function isInvokedAlias(node, stringAliases) {
  let current = node;
  let parent = current.parent;
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isNonNullExpression(parent)) &&
    parent.expression === current
  ) {
    current = parent;
    parent = current.parent;
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === current) return true;
  if (ts.isTaggedTemplateExpression(parent) && parent.tag === current) return true;
  if (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === current
  ) {
    const member = ts.isPropertyAccessExpression(parent)
      ? parent.name.text
      : staticString(parent.argumentExpression, stringAliases);
    return member === 'apply' || member === 'bind' || member === 'call' || member === 'constructor';
  }
  return false;
}

function isForbiddenInvocation(node, aliases, stringAliases) {
  const expression = ts.isTaggedTemplateExpression(node) ? node.tag : node.expression;
  const category = expressionCategory(expression, aliases, stringAliases);
  return isForbiddenCallableCategory(category) ||
    (ts.isCallExpression(node) && expressionCategory(node, aliases, stringAliases) === 'dynamic-invocation');
}

function isForbiddenCapabilityAccess(node, aliases, stringAliases) {
  const category = expressionCategory(node, aliases, stringAliases);
  const assignmentTarget =
    ts.isBinaryExpression(node.parent) &&
    node.parent.left === node &&
    node.parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
  if (category === 'derived-dynamic' && assignmentTarget) return false;
  return category === 'dynamic-constructor' ||
    category === 'ambiguous-dynamic';
}

export function runtimeModuleSpecifiers(source, sourcePath) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((sourceFile.parseDiagnostics ?? []).length > 0) fail(`cannot parse ${sourcePath}`);
  const specifiers = [];
  const { aliases, stringAliases } = collectAliases(sourceFile);
  function visit(node) {
    if (ts.isImportDeclaration(node) && importHasRuntimeValue(node)) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) fail(`non-literal import in ${sourcePath}`);
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const specifier = node.moduleReference.expression;
      if (!specifier || !ts.isStringLiteral(specifier)) fail(`non-literal import-equals in ${sourcePath}`);
      specifiers.push(specifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && exportHasRuntimeValue(node)) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) fail(`non-literal export in ${sourcePath}`);
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (!argument || !ts.isStringLiteral(argument)) fail(`non-literal dynamic import in ${sourcePath}`);
      specifiers.push(argument.text);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const [argument] = node.arguments;
      if (!argument || !ts.isStringLiteral(argument)) fail(`non-literal require in ${sourcePath}`);
      specifiers.push(argument.text);
    } else if (
      (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) &&
      isForbiddenInvocation(node, aliases, stringAliases)
    ) {
      fail(`dynamic constructor invocation ${JSON.stringify(node.getText(sourceFile))} in ${sourcePath}`);
    } else if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      (isDynamicConstructorAccess(node, aliases, stringAliases) ||
        isHostLoaderAccess(node, aliases, stringAliases) ||
        isForbiddenCapabilityAccess(node, aliases, stringAliases))
    ) {
      fail(`dynamic loader access ${JSON.stringify(node.getText(sourceFile))} in ${sourcePath}`);
    } else if (
      ts.isIdentifier(node) &&
      node.text === 'require' &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      fail(`indirect require in ${sourcePath}`);
    } else if (
      ts.isIdentifier(node) &&
      node.text === 'Reflect' &&
      !(
        (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) &&
        node.parent.expression === node
      )
    ) {
      fail(`indirect Reflect in ${sourcePath}`);
    } else if (ts.isIdentifier(node) && !identifierIsNonRuntimeName(node)) {
      const categories = scopedAliasCategories(aliases, node);
      const category = expressionCategory(node, aliases, stringAliases) ?? node.text;
      if (
        category === 'ambiguous-dynamic' ||
        (categories
          ? [...categories].some(
              (candidate) =>
                forbiddenAliasBindings.has(candidate) ||
                (candidate === 'constructor' && isInvokedAlias(node, stringAliases)),
            )
          : forbiddenDirectBindings.has(category))
      ) {
        fail(`forbidden dynamic binding ${category} ${JSON.stringify(node.getText(sourceFile))} in ${sourcePath}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}
