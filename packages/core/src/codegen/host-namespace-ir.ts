import { parseLegacyParamSignature } from '../closure-eligibility.js';
import { validateRawHostNamespacesTS } from '../codegen-expression.js';
import { parseExpression } from '../parser-expression.js';
import { NODE_SCHEMAS } from '../schema.js';
import { moduleAmbientRuntimeBindingNames } from '../semantic-validator.js';
import { type IRNode, isExprObject } from '../types.js';
import { typescriptClosureClassifier, validateClosureBlockHostNamespacesTS } from '../typescript-closure-classifier.js';
import type { ValueIR } from '../value-ir.js';
import { isHostNamespaceRoot, unmappedHostNamespaceMessage } from './host-namespace.js';
import { isPortableStdlibMember, KERN_STDLIB_MODULES, suggestStdlibMember } from './kern-stdlib.js';

interface ValidationScope {
  readonly moduleBindings: ReadonlySet<string>;
  readonly locals: ReadonlySet<string>;
}

const TS_PARSE_OPTS = { closureClassifier: typescriptClosureClassifier };
const validatedNodes = new WeakMap<IRNode, number>();
const expressionScopes = new WeakMap<IRNode, Map<string, ReadonlySet<string>>>();

export interface IRHostNamespaceValidationOptions {
  userBindings?: ReadonlySet<string>;
}

export function beginIRHostNamespacesValidatedTS(root: IRNode, options?: IRHostNamespaceValidationOptions): boolean {
  if ((validatedNodes.get(root) ?? 0) > 0) return false;
  const moduleBindings = root.type === 'module' ? moduleAmbientRuntimeBindingNames(root) : new Set<string>();
  validateNode(root, { moduleBindings, locals: new Set(options?.userBindings ?? []) });
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

function validateChildren(node: IRNode, scope: ValidationScope, options?: { skipParamChildren?: boolean }): void {
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
    const propScope = expressionPropScope(node, propName, scope);
    recordExpressionScope(node, propName, propScope);
    validateExpressionValue(raw, propScope, isConstValueEscapeHatch(node, propName));
  }
}

/** The ONE sanctioned raw-passthrough site: a `const`'s `value` prop. On a parse
 *  FAILURE here, `emitConstValue` ships the raw text verbatim (GAP 3), so the
 *  validator must NOT screen it — otherwise it would reject what emit ships. Every
 *  OTHER expression prop (field values, config values, param defaults, …) is NOT
 *  an escape hatch: an unparseable host-root in it fails CLOSED (BLOCKER 1). */
function isConstValueEscapeHatch(node: IRNode, propName: string): boolean {
  return node.type === 'const' && propName === 'value';
}

function expressionPropScope(node: IRNode, propName: string, scope: ValidationScope): ValidationScope {
  if (node.type === 'with' && propName === 'cleanup') {
    const name = stringName(node.props?.name);
    return name ? scopeWithNames(scope, [name]) : scope;
  }
  return scope;
}

function validateExpressionValue(raw: unknown, scope: ValidationScope, shipRawOnParseFailure = false): void {
  if (isExprObject(raw)) {
    return;
  }
  if (typeof raw !== 'string') return;
  let parsed: ValueIR;
  try {
    parsed = parseExpression(raw, TS_PARSE_OPTS);
  } catch (err) {
    if (isHostNamespaceValidationError(err)) throw err;
    // BLOCKER 1 — the "ship raw on parse failure" relaxation (GAP 3) is scoped to
    // the ONE const.value escape-hatch site (`emitConstValue` in type-system.ts):
    // there `shipRawOnParseFailure` is true and the raw text is shipped verbatim,
    // so the validator stays silent to match emit. This SHARED validator also runs
    // for EVERY OTHER expression prop (field values, config values, legacy param
    // defaults, …); for those, dropping the screen would fail-OPEN — an unparseable
    // host-root like `Date.now(]` as a field value or param default would validate
    // OK and emit verbatim invalid TS. Run the raw-text host-namespace scan so any
    // host root in unparseable NON-escape-hatch input fails CLOSED.
    if (!shipRawOnParseFailure) validateRawHostNamespacesTS(raw, exprContext(scope));
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
        rejectUnboundHostNamespace(
          root,
          hostNamespaceMemberLabel(node.object, node.index.kind === 'strLit' ? node.index.value : '[computed]'),
          scope,
        );
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
      if (node.bodyBlock)
        validateClosureBlockHostNamespacesTS(node.bodyBlock.raw, exprContext(lambdaScope).isUserBinding);
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
      if (root && !(root === 'Error' && isSimpleErrorConstructor(node.argument))) {
        rejectUnboundHostNamespace(root, 'constructor', scope);
      }
      validateNewArgument(node.argument, scope);
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

function validateNewArgument(node: ValueIR, scope: ValidationScope): void {
  if (node.kind === 'call') {
    if (!(node.callee.kind === 'ident' && node.callee.name === 'Error')) validateCallCallee(node.callee, scope);
    for (const arg of node.args) validateValueIR(arg, scope);
    return;
  }
  validateValueIR(node, scope);
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
  // GAP 1 — unify the IR-validation path with the emit path against the ONE
  // KERN_STDLIB registry, but ONLY for real `Module.member` access/calls. The
  // emitter's stdlib dispatch (`applyStdlibLoweringTS`/`...PropertyLowering`)
  // fires on `Module.method` whose `Module` is a registered stdlib root WITHOUT
  // consulting user shadowing — `Math.floor` lowers, `Math.bogus` throws
  // `Unknown KERN-stdlib member` even when a user binding named `Math` is in
  // scope. Mirroring that here keeps validate<->emit in lockstep (a divergence
  // would let the validator silently pass `Math.bogus` that the emitter throws
  // on). The synthetic `'constructor'`/`'call'` sentinels are EXCLUDED: the
  // emitter does NOT route `new Map(...)` / bare `Map()` / `new Number(5)`
  // through stdlib unknown-member dispatch (those construct/call the host
  // value), so a stdlib root in those positions must fall through to the host-
  // root check below — which passes for stdlib modules, matching emit. (Bare
  // `Array()`/`Object()` are already special-cased by the caller.)
  if (KERN_STDLIB_MODULES.has(root) && member !== 'constructor' && member !== 'call') {
    if (isPortableStdlibMember(root, member)) return;
    throwUnknownStdlibMemberIR(root, member);
  }
  // Non-stdlib host roots (console/process/String/…) honor user shadowing: a
  // user binding of the same name is the user's value, not the host namespace.
  if (isUserBinding(scope, root)) return;
  if (!isHostNamespaceRoot(root)) return;
  throw new Error(unmappedHostNamespaceMessage('TypeScript', root, member));
}

/** Mirror of the emit path's `throwUnknownStdlibMember` so the same diagnostic
 *  (with the same did-you-mean suggestion) surfaces from the validation pass. */
function throwUnknownStdlibMemberIR(moduleName: string, memberName: string): never {
  const suggestion = suggestStdlibMember(moduleName, memberName);
  const hint = suggestion ? ` Did you mean '${moduleName}.${suggestion}'?` : '';
  throw new Error(`Unknown KERN-stdlib method/member '${moduleName}.${memberName}'.${hint}`);
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
    node.type === 'repository' ||
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
  if (
    node.type !== 'let' &&
    node.type !== 'const' &&
    node.type !== 'fn' &&
    node.type !== 'function' &&
    node.type !== 'class' &&
    node.type !== 'enum' &&
    node.type !== 'service' &&
    node.type !== 'screen' &&
    node.type !== 'action' &&
    node.type !== 'repository' &&
    node.type !== 'cache'
  ) {
    return [];
  }
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
  if (parsed === null) {
    // BLOCKER 1 + IMPORTANT 3 — the param string is MALFORMED (the TS parser
    // reported parse diagnostics). FAIL CLOSED on BOTH axes:
    //  - trust NO extracted bindings (a recovery-AST `process = (` must NOT make
    //    `process.exit()` in the body look shadowed — IMPORTANT 3), and
    //  - the emitter (`parseParamList`) still emits the raw param string
    //    verbatim, so a host root in the malformed default (`ts:number=Date.now(]`
    //    → `Date.now`) must still be REJECTED (BLOCKER 1) rather than slipping
    //    through unvalidated. The raw host-namespace scan over the whole string
    //    surfaces exactly `Module.member` / `Module(` host accesses, honoring
    //    user shadowing via `exprContext(scope)`.
    // Returning `[]` (not `null`) keeps `validateNode` on the legacy-params path
    // (this node HAS a `params` prop, so its param CHILDREN must not be used).
    validateRawHostNamespacesTS(rawParams, exprContext(scope));
    return [];
  }
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
  const hasPatternChildren = (node.children ?? []).some(
    (child) => child.type === 'binding' || child.type === 'element',
  );
  const ownName = stringName(node.props?.name);
  if (ownName && !hasPatternChildren) names.push(ownName);
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

function parseLegacyParams(raw: string): Array<{ name: string | null; defaultValue: string | null }> | null {
  // GAP 4 + BLOCKER 2 — parse the legacy `params="..."` string with the REAL
  // TypeScript parser (auto-handling `==`/`===`/`<=`/`>=`, regex literals with
  // commas, nested generics, and template literals in defaults — every case the
  // old char-scanner mis-split). The `ts.createSourceFile` call lives in
  // `parseLegacyParamSignature` (closure-eligibility.ts, which already owns the
  // `typescript` import + AST helpers) so this module stays free of a static
  // `typescript` import — keeping the core barrel's typescript-importer pin at 5
  // (browser-spine-import-graph.test.ts). A MALFORMED param string yields `null`
  // (NOT a phantom recovery-AST), which `validateLegacyParams` turns into a
  // fail-closed raw scan + zero trusted bindings — IMPORTANT 3 + BLOCKER 1.
  const signature = parseLegacyParamSignature(raw);
  if (signature === null) return null;
  return signature.map((param) => ({ name: param.name, defaultValue: param.default }));
}

function newExpressionRootIdentifier(node: ValueIR): string | null {
  if (node.kind === 'ident') return node.name;
  if (node.kind === 'call' && node.callee.kind === 'ident') return node.callee.name;
  if (node.kind === 'member' || node.kind === 'index') return hostNamespaceReceiverRoot(node);
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return newExpressionRootIdentifier(node.expression);
  return null;
}

function isSimpleErrorConstructor(node: ValueIR): boolean {
  return (
    (node.kind === 'ident' && node.name === 'Error') ||
    (node.kind === 'call' && node.callee.kind === 'ident' && node.callee.name === 'Error')
  );
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
