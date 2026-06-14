import { validateRawHostNamespacesTS } from '../codegen-expression.js';
import { isHostNamespaceRoot, unmappedHostNamespaceMessage } from './host-namespace.js';
import { moduleRuntimeBindingNames } from '../semantic-validator.js';
import { NODE_SCHEMAS } from '../schema.js';
import { parseExpression } from '../parser-expression.js';
import { typescriptClosureClassifier, validateClosureBlockHostNamespacesTS } from '../typescript-closure-classifier.js';
import { type IRNode, isExprObject } from '../types.js';
import type { ValueIR } from '../value-ir.js';

interface ValidationScope {
  readonly moduleBindings: ReadonlySet<string>;
  readonly locals: ReadonlySet<string>;
}

const TS_PARSE_OPTS = { closureClassifier: typescriptClosureClassifier };
const validatedNodes = new WeakMap<IRNode, number>();
const expressionScopes = new WeakMap<IRNode, Map<string, ReadonlySet<string>>>();

export function beginIRHostNamespacesValidatedTS(root: IRNode): boolean {
  if ((validatedNodes.get(root) ?? 0) > 0) return false;
  const moduleBindings = root.type === 'module' ? moduleRuntimeBindingNames(root) : new Set<string>();
  validateNode(root, { moduleBindings, locals: new Set() });
  markValidated(root);
  return true;
}

export function endIRHostNamespacesValidatedTS(root: IRNode, didBegin: boolean): void {
  if (!didBegin) return;
  unmarkValidated(root);
}

export function validatedHostNamespaceBindingsFor(node: IRNode, propName: string): ReadonlySet<string> | undefined {
  return expressionScopes.get(node)?.get(propName);
}

function markValidated(node: IRNode): void {
  validatedNodes.set(node, (validatedNodes.get(node) ?? 0) + 1);
  for (const child of node.children ?? []) markValidated(child);
}

function unmarkValidated(node: IRNode): void {
  const count = validatedNodes.get(node) ?? 0;
  if (count <= 1) {
    validatedNodes.delete(node);
    expressionScopes.delete(node);
  } else {
    validatedNodes.set(node, count - 1);
  }
  for (const child of node.children ?? []) unmarkValidated(child);
}

function validateNode(node: IRNode, scope: ValidationScope): void {
  const selfScope = scopeWithNames(scope, selfBindingNames(node));
  validateExpressionProps(node, selfScope);
  const legacyParams = validateLegacyParams(node, selfScope);
  if (legacyParams !== null) {
    validateChildren(node, scopeWithNames(selfScope, legacyParams));
    return;
  }
  let paramDefaultScope = selfScope;
  for (const child of node.children ?? []) {
    if (child.type !== 'param') continue;
    validateNode(child, paramDefaultScope);
    paramDefaultScope = scopeWithNames(paramDefaultScope, bindingNamesFromPatternChildren(child));
  }
  validateChildren(node, scopeWithNames(selfScope, paramChildNames(node)), { skipParamChildren: true });
}

function validateChildren(
  node: IRNode,
  scope: ValidationScope,
  options?: { skipParamChildren?: boolean },
): void {
  const children = node.children ?? [];
  if (children.length === 0) return;
  const childBaseScope = scopeWithNames(scope, childScopeBindingNames(node));

  if (isSequentialScopeNode(node)) {
    let current = childBaseScope;
    for (const child of children) {
      if (options?.skipParamChildren && child.type === 'param') continue;
      const childScope = child.type === 'catch' ? scopeWithNames(current, catchBindingNames(child)) : current;
      validateNode(child, childScope);
      current = scopeWithNames(current, postStatementBindingNames(child));
    }
    return;
  }

  for (const child of children) {
    if (options?.skipParamChildren && child.type === 'param') continue;
    validateNode(child, childBaseScope);
  }
}

function validateExpressionProps(node: IRNode, scope: ValidationScope): void {
  const schema = NODE_SCHEMAS[node.type];
  if (!schema?.props || !node.props) return;
  for (const [propName, propSchema] of Object.entries(schema.props)) {
    if (propSchema.kind !== 'expression') continue;
    const raw = node.props[propName];
    if (raw === undefined || raw === '') continue;
    if (typeof raw === 'string' && node.__quotedProps?.includes(propName)) continue;
    recordExpressionScope(node, propName, scope);
    validateExpressionValue(raw, scope);
  }
}

function validateExpressionValue(raw: unknown, scope: ValidationScope): void {
  if (isExprObject(raw)) {
    return;
  }
  if (typeof raw !== 'string') return;
  let parsed: ValueIR;
  try {
    parsed = parseExpression(raw, TS_PARSE_OPTS);
  } catch (err) {
    if (isHostNamespaceValidationError(err)) throw err;
    validateRawHostNamespacesTS(raw, exprContext(scope));
    return;
  }
  validateValueIR(parsed, scope);
}

function validateValueIR(node: ValueIR, scope: ValidationScope): void {
  switch (node.kind) {
    case 'numLit':
    case 'strLit':
    case 'boolLit':
    case 'nullLit':
    case 'undefLit':
    case 'regexLit':
    case 'ident':
      return;
    case 'tmplLit':
      for (const expr of node.expressions) validateValueIR(expr, scope);
      return;
    case 'member': {
      const root = hostNamespaceReceiverRoot(node.object);
      if (root) rejectUnboundHostNamespace(root, hostNamespaceMemberLabel(node.object, node.property), scope);
      validateValueIR(node.object, scope);
      return;
    }
    case 'index': {
      const root = hostNamespaceReceiverRoot(node.object);
      if (root) {
        rejectUnboundHostNamespace(root, hostNamespaceMemberLabel(node.object, node.index.kind === 'strLit' ? node.index.value : '[computed]'), scope);
      }
      validateValueIR(node.object, scope);
      validateValueIR(node.index, scope);
      return;
    }
    case 'call': {
      validateCallCallee(node.callee, scope);
      validateValueIR(node.callee, scope);
      for (const arg of node.args) validateValueIR(arg, scope);
      return;
    }
    case 'lambda': {
      const lambdaScope = scopeWithNames(
        scope,
        node.params.map((param) => param.name),
      );
      if (node.bodyBlock) validateClosureBlockHostNamespacesTS(node.bodyBlock.raw, exprContext(lambdaScope).isUserBinding);
      if (node.body) validateValueIR(node.body, lambdaScope);
      return;
    }
    case 'binary':
      validateValueIR(node.left, scope);
      validateValueIR(node.right, scope);
      return;
    case 'unary':
    case 'spread':
    case 'await':
    case 'propagate':
      validateValueIR(node.argument, scope);
      return;
    case 'new': {
      const root = newExpressionRootIdentifier(node.argument);
      if (root) rejectUnboundHostNamespace(root, 'constructor', scope);
      validateValueIR(node.argument, scope);
      return;
    }
    case 'typeAssert':
    case 'nonNull':
      validateValueIR(node.expression, scope);
      return;
    case 'objectLit':
      for (const entry of node.entries) {
        if ('argument' in entry) validateValueIR(entry.argument, scope);
        else validateValueIR(entry.value, scope);
      }
      return;
    case 'arrayLit':
      for (const item of node.items) validateValueIR(item, scope);
      return;
    case 'conditional':
      validateValueIR(node.test, scope);
      validateValueIR(node.consequent, scope);
      validateValueIR(node.alternate, scope);
      return;
    default:
      throw new Error(`Unsupported ValueIR kind in host namespace validation: ${(node as { kind?: string }).kind}`);
  }
}

function validateCallCallee(callee: ValueIR, scope: ValidationScope): void {
  if (callee.kind === 'ident') {
    if (!isUserBinding(scope, callee.name) && (callee.name === 'Array' || callee.name === 'Object')) {
      throw new Error(`Unknown KERN-stdlib method/member '${callee.name}.call'.`);
    }
    rejectUnboundHostNamespace(callee.name, 'call', scope);
    return;
  }
  if (callee.kind === 'member') {
    const root = hostNamespaceReceiverRoot(callee.object);
    if (root) rejectUnboundHostNamespace(root, hostNamespaceMemberLabel(callee.object, callee.property), scope);
  }
}

function rejectUnboundHostNamespace(root: string, member: string, scope: ValidationScope): void {
  if (isUserBinding(scope, root)) return;
  if (!isHostNamespaceRoot(root)) return;
  throw new Error(unmappedHostNamespaceMessage('TypeScript', root, member));
}

function isHostNamespaceValidationError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('Unsupported host namespace in TypeScript expression: ');
}

function exprContext(scope: ValidationScope): { isUserBinding(name: string): boolean } {
  return {
    isUserBinding(name: string): boolean {
      return isUserBinding(scope, name);
    },
  };
}

function isUserBinding(scope: ValidationScope, name: string): boolean {
  return scope.locals.has(name) || scope.moduleBindings.has(name);
}

function scopeWithNames(scope: ValidationScope, names: readonly string[]): ValidationScope {
  if (names.length === 0) return scope;
  const locals = new Set(scope.locals);
  for (const name of names) locals.add(name);
  return { moduleBindings: scope.moduleBindings, locals };
}

function recordExpressionScope(node: IRNode, propName: string, scope: ValidationScope): void {
  let scopes = expressionScopes.get(node);
  if (!scopes) {
    scopes = new Map();
    expressionScopes.set(node, scopes);
  }
  scopes.set(propName, new Set([...scope.moduleBindings, ...scope.locals]));
}

function selfBindingNames(node: IRNode): string[] {
  if (!isSelfBindingNode(node)) return [];
  const name = node.props?.name;
  return typeof name === 'string' && name.length > 0 ? [name] : [];
}

function isSelfBindingNode(node: IRNode): boolean {
  return (
    node.type === 'class' ||
    node.type === 'service' ||
    node.type === 'fn' ||
    node.type === 'function' ||
    node.type === 'action'
  );
}

function catchBindingNames(node: IRNode): string[] {
  const name = node.props?.name;
  return typeof name === 'string' && name.length > 0 ? [name] : [];
}

function postStatementBindingNames(node: IRNode): string[] {
  if (node.type === 'destructure') return bindingNamesFromPatternChildren(node);
  if (node.type !== 'let' && node.type !== 'const' && node.type !== 'fn' && node.type !== 'function') return [];
  const name = node.props?.name;
  return typeof name === 'string' && name.length > 0 ? [name] : [];
}

function childScopeBindingNames(node: IRNode): string[] {
  switch (node.type) {
    case 'each':
      return [
        stringName(node.props?.name),
        stringName(node.props?.index),
        stringName(node.props?.pairKey),
        stringName(node.props?.pairValue),
        stringName(node.props?.entryKey),
        stringName(node.props?.entryValue),
      ].filter((name): name is string => Boolean(name));
    case 'for':
    case 'with':
      return [stringName(node.props?.name)].filter((name): name is string => Boolean(name));
    default:
      return [];
  }
}

function isSequentialScopeNode(node: IRNode): boolean {
  return (
    node.type === 'module' ||
    node.type === 'handler' ||
    node.type === 'try' ||
    node.type === 'catch' ||
    node.type === 'finally' ||
    node.type === 'if' ||
    node.type === 'else' ||
    node.type === 'each' ||
    node.type === 'while' ||
    node.type === 'for' ||
    node.type === 'with' ||
    node.type === 'path'
  );
}

function validateLegacyParams(node: IRNode, scope: ValidationScope): string[] | null {
  const rawParams = node.props?.params;
  if (typeof rawParams !== 'string' || rawParams.trim() === '') return null;
  const parsed = parseLegacyParams(rawParams);
  let defaultScope = scope;
  for (const param of parsed) {
    if (param.defaultValue !== null) validateExpressionValue(param.defaultValue, defaultScope);
    if (param.name) defaultScope = scopeWithNames(defaultScope, [param.name]);
  }
  return parsed.map((param) => param.name).filter((name): name is string => Boolean(name));
}

function paramChildNames(node: IRNode): string[] {
  const names: string[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== 'param') continue;
    names.push(...bindingNamesFromPatternChildren(child));
  }
  return names;
}

function bindingNamesFromPatternChildren(node: IRNode): string[] {
  const names: string[] = [];
  const ownName = stringName(node.props?.name);
  if (ownName) names.push(ownName);
  for (const child of node.children ?? []) {
    if (child.type !== 'binding' && child.type !== 'element') continue;
    const name = stringName(child.props?.name);
    if (name) names.push(name);
  }
  return names;
}

function stringName(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseLegacyParams(raw: string): Array<{ name: string | null; defaultValue: string | null }> {
  return splitTopLevel(raw, ',').map((part) => {
    const trimmed = part.trim();
    const colonIdx = findTopLevelSeparator(trimmed, ':');
    const lhs = colonIdx === -1 ? trimmed : trimmed.slice(0, colonIdx).trim();
    const rest = colonIdx === -1 ? '' : trimmed.slice(colonIdx + 1).trim();
    const eqIdx = findDefaultSeparator(rest);
    const defaultValue = eqIdx === -1 ? null : rest.slice(eqIdx + 1).trim();
    return { name: parseParamName(lhs), defaultValue: defaultValue && defaultValue.length > 0 ? defaultValue : null };
  });
}

function parseParamName(raw: string): string | null {
  const cleaned = raw.replace(/^\.\.\./u, '').replace(/\?$/u, '').trim();
  return /^[A-Za-z_$][\w$]*$/u.test(cleaned) ? cleaned : null;
}

function splitTopLevel(raw: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | '`' | '' = '';
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      current += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '<' || ch === '(' || ch === '{' || ch === '[') depth++;
    else if ((ch === '>' || ch === ')' || ch === '}' || ch === ']') && depth > 0) depth--;
    if (ch === delimiter && depth === 0) {
      if (current.trim()) parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function findTopLevelSeparator(raw: string, separator: string): number {
  return findTopLevel(raw, (ch) => ch === separator);
}

function findDefaultSeparator(raw: string): number {
  return findTopLevel(raw, (ch, index) => ch === '=' && raw[index + 1] !== '>');
}

function findTopLevel(raw: string, match: (ch: string, index: number) => boolean): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | '' = '';
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '<' || ch === '(' || ch === '{' || ch === '[') depth++;
    else if ((ch === '>' || ch === ')' || ch === '}' || ch === ']') && depth > 0) depth--;
    else if (depth === 0 && match(ch, i)) return i;
  }
  return -1;
}

function newExpressionRootIdentifier(node: ValueIR): string | null {
  if (node.kind === 'ident') return node.name;
  if (node.kind === 'call' && node.callee.kind === 'ident') return node.callee.name;
  if (node.kind === 'member' || node.kind === 'index') return hostNamespaceReceiverRoot(node);
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return newExpressionRootIdentifier(node.expression);
  return null;
}

function hostNamespaceReceiverRoot(node: ValueIR): string | null {
  if (node.kind === 'ident') return node.name;
  if (node.kind === 'member' || node.kind === 'index') return hostNamespaceReceiverRoot(node.object);
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return hostNamespaceReceiverRoot(node.expression);
  return null;
}

function hostNamespaceMemberLabel(receiver: ValueIR, fallback: string): string {
  return firstMemberAfterRoot(receiver) ?? fallback;
}

function firstMemberAfterRoot(node: ValueIR): string | null {
  if (node.kind === 'member') {
    const nested = firstMemberAfterRoot(node.object);
    return nested ?? node.property;
  }
  if (node.kind === 'index') {
    const nested = firstMemberAfterRoot(node.object);
    if (nested) return nested;
    return node.index.kind === 'strLit' ? node.index.value : '[computed]';
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return firstMemberAfterRoot(node.expression);
  return null;
}
