const FUNCTION_FLOW_PREFIX = 'function-flow:';
const CONTAINER_FLOW_PREFIX = /^(array|object)-flow:(.+)$/u;
const OBJECT_RECORD_PREFIX = 'object-record-flow:';
const ALIAS_METADATA = new WeakMap();

function bindingIdentifiers(ts, name, out = []) {
  if (ts.isIdentifier(name)) out.push(name);
  else for (const element of name.elements ?? []) {
    if (ts.isBindingElement(element)) bindingIdentifiers(ts, element.name, out);
  }
  return out;
}

function scopeAncestors(ts, node) {
  const scopes = [];
  let current = node;
  while (current) {
    if (
      ts.isBlock(current) || ts.isFunctionLike(current) || ts.isSourceFile(current) ||
      ts.isCatchClause(current) || ts.isCaseBlock(current) || ts.isForStatement(current) ||
      ts.isForInStatement(current) || ts.isForOfStatement(current) || ts.isModuleBlock(current) ||
      ts.isClassStaticBlockDeclaration(current)
    ) scopes.push(current);
    current = current.parent;
  }
  return scopes;
}

function functionHasParameterExpressions(ts, node) {
  return node.parameters.some((parameter) =>
    parameter.dotDotDotToken || parameter.initializer || !ts.isIdentifier(parameter.name));
}

function functionVarScope(ts, node) {
  return functionHasParameterExpressions(ts, node) && node.body && ts.isBlock(node.body) ? node.body : node;
}

function nearestVarScope(ts, start, sourceFile) {
  let current = start;
  while (current) {
    if (ts.isClassStaticBlockDeclaration(current) || ts.isModuleBlock(current)) return current;
    if (ts.isFunctionLike(current)) return functionVarScope(ts, current);
    if (ts.isSourceFile(current)) return current;
    current = current.parent;
  }
  return sourceFile;
}

export function createAliasMap(ts, sourceFile) {
  const aliases = new Map();
  const bindingScopes = new WeakMap();
  const scopeBindings = new Map();
  function registerInScope(identifier, scope) {
    bindingScopes.set(identifier, scope);
    const names = scopeBindings.get(scope) ?? new Set();
    names.add(identifier.text);
    scopeBindings.set(scope, names);
  }
  function register(identifier, start, blockScoped = true) {
    const ancestors = scopeAncestors(ts, start);
    registerInScope(identifier, blockScoped ? ancestors[0] ?? sourceFile : nearestVarScope(ts, start, sourceFile));
  }
  function visit(node) {
    if (ts.isVariableDeclaration(node)) {
      const blockScoped = !ts.isVariableDeclarationList(node.parent) ||
        (node.parent.flags & ts.NodeFlags.BlockScoped) !== 0;
      for (const identifier of bindingIdentifiers(ts, node.name)) register(identifier, node.parent, blockScoped);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      const owner = ts.isBlock(node.parent) && ts.isFunctionLike(node.parent.parent) && node.parent.parent.body === node.parent
        ? node.parent.parent : null;
      if (owner) registerInScope(node.name, functionVarScope(ts, owner));
      else register(node.name, node.parent);
    } else if (ts.isClassDeclaration(node) && node.name) {
      register(node.name, node.parent);
    }
    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) {
        for (const identifier of bindingIdentifiers(ts, parameter.name)) register(identifier, node);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  ALIAS_METADATA.set(aliases, { bindingScopes, scopeBindings, sourceFile, ts });
  return aliases;
}

function bindingScope(aliases, identifier) {
  const metadata = ALIAS_METADATA.get(aliases);
  if (!metadata) return null;
  const declared = metadata.bindingScopes.get(identifier);
  if (declared) return declared;
  return referenceScope(metadata, identifier);
}

function referenceScope(metadata, identifier) {
  return scopeAncestors(metadata.ts, identifier).find((scope) =>
    metadata.scopeBindings.get(scope)?.has(identifier.text)) ?? metadata.sourceFile;
}

export function scopedAliasCategories(aliases, identifier) {
  const categories = new Set(aliases.get(identifier.text) ?? []);
  const scope = bindingScope(aliases, identifier);
  for (const category of aliases.get(`${scope?.pos}:${scope?.end}:${identifier.text}`) ?? []) {
    categories.add(category);
  }
  return categories.size > 0 ? categories : null;
}

export function scopedAliasKey(aliases, identifier, _category) {
  const scope = bindingScope(aliases, identifier);
  return `${scope?.pos}:${scope?.end}:${identifier.text}`;
}

export function scopedAliasWriteKey(aliases, identifier, _category) {
  const metadata = ALIAS_METADATA.get(aliases);
  const scope = metadata ? referenceScope(metadata, identifier) : null;
  return `${scope?.pos}:${scope?.end}:${identifier.text}`;
}

function parameterReferences(ts, root, parameterIndices) {
  const found = new Set();
  function visit(node) {
    if (node !== root && (ts.isFunctionLike(node) || ts.isClassLike(node))) return;
    if (ts.isIdentifier(node) && parameterIndices.has(node.text)) found.add(parameterIndices.get(node.text));
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

export function transparentFlowExpression(ts, expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isExpressionWithTypeArguments(current)
  ) {
    current = current.expression;
  }
  return current;
}

export function joinFlowCategories(...categories) {
  const distinct = new Set(categories.filter(Boolean));
  if (distinct.size === 0) return null;
  return distinct.size === 1 ? distinct.values().next().value : 'ambiguous-dynamic';
}

function objectRecord(category) {
  if (!category?.startsWith(OBJECT_RECORD_PREFIX)) return null;
  return JSON.parse(category.slice(OBJECT_RECORD_PREFIX.length));
}

function objectRecordCategory(entries, fallback) {
  if (entries.size === 0 && !fallback) return null;
  return `${OBJECT_RECORD_PREFIX}${JSON.stringify({ entries: [...entries], fallback })}`;
}

export function memberFlowCategory(category, member) {
  const record = objectRecord(category);
  if (!record) return containedFlowCategory(category);
  const entries = new Map(record.entries);
  return member === null
    ? joinFlowCategories(...entries.values(), record.fallback)
    : joinFlowCategories(entries.get(member), record.fallback);
}

function isLogicalValueOperator(ts, kind) {
  return kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken;
}

export function isFlowAssignment(ts, kind) {
  return kind === ts.SyntaxKind.EqualsToken || kind === ts.SyntaxKind.BarBarEqualsToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken || kind === ts.SyntaxKind.QuestionQuestionEqualsToken;
}

export function assignmentFlowCategory(ts, expression, categoryOf) {
  const kind = expression.operatorToken.kind;
  if (kind === ts.SyntaxKind.EqualsToken) return categoryOf(expression.right);
  if (isFlowAssignment(ts, kind)) {
    return joinFlowCategories(categoryOf(expression.left), categoryOf(expression.right));
  }
  return null;
}

function selectedParameterIndices(ts, expression, parameterIndices) {
  const current = transparentFlowExpression(ts, expression);
  if (ts.isIdentifier(current)) {
    const index = parameterIndices.get(current.text);
    return index === undefined ? new Set() : new Set([index]);
  }
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const member = ts.isPropertyAccessExpression(current) ? current.name.text :
      ts.isStringLiteral(current.argumentExpression) ? current.argumentExpression.text : null;
    return ['apply', 'bind', 'call', 'constructor'].includes(member)
      ? selectedParameterIndices(ts, current.expression, parameterIndices) : new Set();
  }
  if (ts.isConditionalExpression(current)) {
    return new Set([
      ...selectedParameterIndices(ts, current.whenTrue, parameterIndices),
      ...selectedParameterIndices(ts, current.whenFalse, parameterIndices),
    ]);
  }
  if (ts.isAwaitExpression(current)) return selectedParameterIndices(ts, current.expression, parameterIndices);
  if (!ts.isBinaryExpression(current)) return new Set();
  const kind = current.operatorToken.kind;
  if (kind === ts.SyntaxKind.CommaToken || kind === ts.SyntaxKind.EqualsToken) {
    return selectedParameterIndices(ts, current.right, parameterIndices);
  }
  if (isLogicalValueOperator(ts, kind) || isFlowAssignment(ts, kind)) {
    return new Set([
      ...selectedParameterIndices(ts, current.left, parameterIndices),
      ...selectedParameterIndices(ts, current.right, parameterIndices),
    ]);
  }
  return new Set();
}

export function functionFlowCategory(ts, node) {
  const parameterIndices = new Map();
  node.parameters.forEach((parameter, index) => {
    if (ts.isIdentifier(parameter.name)) parameterIndices.set(parameter.name.text, index);
  });
  if (parameterIndices.size === 0) return 'function-object';
  const returned = new Set();
  const derived = new Set();
  const arrayContained = new Set();
  const objectContained = new Set();
  const invoked = new Set();
  const body = node.body;
  if (!body) return 'function-object';
  function recordReturn(expression) {
    const direct = selectedParameterIndices(ts, expression, parameterIndices);
    if (direct.size > 0) {
      for (const index of direct) returned.add(index);
      return;
    }
    const references = parameterReferences(ts, expression, parameterIndices);
    const unwrapped = transparentFlowExpression(ts, expression);
    const container = ts.isArrayLiteralExpression(unwrapped)
      ? arrayContained
      : ts.isObjectLiteralExpression(unwrapped) ? objectContained : null;
    for (const index of references) (container ?? derived).add(index);
  }
  if (ts.isExpression(body)) recordReturn(body);
  function visit(current) {
    if (current !== body && (ts.isFunctionLike(current) || ts.isClassLike(current))) return;
    if (ts.isReturnStatement(current) && current.expression) recordReturn(current.expression);
    if (ts.isCallExpression(current) || ts.isNewExpression(current) || ts.isTaggedTemplateExpression(current)) {
      const callee = ts.isTaggedTemplateExpression(current) ? current.tag : current.expression;
      for (const index of selectedParameterIndices(ts, callee, parameterIndices)) invoked.add(index);
    }
    ts.forEachChild(current, visit);
  }
  visit(body);
  if (
    returned.size === 0 && derived.size === 0 && arrayContained.size === 0 &&
    objectContained.size === 0 && invoked.size === 0
  ) return 'function-object';
  return `${FUNCTION_FLOW_PREFIX}r=${[...returned].join(',')};d=${[...derived].join(',')};a=${[...arrayContained].join(',')};o=${[...objectContained].join(',')};i=${[...invoked].join(',')}`;
}

function flowIndices(category, key) {
  if (!category?.startsWith(FUNCTION_FLOW_PREFIX)) return [];
  const match = new RegExp(`${key}=([^;]*)`, 'u').exec(category);
  return match?.[1] ? match[1].split(',').map(Number) : [];
}

export function isFunctionCategory(category) {
  return category === 'function-object' || category?.startsWith(FUNCTION_FLOW_PREFIX);
}

export function isForbiddenCallableCategory(category) {
  return category === 'ambiguous-dynamic' ||
    category === 'constructor' ||
    category === 'dynamic-constructor' ||
    category === 'dynamic-invocation' ||
    category === 'derived-dynamic' ||
    category === 'flow-constructor';
}

function flowedCategory(category) {
  const contained = containedFlowCategory(category);
  const value = contained ?? category;
  if (value === 'constructor' || value === 'flow-constructor') return 'flow-constructor';
  return isFunctionCategory(value) ? 'function-object' : value;
}

export function callFlowCategory(ts, expression, categoryOf) {
  const calleeCategory = categoryOf(expression.expression);
  const invoked = flowIndices(calleeCategory, 'i');
  if (invoked.some((index) =>
    expression.arguments[index] &&
    isForbiddenCallableCategory(flowedCategory(categoryOf(expression.arguments[index]))))) {
    return 'dynamic-invocation';
  }
  for (const [key, kind] of [['a', 'array'], ['o', 'object']]) {
    const contained = new Set(flowIndices(calleeCategory, key)
      .map((index) => expression.arguments[index] ? flowedCategory(categoryOf(expression.arguments[index])) : null)
      .filter(Boolean));
    if (contained.size === 1) return `${kind}-flow:${contained.values().next().value}`;
    if (contained.size > 1) return 'ambiguous-dynamic';
  }
  if (flowIndices(calleeCategory, 'd').some((index) => expression.arguments[index])) {
    return 'derived-dynamic';
  }
  const categories = new Set(
    flowIndices(calleeCategory, 'r')
      .map((index) => expression.arguments[index] ? flowedCategory(categoryOf(expression.arguments[index])) : null)
      .filter(Boolean),
  );
  if (categories.size === 1) return categories.values().next().value;
  if (categories.size > 1) return 'ambiguous-dynamic';
  return null;
}

export function aggregateFlowCategory(ts, expression, categoryOf, memberName = () => null) {
  if (ts.isObjectLiteralExpression(expression)) {
    const entries = new Map();
    let fallback = null;
    function add(member, category) {
      if (!category) return;
      if (member === null) fallback = joinFlowCategories(fallback, category);
      else entries.set(member, joinFlowCategories(entries.get(member), category));
    }
    for (const property of expression.properties) {
      if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
        const value = ts.isPropertyAssignment(property) ? property.initializer : property.name;
        add(memberName(property.name), categoryOf(value));
      } else if (ts.isSpreadAssignment(property)) {
        const spread = objectRecord(categoryOf(property.expression));
        if (!spread) add(null, categoryOf(property.expression));
        else {
          for (const [member, category] of spread.entries) add(member, category);
          add(null, spread.fallback);
        }
      }
    }
    return objectRecordCategory(entries, fallback);
  }
  const categories = new Set(expression.elements.map(categoryOf).filter((category) =>
    isFunctionCategory(category) || isForbiddenCallableCategory(category) || containedFlowCategory(category) || objectRecord(category)));
  if (categories.size === 0) return null;
  if (categories.size > 1) return 'ambiguous-dynamic';
  return `array-flow:${categories.values().next().value}`;
}

export function containedFlowCategory(category) {
  return CONTAINER_FLOW_PREFIX.exec(category ?? '')?.[2] ?? null;
}

export function objectFlowCategory(category) {
  return category ? `object-flow:${category}` : null;
}

export function assignmentTargetRoot(ts, target) {
  let root = transparentFlowExpression(ts, target);
  const container = !ts.isIdentifier(root);
  while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) {
    root = transparentFlowExpression(ts, root.expression);
  }
  return { container, root };
}

export function bindAssignmentPattern(ts, target, category, categoryOf, memberName, memberCategory, bind) {
  const current = transparentFlowExpression(ts, target);
  if (ts.isIdentifier(current) || ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (category) bind(current, category);
    return;
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    bindAssignmentPattern(
      ts, current.left, joinFlowCategories(category, categoryOf(current.right)),
      categoryOf, memberName, memberCategory, bind,
    );
    return;
  }
  if (ts.isArrayLiteralExpression(current) || ts.isArrayBindingPattern(current)) {
    const elementCategory = containedFlowCategory(category) ?? category;
    for (const element of current.elements) {
      if (ts.isOmittedExpression(element)) continue;
      const binding = ts.isBindingElement(element);
      const fallback = binding && element.initializer ? categoryOf(element.initializer) : null;
      bindAssignmentPattern(
        ts,
        binding ? element.name : ts.isSpreadElement(element) ? element.expression : element,
        joinFlowCategories(elementCategory, fallback),
        categoryOf,
        memberName,
        memberCategory,
        bind,
      );
    }
    return;
  }
  if (ts.isObjectBindingPattern(current)) {
    for (const element of current.elements) {
      const rest = element.dotDotDotToken;
      const member = !rest && element.propertyName ? memberName(element.propertyName) :
        !rest && ts.isIdentifier(element.name) ? element.name.text : null;
      const selected = rest ? containedFlowCategory(category) ?? category : memberCategory(category, member);
      const fallback = element.initializer ? categoryOf(element.initializer) : null;
      bindAssignmentPattern(
        ts, element.name, joinFlowCategories(selected, fallback),
        categoryOf, memberName, memberCategory, bind,
      );
    }
    return;
  }
  if (!ts.isObjectLiteralExpression(current)) return;
  for (const property of current.properties) {
    if (ts.isSpreadAssignment(property)) {
      bindAssignmentPattern(
        ts, property.expression, containedFlowCategory(category) ?? category,
        categoryOf, memberName, memberCategory, bind,
      );
    } else if (ts.isShorthandPropertyAssignment(property)) {
      const fallback = property.objectAssignmentInitializer ? categoryOf(property.objectAssignmentInitializer) : null;
      bindAssignmentPattern(
        ts, property.name, joinFlowCategories(memberCategory(category, property.name.text), fallback),
        categoryOf, memberName, memberCategory, bind,
      );
    } else if (ts.isPropertyAssignment(property)) {
      bindAssignmentPattern(
        ts, property.initializer, memberCategory(category, memberName(property.name)),
        categoryOf, memberName, memberCategory, bind,
      );
    }
  }
}
