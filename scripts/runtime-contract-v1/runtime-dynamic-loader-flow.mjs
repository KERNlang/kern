const FUNCTION_FLOW_PREFIX = 'function-flow:';
const CONTAINER_FLOW_PREFIX = /^(array|object)-flow:(.+)$/u;
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
    if (ts.isBlock(current) || ts.isFunctionLike(current) || ts.isSourceFile(current)) scopes.push(current);
    current = current.parent;
  }
  return scopes;
}

export function createAliasMap(ts, sourceFile) {
  const aliases = new Map();
  const bindingScopes = new WeakMap();
  const scopeBindings = new Map();
  function register(identifier, start) {
    const scope = scopeAncestors(ts, start)[0] ?? sourceFile;
    bindingScopes.set(identifier, scope);
    const names = scopeBindings.get(scope) ?? new Set();
    names.add(identifier.text);
    scopeBindings.set(scope, names);
  }
  function visit(node) {
    if (ts.isVariableDeclaration(node)) {
      for (const identifier of bindingIdentifiers(ts, node.name)) register(identifier, node.parent);
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
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

export function scopedAliasKey(aliases, identifier, category) {
  if (!category.includes('derived-dynamic')) return identifier.text;
  const scope = bindingScope(aliases, identifier);
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

function invokedParameter(ts, callee, parameterIndices) {
  let current = callee;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression;
  }
  if (ts.isIdentifier(current)) return parameterIndices.get(current.text);
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const receiver = current.expression;
    const member = ts.isPropertyAccessExpression(current) ? current.name.text :
      ts.isStringLiteral(current.argumentExpression) ? current.argumentExpression.text : null;
    if (ts.isIdentifier(receiver) && ['apply', 'bind', 'call', 'constructor'].includes(member)) {
      return parameterIndices.get(receiver.text);
    }
  }
  return undefined;
}

function transparentExpression(ts, expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function directParameter(ts, expression, parameterIndices) {
  const current = transparentExpression(ts, expression);
  return ts.isIdentifier(current) ? parameterIndices.get(current.text) : undefined;
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
    const direct = directParameter(ts, expression, parameterIndices);
    if (direct !== undefined) {
      returned.add(direct);
      return;
    }
    const references = parameterReferences(ts, expression, parameterIndices);
    const unwrapped = transparentExpression(ts, expression);
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
      const index = invokedParameter(ts, callee, parameterIndices);
      if (index !== undefined) invoked.add(index);
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

export function aggregateFlowCategory(ts, expression, categoryOf) {
  const values = ts.isArrayLiteralExpression(expression)
    ? expression.elements
    : expression.properties.flatMap((property) =>
        ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)
          ? [ts.isPropertyAssignment(property) ? property.initializer : property.name]
          : ts.isSpreadAssignment(property) ? [property.expression] : []);
  const categories = new Set(values.map(categoryOf).filter((category) =>
    isFunctionCategory(category) || isForbiddenCallableCategory(category) || containedFlowCategory(category)));
  if (categories.size === 0) return null;
  if (categories.size > 1) return 'ambiguous-dynamic';
  const kind = ts.isArrayLiteralExpression(expression) ? 'array' : 'object';
  return `${kind}-flow:${categories.values().next().value}`;
}

export function containedFlowCategory(category) {
  return CONTAINER_FLOW_PREFIX.exec(category ?? '')?.[2] ?? null;
}

export function objectFlowCategory(category) {
  return category ? `object-flow:${category}` : null;
}
