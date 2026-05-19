/**
 * Next.js App Router review rules — active when target = nextjs, on top of nextjsRules.
 *
 * Focus: directive placement, client/server boundary correctness, server actions.
 * These rules require import-graph awareness — they gracefully no-op when run
 * in single-file mode (no ctx.fileContext).
 */

import { existsSync } from 'fs';
import { basename, dirname, resolve } from 'path';
import { Node, Project, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding, span } from './utils.js';

// ── Helpers ──────────────────────────────────────────────────────────────

const CLIENT_HOOKS = new Set([
  'useState',
  'useEffect',
  'useRef',
  'useCallback',
  'useMemo',
  'useReducer',
  'useContext',
  'useLayoutEffect',
  'useTransition',
  'useDeferredValue',
  'useImperativeHandle',
  'useSyncExternalStore',
]);

const CLIENT_EVENT_HANDLERS = new Set([
  'onClick',
  'onChange',
  'onSubmit',
  'onKeyDown',
  'onKeyUp',
  'onMouseEnter',
  'onMouseLeave',
  'onFocus',
  'onBlur',
  'onInput',
  'onTouchStart',
  'onTouchEnd',
  'onScroll',
  'onDrag',
]);

const BROWSER_GLOBALS = /\b(window|document|localStorage|sessionStorage|navigator|history|location)\b/;
const BROWSER_GLOBAL_NAMES = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'history',
  'location',
];
const ACTION_STATE_HOOKS = new Set(['useActionState']);

interface ActionStateBinding {
  decl: Node;
  stateNameNode?: Node;
  actionName: string;
  hasPendingBinding: boolean;
}

type JsxTagLike = import('ts-morph').JsxOpeningElement | import('ts-morph').JsxSelfClosingElement;
type FunctionLikeNode =
  | import('ts-morph').FunctionDeclaration
  | import('ts-morph').FunctionExpression
  | import('ts-morph').ArrowFunction;

function hasClientDirective(fullText: string): boolean {
  return /^['"]use client['"];?\s*$/m.test(fullText.substring(0, 200));
}

function hasServerDirective(fullText: string): boolean {
  return /^['"]use server['"];?\s*$/m.test(fullText.substring(0, 200));
}

function isHookLikeName(name: string): boolean {
  return CLIENT_HOOKS.has(name) || /^use[A-Z0-9]/.test(name);
}

/** Does this file itself use any client-only API (hooks, browser globals, event handlers)? */
function fileUsesClientApi(ctx: RuleContext): boolean {
  for (const identifier of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const name = identifier.getText();
    if (BROWSER_GLOBAL_NAMES.includes(name) && isBrowserGlobalReference(identifier, name)) return true;
  }

  // JSX event handlers
  for (const attr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const name = attr.getNameNode().getText();
    if (CLIENT_EVENT_HANDLERS.has(name)) return true;
  }

  // Hook calls
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() === SyntaxKind.Identifier) {
      if (isHookLikeName(expr.getText())) return true;
    } else if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      const prop = expr.asKind(SyntaxKind.PropertyAccessExpression);
      if (prop && isHookLikeName(prop.getName())) return true;
    }
  }

  return false;
}

function isClientBoundary(ctx: RuleContext, fullText: string): boolean {
  return (
    hasClientDirective(fullText) || ctx.fileContext?.isClientBoundary === true || ctx.fileContext?.boundary === 'client'
  );
}

function unwrapParens(node: Node): Node {
  let current = node;
  while (Node.isParenthesizedExpression(current)) {
    current = current.getExpression();
  }
  return current;
}

function isNodeWithin(node: Node, container: Node | undefined): boolean {
  if (!container) return false;
  return node.getStart() >= container.getStart() && node.getEnd() <= container.getEnd();
}

function getTypeofGuardState(node: Node, globalName: string): 'defined' | 'undefined' | undefined {
  const expr = unwrapParens(node);
  if (!Node.isBinaryExpression(expr)) return undefined;

  const operator = expr.getOperatorToken().getText();
  if (operator !== '===' && operator !== '==' && operator !== '!==' && operator !== '!=') return undefined;

  const left = unwrapParens(expr.getLeft());
  const right = unwrapParens(expr.getRight());
  const isTypeofGlobal = (candidate: Node): boolean =>
    Node.isTypeOfExpression(candidate) &&
    Node.isIdentifier(candidate.getExpression()) &&
    candidate.getExpression().getText() === globalName;
  const isUndefinedLiteral = (candidate: Node): boolean =>
    Node.isStringLiteral(candidate) && candidate.getLiteralText() === 'undefined';

  if (!((isTypeofGlobal(left) && isUndefinedLiteral(right)) || (isUndefinedLiteral(left) && isTypeofGlobal(right)))) {
    return undefined;
  }

  return operator === '!==' || operator === '!=' ? 'defined' : 'undefined';
}

function conditionGuaranteesBrowserGlobal(node: Node, globalName: string, branch: 'true' | 'false'): boolean {
  const expr = unwrapParens(node);
  const state = getTypeofGuardState(expr, globalName);
  if (state) return branch === 'true' ? state === 'defined' : state === 'undefined';

  if (Node.isPrefixUnaryExpression(expr) && expr.getOperatorToken() === SyntaxKind.ExclamationToken) {
    return conditionGuaranteesBrowserGlobal(expr.getOperand(), globalName, branch === 'true' ? 'false' : 'true');
  }

  if (!Node.isBinaryExpression(expr)) return false;

  const operator = expr.getOperatorToken().getText();
  if (branch === 'true' && operator === '&&') {
    return (
      conditionGuaranteesBrowserGlobal(expr.getLeft(), globalName, 'true') ||
      conditionGuaranteesBrowserGlobal(expr.getRight(), globalName, 'true')
    );
  }

  if (branch === 'false' && operator === '||') {
    return (
      conditionGuaranteesBrowserGlobal(expr.getLeft(), globalName, 'false') ||
      conditionGuaranteesBrowserGlobal(expr.getRight(), globalName, 'false')
    );
  }

  return false;
}

function isBrowserGlobalReference(node: Node, globalName: string): boolean {
  if (!Node.isIdentifier(node) || node.getText() !== globalName) return false;

  const parent = node.getParent();
  if (!parent) return false;

  if (parent.getKind() === SyntaxKind.TypeOfExpression) return false;
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) return false;
  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === node) return false;
  if (Node.isPropertyDeclaration(parent) && parent.getNameNode() === node) return false;
  if (Node.isPropertySignature(parent) && parent.getNameNode() === node) return false;
  if (Node.isMethodDeclaration(parent) && parent.getNameNode() === node) return false;
  if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node) {
    const decls = node.getSymbol()?.getDeclarations() ?? [];
    return decls.every((decl) => decl.getSourceFile() !== node.getSourceFile());
  }
  if (Node.isImportSpecifier(parent) || Node.isBindingElement(parent) || Node.isParameterDeclaration(parent))
    return false;
  if (Node.isVariableDeclaration(parent) && parent.getNameNode() === node) return false;
  if (Node.isFunctionDeclaration(parent) && parent.getNameNode() === node) return false;
  if (Node.isClassDeclaration(parent) && parent.getNameNode() === node) return false;
  if (Node.isTypeReference(parent) || Node.isQualifiedName(parent) || Node.isTypeAliasDeclaration(parent)) return false;

  const declarations = node.getSymbol()?.getDeclarations() ?? [];
  if (declarations.some((decl) => decl.getSourceFile() === node.getSourceFile())) return false;

  return true;
}

function isGuardedBrowserGlobalUse(node: Node, globalName: string): boolean {
  let current: Node | undefined = node;
  while ((current = current.getParent())) {
    if (Node.isIfStatement(current)) {
      if (
        isNodeWithin(node, current.getThenStatement()) &&
        conditionGuaranteesBrowserGlobal(current.getExpression(), globalName, 'true')
      ) {
        return true;
      }
      if (
        isNodeWithin(node, current.getElseStatement()) &&
        conditionGuaranteesBrowserGlobal(current.getExpression(), globalName, 'false')
      ) {
        return true;
      }
    }

    if (Node.isConditionalExpression(current)) {
      if (
        isNodeWithin(node, current.getWhenTrue()) &&
        conditionGuaranteesBrowserGlobal(current.getCondition(), globalName, 'true')
      ) {
        return true;
      }
      if (
        isNodeWithin(node, current.getWhenFalse()) &&
        conditionGuaranteesBrowserGlobal(current.getCondition(), globalName, 'false')
      ) {
        return true;
      }
    }

    if (Node.isBinaryExpression(current) && isNodeWithin(node, current.getRight())) {
      const operator = current.getOperatorToken().getText();
      if (operator === '&&' && conditionGuaranteesBrowserGlobal(current.getLeft(), globalName, 'true')) return true;
      if (operator === '||' && conditionGuaranteesBrowserGlobal(current.getLeft(), globalName, 'false')) return true;
    }
  }

  return false;
}

function getReactActionStateBindings(ctx: RuleContext): ActionStateBinding[] {
  const reactImports = ctx.sourceFile
    .getImportDeclarations()
    .filter((decl) => decl.getModuleSpecifierValue() === 'react');
  if (reactImports.length === 0) return [];

  const importedHookNames = new Set<string>();
  const namespaceImports = new Set<string>();
  for (const decl of reactImports) {
    for (const named of decl.getNamedImports()) {
      if (ACTION_STATE_HOOKS.has(named.getName())) {
        importedHookNames.add(named.getAliasNode()?.getText() ?? named.getName());
      }
    }
    const namespace = decl.getNamespaceImport();
    if (namespace) namespaceImports.add(namespace.getText());
  }

  if (importedHookNames.size === 0 && namespaceImports.size === 0) return [];

  const bindings: ActionStateBinding[] = [];
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    const init = decl.getInitializer();
    if (!Node.isArrayBindingPattern(nameNode) || !init || !Node.isCallExpression(init)) continue;

    const expr = init.getExpression();
    let isActionStateCall = false;
    if (Node.isIdentifier(expr)) {
      isActionStateCall = importedHookNames.has(expr.getText());
    } else if (Node.isPropertyAccessExpression(expr)) {
      isActionStateCall =
        namespaceImports.has(expr.getExpression().getText()) && ACTION_STATE_HOOKS.has(expr.getName());
    }
    if (!isActionStateCall) continue;

    const elements = nameNode.getElements();
    if (elements.length < 2) continue;

    const actionElement = elements[1];
    if (!Node.isBindingElement(actionElement)) continue;
    const actionNameNode = actionElement.getNameNode();
    if (!Node.isIdentifier(actionNameNode)) continue;

    const pendingElement = elements[2];
    const hasPendingBinding =
      pendingElement !== undefined &&
      Node.isBindingElement(pendingElement) &&
      Node.isIdentifier(pendingElement.getNameNode()) &&
      pendingElement.getNameNode().getText().trim().length > 0;

    const stateElement = elements[0];
    const stateNameNode =
      stateElement !== undefined &&
      Node.isBindingElement(stateElement) &&
      Node.isIdentifier(stateElement.getNameNode()) &&
      stateElement.getNameNode().getText().trim().length > 0
        ? stateElement.getNameNode()
        : undefined;

    bindings.push({
      decl,
      stateNameNode,
      actionName: actionNameNode.getText(),
      hasPendingBinding,
    });
  }

  return bindings;
}

function isActionBoundInJsx(ctx: RuleContext, actionName: string): boolean {
  return ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute).some((attr) => {
    const attrName = attr.getNameNode().getText();
    if (attrName !== 'action' && attrName !== 'formAction') return false;
    const initNode = attr.getInitializer();
    if (!initNode || !Node.isJsxExpression(initNode)) return false;
    const expression = initNode.getExpression();
    return expression?.getText() === actionName;
  });
}

function hasNonDeclarationReferenceInFile(ctx: RuleContext, identifier: Node): boolean {
  if (!Node.isIdentifier(identifier)) return false;

  const declarations = identifier.getSymbol()?.getDeclarations() ?? [];
  if (declarations.length === 0) return false;

  for (const candidate of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (candidate === identifier) continue;
    if (candidate.getText() !== identifier.getText()) continue;
    const candidateDeclarations = candidate.getSymbol()?.getDeclarations() ?? [];
    if (candidateDeclarations.length === 0) continue;
    const sameBinding = candidateDeclarations.some((decl) => declarations.includes(decl));
    if (!sameBinding) continue;
    return true;
  }

  return false;
}

function getJsxTagName(node: JsxTagLike): string {
  return node.getTagNameNode().getText();
}

function getJsxAttributes(node: JsxTagLike): import('ts-morph').JsxAttributeLike[] {
  return node.getAttributes();
}

function getJsxExpressionAttribute(node: JsxTagLike, attrName: string): Node | undefined {
  for (const attr of getJsxAttributes(node)) {
    if (!Node.isJsxAttribute(attr) || attr.getNameNode().getText() !== attrName) continue;
    const init = attr.getInitializer();
    if (!init || !Node.isJsxExpression(init)) return undefined;
    return init.getExpression() ?? undefined;
  }
  return undefined;
}

function getStringAttribute(node: JsxTagLike, attrName: string): string | undefined {
  for (const attr of getJsxAttributes(node)) {
    if (!Node.isJsxAttribute(attr) || attr.getNameNode().getText() !== attrName) continue;
    const init = attr.getInitializer();
    if (!init || !Node.isStringLiteral(init)) return undefined;
    return init.getLiteralText();
  }
  return undefined;
}

function isSubmitControl(node: JsxTagLike): boolean {
  const tagName = getJsxTagName(node);
  if (tagName === 'button') {
    const typeAttr = getStringAttribute(node, 'type');
    return typeAttr === undefined || typeAttr === 'submit';
  }

  if (tagName === 'input') {
    const typeAttr = getStringAttribute(node, 'type');
    return typeAttr === 'submit' || typeAttr === 'image';
  }

  return false;
}

function fileUsesUseFormStatus(ctx: RuleContext): boolean {
  const imports = ctx.sourceFile
    .getImportDeclarations()
    .filter((decl) => decl.getModuleSpecifierValue() === 'react-dom');
  if (imports.length === 0) return false;

  const importedHookNames = new Set<string>();
  const namespaceImports = new Set<string>();
  for (const decl of imports) {
    for (const named of decl.getNamedImports()) {
      if (named.getName() === 'useFormStatus')
        importedHookNames.add(named.getAliasNode()?.getText() ?? named.getName());
    }
    const namespace = decl.getNamespaceImport();
    if (namespace) namespaceImports.add(namespace.getText());
  }

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (Node.isIdentifier(expr) && importedHookNames.has(expr.getText())) return true;
    if (
      Node.isPropertyAccessExpression(expr) &&
      namespaceImports.has(expr.getExpression().getText()) &&
      expr.getName() === 'useFormStatus'
    ) {
      return true;
    }
  }

  return false;
}

function functionLikeHasUseServerDirective(node: Node): boolean {
  if (!Node.isFunctionDeclaration(node) && !Node.isFunctionExpression(node) && !Node.isArrowFunction(node))
    return false;
  const body = node.getBody();
  if (!body) return false;
  return /['"]use server['"]/.test(body.getText().substring(0, 100));
}

function functionLikeIsAsync(node: Node): boolean {
  if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node) || Node.isArrowFunction(node)) {
    return node.isAsync();
  }
  return false;
}

function resolveImportSourceFile(
  ctx: RuleContext,
  importDecl: import('ts-morph').ImportDeclaration,
): import('ts-morph').SourceFile | undefined {
  let resolvedSourceFile: import('ts-morph').SourceFile | undefined;
  try {
    resolvedSourceFile = importDecl.getModuleSpecifierSourceFile() ?? undefined;
  } catch {
    return undefined;
  }
  if (resolvedSourceFile) {
    // The shared fsProject caches resolved source files across reviewFile calls; refresh so edits
    // in the imported file (watch mode, repeated reviewFile invocations) are picked up.
    try {
      resolvedSourceFile.refreshFromFileSystemSync();
    } catch {
      // File may have been deleted — leave the (now-stale) reference; caller decides what to do.
    }
    return resolvedSourceFile;
  }

  const specifier = importDecl.getModuleSpecifierValue();
  if (!specifier.startsWith('.')) return undefined;

  const project = ctx.sourceFile.getProject();
  const fromDir = dirname(ctx.sourceFile.getFilePath());
  const fallbackCandidates = [specifier];
  if (specifier.endsWith('.js')) {
    fallbackCandidates.push(`${specifier.slice(0, -3)}.ts`, `${specifier.slice(0, -3)}.tsx`);
  } else if (specifier.endsWith('.jsx')) {
    fallbackCandidates.push(`${specifier.slice(0, -4)}.tsx`);
  } else {
    fallbackCandidates.push(`${specifier}.ts`, `${specifier}.tsx`, `${specifier}/index.ts`, `${specifier}/index.tsx`);
  }

  for (const candidate of fallbackCandidates) {
    const fullPath = resolve(fromDir, candidate);
    if (!existsSync(fullPath)) continue;
    const sourceFile = project.getSourceFile(fullPath);
    if (sourceFile) return sourceFile;
    try {
      return project.addSourceFileAtPath(fullPath);
    } catch {
      try {
        return new Project({
          compilerOptions: {
            strict: true,
            target: 99,
            module: 99,
            moduleResolution: 100,
            jsx: 4 /* Preserve */,
            allowJs: true,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
          },
        }).addSourceFileAtPath(fullPath);
      } catch {
        // Keep trying other extension fallbacks.
      }
    }
  }

  return undefined;
}

function resolveExportedServerActionFunctions(
  sourceFile: import('ts-morph').SourceFile | undefined,
  exportName: string,
): FunctionLikeNode[] {
  const resolved: FunctionLikeNode[] = [];
  if (!sourceFile) return resolved;

  const fileHasUseServer = hasServerDirective(sourceFile.getFullText());

  for (const fn of sourceFile.getFunctions()) {
    if (!fn.isExported() || fn.getName() !== exportName || !fn.isAsync()) continue;
    if (functionLikeHasUseServerDirective(fn) || (fileHasUseServer && fn.isExported())) resolved.push(fn);
  }

  for (const stmt of sourceFile.getVariableStatements()) {
    if (!stmt.isExported()) continue;
    for (const decl of stmt.getDeclarations()) {
      if (decl.getName() !== exportName) continue;
      const init = decl.getInitializer();
      if (!init || (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) || !init.isAsync()) continue;
      if (functionLikeHasUseServerDirective(init) || fileHasUseServer) resolved.push(init);
    }
  }

  return resolved;
}

function resolveImportedServerActionFunctions(ctx: RuleContext, decl: Node): FunctionLikeNode[] {
  if (Node.isImportSpecifier(decl)) {
    return resolveExportedServerActionFunctions(
      resolveImportSourceFile(ctx, decl.getImportDeclaration()),
      decl.getName(),
    );
  }

  if (Node.isNamespaceImport(decl)) return [];

  return [];
}

function resolveDirectImportedServerActionFunctions(ctx: RuleContext, expr: Node): FunctionLikeNode[] {
  if (Node.isIdentifier(expr)) {
    for (const decl of ctx.sourceFile.getImportDeclarations()) {
      for (const named of decl.getNamedImports()) {
        const localName = named.getAliasNode()?.getText() ?? named.getName();
        if (localName !== expr.getText()) continue;
        return resolveExportedServerActionFunctions(resolveImportSourceFile(ctx, decl), named.getName());
      }
    }
    return [];
  }

  if (Node.isPropertyAccessExpression(expr) && Node.isIdentifier(expr.getExpression())) {
    const namespaceName = expr.getExpression().getText();
    for (const decl of ctx.sourceFile.getImportDeclarations()) {
      const namespaceImport = decl.getNamespaceImport();
      if (!namespaceImport || namespaceImport.getText() !== namespaceName) continue;
      return resolveExportedServerActionFunctions(resolveImportSourceFile(ctx, decl), expr.getName());
    }
  }

  return [];
}

function resolveServerActionFunctions(ctx: RuleContext, expr: Node | undefined): FunctionLikeNode[] {
  const resolved: FunctionLikeNode[] = [];
  if (!expr) return resolved;

  const candidate = unwrapParens(expr);
  if ((Node.isFunctionExpression(candidate) || Node.isArrowFunction(candidate)) && functionLikeIsAsync(candidate)) {
    if (functionLikeHasUseServerDirective(candidate)) resolved.push(candidate);
    return resolved;
  }

  const directImportedActions = resolveDirectImportedServerActionFunctions(ctx, candidate);
  if (directImportedActions.length > 0) return directImportedActions;

  if (Node.isPropertyAccessExpression(candidate)) {
    const objectExpr = candidate.getExpression();
    if (!Node.isIdentifier(objectExpr)) return resolved;

    const declarations = objectExpr.getSymbol()?.getDeclarations() ?? [];
    for (const decl of declarations) {
      if (!Node.isNamespaceImport(decl)) continue;
      const importDecl = decl.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
      const sourceFile = importDecl ? resolveImportSourceFile(ctx, importDecl) : undefined;
      resolved.push(...resolveExportedServerActionFunctions(sourceFile, candidate.getName()));
    }
    return resolved;
  }

  if (!Node.isIdentifier(candidate)) return resolved;

  const declarations = candidate.getSymbol()?.getDeclarations() ?? [];
  for (const decl of declarations) {
    if (Node.isImportSpecifier(decl)) {
      resolved.push(...resolveImportedServerActionFunctions(ctx, decl));
      continue;
    }

    if (decl.getSourceFile() !== ctx.sourceFile) {
      resolved.push(...resolveImportedServerActionFunctions(ctx, decl));
      continue;
    }

    if (Node.isFunctionDeclaration(decl) && decl.isAsync()) {
      const fileHasUseServer = hasServerDirective(ctx.sourceFile.getFullText());
      if (functionLikeHasUseServerDirective(decl) || (fileHasUseServer && decl.isExported())) resolved.push(decl);
    }

    if (Node.isVariableDeclaration(decl)) {
      const init = decl.getInitializer();
      if (!init || (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) || !init.isAsync()) continue;
      const fileHasUseServer = hasServerDirective(ctx.sourceFile.getFullText());
      const variableStatement = decl.getVariableStatement();
      if (functionLikeHasUseServerDirective(init) || (fileHasUseServer && variableStatement?.isExported())) {
        resolved.push(init);
      }
    }
  }

  return resolved;
}

function isServerActionReference(ctx: RuleContext, expr: Node | undefined): boolean {
  return resolveServerActionFunctions(ctx, expr).length > 0;
}

function hasNativeSubmitDescendant(form: import('ts-morph').JsxElement): boolean {
  const opening = form.getOpeningElement();
  if (isSubmitControl(opening)) return true;

  for (const child of form.getDescendants()) {
    if (Node.isJsxOpeningElement(child) && isSubmitControl(child)) return true;
    if (Node.isJsxSelfClosingElement(child) && isSubmitControl(child)) return true;
  }

  return false;
}

function functionReturnsValue(node: FunctionLikeNode): boolean {
  const body = node.getBody();
  if (!body || !Node.isBlock(body)) return false;

  for (const stmt of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const expr = stmt.getExpression();
    if (!expr) continue;
    if (Node.isIdentifier(expr) && expr.getText() === 'undefined') continue;
    if (Node.isVoidExpression(expr)) continue;
    if (
      Node.isCallExpression(expr) &&
      Node.isIdentifier(expr.getExpression()) &&
      ['redirect', 'permanentRedirect', 'notFound'].includes(expr.getExpression().getText())
    ) {
      continue;
    }
    return true;
  }

  return false;
}

const POST_SUBMIT_CLOSURE_CALLS = new Set([
  'revalidatePath',
  'revalidateTag',
  'updateTag',
  'refresh',
  'redirect',
  'permanentRedirect',
  'notFound',
]);

const MUTATION_CALL_RE = /\b(create|update|delete|remove|insert|upsert|save|write|publish|archive|destroy|replace)\b/i;
const MUTATION_FETCH_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function functionCallsPostSubmitClosure(node: FunctionLikeNode): boolean {
  const body = node.getBody();
  if (!body) return false;

  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (Node.isIdentifier(expr) && POST_SUBMIT_CLOSURE_CALLS.has(expr.getText())) return true;
    if (Node.isPropertyAccessExpression(expr) && POST_SUBMIT_CLOSURE_CALLS.has(expr.getName())) return true;
  }

  return false;
}

function isKnownInputCarrier(node: Node): boolean {
  if (!Node.isIdentifier(node)) return false;
  const typeText = node.getType().getText(node);
  return (
    typeText.includes('FormData') ||
    typeText.includes('URLSearchParams') ||
    typeText.includes('Headers') ||
    ['formData', 'searchParams', 'headers'].includes(node.getText())
  );
}

function getMutationCall(node: FunctionLikeNode): import('ts-morph').CallExpression | undefined {
  const body = node.getBody();
  if (!body) return undefined;

  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();

    if (Node.isIdentifier(expr)) {
      if (expr.getText() === 'fetch') {
        const options = call.getArguments()[1];
        if (!options || !Node.isObjectLiteralExpression(options)) continue;
        const methodProp = options
          .getProperties()
          .find(
            (prop) =>
              Node.isPropertyAssignment(prop) &&
              prop.getName() === 'method' &&
              Node.isStringLiteral(prop.getInitializer() ?? undefined),
          );
        if (!methodProp || !Node.isPropertyAssignment(methodProp)) continue;
        const methodInit = methodProp.getInitializer();
        if (!methodInit || !Node.isStringLiteral(methodInit)) continue;
        if (MUTATION_FETCH_METHODS.has(methodInit.getLiteralText().toUpperCase())) return call;
        continue;
      }

      if (MUTATION_CALL_RE.test(expr.getText())) return call;
      continue;
    }

    if (!Node.isPropertyAccessExpression(expr)) continue;
    if (isKnownInputCarrier(expr.getExpression())) continue;
    if (MUTATION_CALL_RE.test(expr.getName())) return call;
  }

  return undefined;
}

function getFunctionLikeName(node: FunctionLikeNode): string {
  if (Node.isFunctionDeclaration(node)) return node.getName() ?? '<anon>';

  const parent = node.getParent();
  if (Node.isVariableDeclaration(parent)) return parent.getName();

  return '<anon>';
}

// ── Rule: use-client-drilled-too-high ────────────────────────────────────
// File has 'use client' but doesn't actually use any client API itself.
// Its children do. Moving the directive down would preserve RSC benefits.

function useClientDrilledTooHigh(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const fullText = ctx.sourceFile.getFullText();
  if (!hasClientDirective(fullText)) return [];
  if (fileUsesClientApi(ctx)) return [];

  // The file marks itself 'use client' but uses no client APIs. This is likely
  // a parent wrapper that drilled the directive too high. Signal is strongest
  // when the file has child imports that DO use client APIs — but we can't
  // cheaply check that without the full fileContextMap. Fire as a warning
  // either way; severity bumps to error when we can prove a child needs it.

  const severity: 'warning' | 'error' = 'warning';
  let detail = 'File has "use client" but uses no hooks, event handlers, or browser APIs itself.';
  let importedChildren: string[] = [];

  const graphFile = ctx.config?.graphFileMap?.get(ctx.filePath);
  if (graphFile && graphFile.imports.length > 0) {
    importedChildren = graphFile.imports;
    detail += ` Imported children: ${importedChildren
      .slice(0, 3)
      .map((p) => basename(p))
      .join(', ')}${importedChildren.length > 3 ? '…' : ''}.`;
  } else {
    const fileContextMap = ctx.config?.fileContextMap;
    if (fileContextMap) {
      // Fallback for older graph-aware callers that only provide fileContextMap.
      importedChildren = [...fileContextMap.entries()]
        .filter(([, v]) => v.importedBy.includes(ctx.filePath))
        .map(([k]) => k);
      if (importedChildren.length > 0) {
        detail += ` Imported children: ${importedChildren
          .slice(0, 3)
          .map((p) => basename(p))
          .join(', ')}${importedChildren.length > 3 ? '…' : ''}.`;
      }
    }
  }

  const line = 1;
  const result = finding(
    'use-client-drilled-too-high',
    severity,
    'pattern',
    `'use client' directive is drilled too high — ${detail} Move it to the leaf component that actually uses client APIs to preserve Server Component benefits.`,
    ctx.filePath,
    line,
    1,
    {
      suggestion:
        'Remove the top-level "use client" and add it to only the child component(s) that use hooks or browser APIs',
    },
  );
  result.relatedSpans = importedChildren.slice(0, 3).map((child) => ({
    file: child,
    startLine: 1,
    startCol: 1,
    endLine: 1,
    endCol: 1,
  }));
  result.provenance = {
    summary:
      importedChildren.length > 0
        ? `"use client" sits above ${importedChildren.length} imported child${importedChildren.length === 1 ? '' : 'ren'} while this file uses no client-only APIs itself.`
        : '"use client" is present, but the file itself has no local client-only API usage.',
    steps: [
      {
        kind: 'boundary',
        location: { file: ctx.filePath, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        label: `'use client'`,
        detail: 'Client boundary is declared at the top of this file.',
      },
      {
        kind: 'boundary',
        location: { file: ctx.filePath, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        label: 'no local client API usage',
        detail: 'This file does not use hooks, event handlers, or browser globals directly.',
      },
      ...importedChildren.slice(0, 3).map((child) => ({
        kind: 'import' as const,
        location: { file: child, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        label: basename(child),
        detail: 'Imported child under the same declared client boundary.',
      })),
    ],
  };
  return [result];
}

// ── Rule: server-api-in-client ───────────────────────────────────────────
// Client Component imports or calls server-only APIs:
//   - next/headers  (cookies(), headers(), draftMode())
//   - server-only   (explicit guard package)
// These will fail at build or runtime.

const SERVER_API_CALLS = new Set(['cookies', 'headers', 'draftMode']);
/** Node built-ins that have no business running in a Client Component bundle.
 *  Limited to file/process modules that the bundler cannot polyfill safely.
 *  Excludes neutral-by-default modules (`crypto`, `stream`, `path`) that are
 *  routinely browser-polyfilled and would generate false positives. */
const SERVER_ONLY_NODE_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);

/** True when an import is fully erased at compile time:
 *  `import type X from 'm'` (declaration-level type-only), OR every named specifier
 *  uses the `type` modifier `import { type X, type Y } from 'm'`, AND there is no
 *  default-import/namespace-import (those carry runtime references). */
function isFullyTypeOnlyImport(imp: import('ts-morph').ImportDeclaration): boolean {
  if (imp.isTypeOnly()) return true;
  if (imp.getDefaultImport() || imp.getNamespaceImport()) return false;
  const named = imp.getNamedImports();
  if (named.length === 0) return false; // bare `import 'm'` — runs at runtime
  return named.every((n) => n.isTypeOnly());
}

function serverApiInClient(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const fullText = ctx.sourceFile.getFullText();
  // 'use server' files are server actions/functions — they legitimately use
  // server-only APIs and fs. Skip them even when imported by a Client Component
  // (the file-context propagation could otherwise mark them as client-bound).
  if (hasServerDirective(fullText)) return [];
  const isClient = isClientBoundary(ctx, fullText);
  if (!isClient) return [];

  const findings: ReviewFinding[] = [];

  // Import check: `from 'next/headers'` / `from 'server-only'` / Node fs modules
  for (const imp of ctx.sourceFile.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    if (isFullyTypeOnlyImport(imp)) continue; // erased at compile time
    if (mod === 'next/headers' || mod === 'server-only' || SERVER_ONLY_NODE_MODULES.has(mod)) {
      const hit = finding(
        'server-api-in-client',
        'error',
        'bug',
        `Client Component imports '${mod}' — this will fail at build time. Server-only APIs cannot run in a client boundary.`,
        ctx.filePath,
        imp.getStartLineNumber(),
        1,
        {
          suggestion: `Move this logic to a Server Component or a server action, or drop the 'use client' directive if this file does not need it`,
        },
      );
      hit.provenance = {
        summary: `Client boundary imports server-only module '${mod}'.`,
        steps: [
          {
            kind: 'boundary',
            location: { file: ctx.filePath, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
            label: `'use client'`,
            detail: 'This file is treated as a Client Component.',
          },
          {
            kind: 'import',
            location: {
              file: ctx.filePath,
              startLine: imp.getStartLineNumber(),
              startCol: 1,
              endLine: imp.getStartLineNumber(),
              endCol: 1,
            },
            label: mod,
            detail: 'Server-only module imported into a client boundary.',
          },
        ],
      };
      findings.push(hit);
    }
  }

  // Call check: cookies()/headers()/draftMode() invocation in client code
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.Identifier) continue;
    const name = expr.getText();
    if (!SERVER_API_CALLS.has(name)) continue;
    // Only flag when imported from 'next/headers' — avoid false positives on
    // user-defined functions of the same name. We already flagged the import above,
    // so only emit the call-site finding if the import actually came from next/headers.
    const fromNextHeaders = ctx.sourceFile
      .getImportDeclarations()
      .some(
        (imp) =>
          imp.getModuleSpecifierValue() === 'next/headers' && imp.getNamedImports().some((ni) => ni.getName() === name),
      );
    if (!fromNextHeaders) continue;

    const hit = finding(
      'server-api-in-client',
      'error',
      'bug',
      `'${name}()' called in Client Component — next/headers APIs are server-only and will throw at runtime`,
      ctx.filePath,
      call.getStartLineNumber(),
      1,
      {
        suggestion: `Call '${name}()' in a Server Component or server action, then pass the result as a prop`,
      },
    );
    hit.provenance = {
      summary: `Client boundary calls server-only API ${name}().`,
      steps: [
        {
          kind: 'boundary',
          location: { file: ctx.filePath, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          label: `'use client'`,
          detail: 'This file is treated as a Client Component.',
        },
        {
          kind: 'call',
          location: {
            file: ctx.filePath,
            startLine: call.getStartLineNumber(),
            startCol: 1,
            endLine: call.getStartLineNumber(),
            endCol: 1,
          },
          label: `${name}()`,
          detail: `Call is only valid from 'next/headers' on the server.`,
        },
      ],
    };
    findings.push(hit);
  }

  // CommonJS form: const fs = require('fs') — also crashes in the client bundle.
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isIdentifier(callee) || callee.getText() !== 'require') continue;
    const args = call.getArguments();
    if (args.length !== 1) continue;
    const arg = args[0];
    if (!Node.isStringLiteral(arg)) continue;
    const mod = arg.getLiteralValue();
    if (!SERVER_ONLY_NODE_MODULES.has(mod)) continue;
    findings.push(
      finding(
        'server-api-in-client',
        'error',
        'bug',
        `Client Component calls require('${mod}') — server-only Node module will not resolve in the browser bundle`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            "Move this logic to a Server Component or server action, or drop the 'use client' directive if this file does not need it",
        },
      ),
    );
  }

  return findings;
}

// ── Rule: browser-api-in-server ──────────────────────────────────────────
// Browser globals used directly in a Server Component / server boundary.

function browserApiInServer(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const fullText = ctx.sourceFile.getFullText();
  if (isClientBoundary(ctx, fullText)) return [];
  if (!BROWSER_GLOBALS.test(fullText)) return [];

  const findings: ReviewFinding[] = [];
  const reported = new Set<string>();
  for (const identifier of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const globalName = identifier.getText();
    if (!BROWSER_GLOBAL_NAMES.includes(globalName)) continue;
    if (reported.has(globalName)) continue;
    if (!isBrowserGlobalReference(identifier, globalName)) continue;
    if (isGuardedBrowserGlobalUse(identifier, globalName)) continue;

    reported.add(globalName);
    findings.push(
      finding(
        'browser-api-in-server',
        'error',
        'bug',
        `'${globalName}' is used in a Server Component/server boundary — browser APIs require 'use client' or a Client Component`,
        ctx.filePath,
        identifier.getStartLineNumber(),
        1,
        {
          suggestion:
            'Move this logic into a Client Component, or pass a server-safe value down as a prop instead of reading browser globals here',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: use-action-state-missing-pending ───────────────────────────────
// useActionState bound to form action but pending tuple value is not captured.

function useActionStateMissingPending(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const fullText = ctx.sourceFile.getFullText();
  if (!isClientBoundary(ctx, fullText)) return [];

  const findings: ReviewFinding[] = [];
  for (const binding of getReactActionStateBindings(ctx)) {
    if (binding.hasPendingBinding) continue;
    if (!isActionBoundInJsx(ctx, binding.actionName)) continue;

    findings.push(
      finding(
        'use-action-state-missing-pending',
        'warning',
        'pattern',
        `useActionState is bound to '${binding.actionName}' without capturing the pending tuple value — server action submits have no in-flight UI state`,
        ctx.filePath,
        binding.decl.getStartLineNumber(),
        1,
        {
          suggestion:
            'Capture the third tuple value from useActionState, e.g. const [state, formAction, pending] = useActionState(...), then disable the submit button or show loading UI while pending',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: use-action-state-missing-feedback ──────────────────────────────
// useActionState bound to form action but returned state is never read.

function useActionStateMissingFeedback(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const fullText = ctx.sourceFile.getFullText();
  if (!isClientBoundary(ctx, fullText)) return [];

  const findings: ReviewFinding[] = [];
  for (const binding of getReactActionStateBindings(ctx)) {
    if (!isActionBoundInJsx(ctx, binding.actionName)) continue;
    if (binding.stateNameNode && hasNonDeclarationReferenceInFile(ctx, binding.stateNameNode)) continue;

    findings.push(
      finding(
        'use-action-state-missing-feedback',
        'warning',
        'pattern',
        `useActionState is bound to '${binding.actionName}' but its state value is never read — server action success/error feedback is not surfaced`,
        ctx.filePath,
        binding.decl.getStartLineNumber(),
        1,
        {
          suggestion:
            'Read the first tuple value from useActionState and surface result state in the UI or a side effect (for example an error message, success state, toast, or redirect)',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: server-action-form-missing-pending ─────────────────────────────
// Native submit control is wired directly to a Server Action but no pending
// state substrate (useActionState / useFormStatus) is present in the file.

function serverActionFormMissingPending(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const actionStateBindings = getReactActionStateBindings(ctx);
  const actionStateNames = new Set(actionStateBindings.map((binding) => binding.actionName));
  if (fileUsesUseFormStatus(ctx)) return [];

  const findings: ReviewFinding[] = [];
  for (const form of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement)) {
    if (getJsxTagName(form.getOpeningElement()) !== 'form') continue;

    const actionExpr = getJsxExpressionAttribute(form.getOpeningElement(), 'action');
    if (!actionExpr) continue;
    if (Node.isIdentifier(actionExpr) && actionStateNames.has(actionExpr.getText())) continue;
    if (!isServerActionReference(ctx, actionExpr)) continue;
    if (!hasNativeSubmitDescendant(form)) continue;

    findings.push(
      finding(
        'server-action-form-missing-pending',
        'warning',
        'pattern',
        'Form is wired directly to a Server Action with a native submit control but no pending-state UX was detected — users can resubmit while the action is in flight',
        ctx.filePath,
        form.getStartLineNumber(),
        1,
        {
          suggestion:
            'Render the submit button from a Client Component that uses useFormStatus(), then disable it or show loading text while pending. If you need result state too, consider useActionState().',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: server-action-form-return-value-ignored ────────────────────────
// Direct form actions do not surface returned values. If a same-file Server
// Action returns data, it should usually be wired through useActionState.

function serverActionFormReturnValueIgnored(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const actionStateBindings = getReactActionStateBindings(ctx);
  const actionStateNames = new Set(actionStateBindings.map((binding) => binding.actionName));

  const findings: ReviewFinding[] = [];
  for (const form of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement)) {
    if (getJsxTagName(form.getOpeningElement()) !== 'form') continue;

    const actionExpr = getJsxExpressionAttribute(form.getOpeningElement(), 'action');
    if (!actionExpr) continue;
    if (Node.isIdentifier(actionExpr) && actionStateNames.has(actionExpr.getText())) continue;

    const serverActions = resolveServerActionFunctions(ctx, actionExpr);
    if (serverActions.length === 0) continue;
    if (!serverActions.some((fn) => functionReturnsValue(fn))) continue;

    findings.push(
      finding(
        'server-action-form-return-value-ignored',
        'warning',
        'bug',
        'Form posts directly to a Server Action that returns a value, but plain form actions do not surface returned state — the result is ignored unless you use useActionState()',
        ctx.filePath,
        form.getStartLineNumber(),
        1,
        {
          suggestion:
            'If the action result drives success/error UI, wrap it in useActionState() and render the returned state. Otherwise remove the unused return value and redirect/revalidate explicitly.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: server-action-form-mutation-missing-invalidation ───────────────
// Direct form action posts to a mutating Server Action that neither revalidates
// cache nor redirects, so the submit likely completes with stale UI.

function serverActionFormMutationMissingInvalidation(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const actionStateBindings = getReactActionStateBindings(ctx);
  const actionStateNames = new Set(actionStateBindings.map((binding) => binding.actionName));

  const findings: ReviewFinding[] = [];
  for (const form of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement)) {
    if (getJsxTagName(form.getOpeningElement()) !== 'form') continue;

    const actionExpr = getJsxExpressionAttribute(form.getOpeningElement(), 'action');
    if (!actionExpr) continue;
    if (Node.isIdentifier(actionExpr) && actionStateNames.has(actionExpr.getText())) continue;

    const candidate = resolveServerActionFunctions(ctx, actionExpr).find((fn) => {
      if (functionReturnsValue(fn)) return false;
      if (functionCallsPostSubmitClosure(fn)) return false;
      return !!getMutationCall(fn);
    });
    if (!candidate) continue;

    const actionFile = candidate.getSourceFile().getFilePath();
    const actionName = getFunctionLikeName(candidate);
    const mutationCall = getMutationCall(candidate);
    const actionLine = candidate.getStartLineNumber();
    const mutationLine = mutationCall?.getStartLineNumber();

    const hit = finding(
      'server-action-form-mutation-missing-invalidation',
      'warning',
      'bug',
      `Form posts directly to mutating Server Action '${actionName}' but no redirect or cache invalidation was detected — the submit can complete with stale UI`,
      ctx.filePath,
      form.getStartLineNumber(),
      1,
      {
        suggestion:
          'After a successful mutation, call revalidatePath(), revalidateTag(), updateTag(), redirect(), or return state through useActionState() so the UI closes the loop.',
      },
    );
    hit.relatedSpans = [span(actionFile, actionLine), ...(mutationLine ? [span(actionFile, mutationLine)] : [])];
    hit.provenance = {
      summary: `Form action resolves to ${actionName}(), which performs a likely mutation but does not redirect or refresh server data.`,
      steps: [
        {
          kind: 'call',
          location: span(actionFile, actionLine),
          label: `${actionName}()`,
          detail: 'Resolved Server Action bound to the form action.',
        },
        ...(mutationLine
          ? [
              {
                kind: 'call' as const,
                location: span(actionFile, mutationLine),
                label: mutationCall?.getExpression().getText() ?? 'mutation call',
                detail: 'Likely mutating operation inside the Server Action body.',
              },
            ]
          : []),
      ],
    };
    findings.push(hit);
  }

  return findings;
}

// ── Rule: server-action-unvalidated-input ────────────────────────────────
// Server action (file or function marked 'use server') receives args and
// uses them without passing through a validator (.parse, .safeParse, zod,
// yup, joi, a schema, or a typeof/instanceof guard).

// Validator detection is intentionally strict: we require the call to look
// like it originates from a known schema library, not just ANY .parse(). A
// naive /\.parse\(/ test would accept `JSON.parse(str)` or `path.parse(p)`
// as "validation" and suppress the rule. Instead, we require BOTH a known
// library reference AND a validating method call in the same body.
const SCHEMA_LIBRARY_PATTERNS = [
  /\bz\.\w+/, // zod
  /\byup\.\w+/,
  /\bjoi\.\w+/,
  /\b(from\s+['"]zod['"]|from\s+['"]yup['"]|from\s+['"]joi['"]|from\s+['"]valibot['"]|from\s+['"]@?superstruct['"])/,
];

const SCHEMA_METHOD_PATTERNS = [
  /\.safeParse\s*\(/,
  /\bz\.(object|string|number|boolean|array|enum|union|literal|tuple)\s*\(/,
  /\bparse\s*\(/, // bare parse — only counted alongside a library reference (see hasValidatorUsage)
];

const NAIVE_VALIDATOR_PATTERNS = [/\.validate(Sync)?\s*\(/, /\.assert\s*\(/, /\bassert\s*\(/];

function hasValidatorUsage(bodyText: string, importsText: string): boolean {
  // Strong signal: schema library import or reference PLUS a schema method call
  const hasLib =
    SCHEMA_LIBRARY_PATTERNS.some((p) => p.test(importsText)) || SCHEMA_LIBRARY_PATTERNS.some((p) => p.test(bodyText));
  const hasSchemaMethod = SCHEMA_METHOD_PATTERNS.some((p) => p.test(bodyText));
  if (hasLib && hasSchemaMethod) return true;
  // Weaker but still reasonable: explicit .validate()/.assert() call
  if (NAIVE_VALIDATOR_PATTERNS.some((p) => p.test(bodyText))) return true;
  return false;
}

/** Check that at least ONE of the function's params is referenced in the body. */
function anyParamIsReferenced(paramNames: string[], bodyText: string): string | undefined {
  for (const name of paramNames) {
    if (!name) continue;
    if (new RegExp(`\\b${name}\\b`).test(bodyText)) return name;
  }
  return undefined;
}

function getImportsText(ctx: RuleContext): string {
  return ctx.sourceFile
    .getImportDeclarations()
    .map((d) => d.getText())
    .join('\n');
}

function serverActionUnvalidatedInput(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const fullText = ctx.sourceFile.getFullText();
  const fileIsServerAction = hasServerDirective(fullText);
  const findings: ReviewFinding[] = [];
  const importsText = getImportsText(ctx);

  // Iterate exported async functions
  for (const fn of ctx.sourceFile.getFunctions()) {
    if (!fn.isExported() || !fn.isAsync()) continue;
    const params = fn.getParameters();
    if (params.length === 0) continue;

    const body = fn.getBody();
    if (!body) continue;
    const bodyText = body.getText();

    // Function-level 'use server' directive (inside the function body) OR file-level
    const fnIsServerAction = fileIsServerAction || /['"]use server['"]/.test(bodyText.substring(0, 100));
    if (!fnIsServerAction) continue;

    if (hasValidatorUsage(bodyText, importsText)) continue;

    // Check ALL params, not just the first — Next server actions use
    // `(prevState, formData)` when wired to useActionState, so formData is
    // often params[1], not params[0].
    const paramNames = params.map((p) => p.getName());
    const refParam = anyParamIsReferenced(paramNames, bodyText);
    if (!refParam) continue;

    findings.push(
      finding(
        'server-action-unvalidated-input',
        'warning',
        'bug',
        `Server action '${fn.getName() || '<anon>'}' uses parameter '${refParam}' without validation — server actions receive untrusted client input`,
        ctx.filePath,
        fn.getStartLineNumber(),
        1,
        {
          suggestion:
            'Validate input with a schema (zod.parse / yup.validate / joi.validate) before using. Type annotations are NOT enforced at runtime.',
        },
      ),
    );
  }

  // Also handle arrow functions assigned to exported consts
  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    if (!stmt.isExported()) continue;
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      if (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) continue;
      if (!init.isAsync?.()) continue;

      const params = init.getParameters();
      if (params.length === 0) continue;
      const body = init.getBody();
      if (!body) continue;
      const bodyText = body.getText();

      const fnIsServerAction = fileIsServerAction || /['"]use server['"]/.test(bodyText.substring(0, 100));
      if (!fnIsServerAction) continue;
      if (hasValidatorUsage(bodyText, importsText)) continue;

      const paramNames = params.map((p) => p.getName());
      const refParam = anyParamIsReferenced(paramNames, bodyText);
      if (!refParam) continue;

      findings.push(
        finding(
          'server-action-unvalidated-input',
          'warning',
          'bug',
          `Server action '${decl.getName()}' uses parameter '${refParam}' without validation`,
          ctx.filePath,
          decl.getStartLineNumber(),
          1,
          {
            suggestion:
              'Validate input with a schema (zod.parse / yup.validate / joi.validate) before using. Type annotations are NOT enforced at runtime.',
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: route-handler-json-type-assertion ─────────────────────────────
// Next.js App Router route handlers receive untrusted request bodies. A TS
// assertion on `await request.json()` only tells the compiler what to believe;
// it does not validate malformed JSON or unexpected body shape at runtime.

const ROUTE_HANDLER_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function getFunctionBodyNode(fn: FunctionLikeNode): Node | undefined {
  if (Node.isFunctionDeclaration(fn) || Node.isFunctionExpression(fn) || Node.isArrowFunction(fn)) {
    return fn.getBody();
  }
  return undefined;
}

function isRequestJsonCallForParam(call: import('ts-morph').CallExpression, requestParamNames: Set<string>): boolean {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  if (callee.getName() !== 'json') return false;
  const receiver = callee.getExpression();
  return Node.isIdentifier(receiver) && requestParamNames.has(receiver.getText());
}

function hasTypeOnlyTrustAroundJsonCall(call: import('ts-morph').CallExpression): boolean {
  let current: Node = call;
  while (true) {
    const parent = current.getParent();
    if (!parent) break;

    if (Node.isAsExpression(parent) || Node.isTypeAssertion(parent) || Node.isSatisfiesExpression(parent)) return true;
    if (Node.isAwaitExpression(parent) || Node.isParenthesizedExpression(parent) || Node.isNonNullExpression(parent)) {
      current = parent;
      continue;
    }
    break;
  }

  let ancestor: Node | undefined = call.getParent();
  while (ancestor) {
    if (Node.isVariableDeclaration(ancestor)) {
      const init = ancestor.getInitializer();
      return Boolean(
        ancestor.getTypeNode() && init && init.getStart() <= call.getStart() && call.getEnd() <= init.getEnd(),
      );
    }
    if (Node.isBlock(ancestor) || Node.isSourceFile(ancestor) || Node.isFunctionLikeDeclaration(ancestor)) break;
    ancestor = ancestor.getParent();
  }

  return false;
}

function checkRouteHandlerJsonTypeAssertions(
  ctx: RuleContext,
  methodName: string,
  fn: FunctionLikeNode,
  importsText: string,
): ReviewFinding[] {
  const body = getFunctionBodyNode(fn);
  if (!body) return [];

  const bodyText = body.getText();
  if (hasValidatorUsage(bodyText, importsText)) return [];

  const requestParamNames = new Set(
    fn
      .getParameters()
      .slice(0, 1)
      .map((param) => param.getName())
      .filter(Boolean),
  );
  if (requestParamNames.size === 0) return [];

  const findings: ReviewFinding[] = [];
  const seen = new Set<number>();
  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isRequestJsonCallForParam(call, requestParamNames)) continue;
    if (!hasTypeOnlyTrustAroundJsonCall(call)) continue;
    if (seen.has(call.getStart())) continue;
    seen.add(call.getStart());

    findings.push(
      finding(
        'route-handler-json-type-assertion',
        'warning',
        'bug',
        `Route handler ${methodName} trusts request.json() via a TypeScript-only type assertion — request bodies need runtime validation`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Parse the body inside error handling and validate it with a schema (for example zod.safeParse) before reading typed fields.',
        },
      ),
    );
  }

  return findings;
}

function routeHandlerJsonTypeAssertion(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const importsText = getImportsText(ctx);
  const findings: ReviewFinding[] = [];

  for (const fn of ctx.sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name || !ROUTE_HANDLER_METHODS.has(name) || !fn.isExported()) continue;
    findings.push(...checkRouteHandlerJsonTypeAssertions(ctx, name, fn, importsText));
  }

  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    if (!stmt.isExported()) continue;
    for (const decl of stmt.getDeclarations()) {
      const name = decl.getName();
      if (!ROUTE_HANDLER_METHODS.has(name)) continue;
      const init = decl.getInitializer();
      if (!init || (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init))) continue;
      findings.push(...checkRouteHandlerJsonTypeAssertions(ctx, name, init, importsText));
    }
  }

  return findings;
}

function isInsideTryBlock(node: Node, boundary: Node): boolean {
  let current: Node | undefined = node;
  while (current && current !== boundary) {
    const parent = current.getParent();
    if (!parent) break;
    if (Node.isTryStatement(parent) && isNodeWithin(node, parent.getTryBlock())) return true;
    current = parent;
  }
  return false;
}

function isRouteHandlerJsonCall(call: import('ts-morph').CallExpression, fn: FunctionLikeNode): boolean {
  const requestParamNames = new Set(
    fn
      .getParameters()
      .slice(0, 1)
      .map((param) => param.getName())
      .filter(Boolean),
  );
  return requestParamNames.size > 0 && isRequestJsonCallForParam(call, requestParamNames);
}

// ── Rule: route-handler-json-unguarded ──────────────────────────────────
// request.json() can throw on malformed JSON. Route handlers that parse
// outside try/catch turn client body mistakes into uncaught handler failures.

function checkRouteHandlerJsonUnguarded(ctx: RuleContext, methodName: string, fn: FunctionLikeNode): ReviewFinding[] {
  const body = getFunctionBodyNode(fn);
  if (!body) return [];

  const findings: ReviewFinding[] = [];
  const seen = new Set<number>();
  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isRouteHandlerJsonCall(call, fn)) continue;
    if (isInsideTryBlock(call, body)) continue;
    if (seen.has(call.getStart())) continue;
    seen.add(call.getStart());

    findings.push(
      finding(
        'route-handler-json-unguarded',
        'warning',
        'bug',
        `Route handler ${methodName} calls request.json() outside try/catch — malformed JSON becomes an uncaught handler error`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Wrap body parsing in try/catch and return a 400 response for malformed JSON before validating the parsed shape.',
        },
      ),
    );
  }

  return findings;
}

function forEachRouteHandler(
  ctx: RuleContext,
  cb: (methodName: string, fn: FunctionLikeNode) => ReviewFinding[],
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const fn of ctx.sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name || !ROUTE_HANDLER_METHODS.has(name) || !fn.isExported()) continue;
    findings.push(...cb(name, fn));
  }

  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    if (!stmt.isExported()) continue;
    for (const decl of stmt.getDeclarations()) {
      const name = decl.getName();
      if (!ROUTE_HANDLER_METHODS.has(name)) continue;
      const init = decl.getInitializer();
      if (!init || (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init))) continue;
      findings.push(...cb(name, init));
    }
  }

  return findings;
}

function routeHandlerJsonUnguarded(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  return forEachRouteHandler(ctx, (methodName, fn) => checkRouteHandlerJsonUnguarded(ctx, methodName, fn));
}

// ── Rule: route-handler-json-content-type-missing ───────────────────────
// POST/PUT/PATCH handlers that parse JSON should usually reject non-JSON
// content before parsing. That gives clients a deterministic 415/400 path and
// avoids treating arbitrary body formats as malformed JSON.

const JSON_BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function functionChecksContentType(fn: FunctionLikeNode): boolean {
  const body = getFunctionBodyNode(fn);
  if (!body) return false;
  const requestParamName = fn.getParameters()[0]?.getName();
  if (!requestParamName) return false;

  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'get') continue;
    const receiver = callee.getExpression();
    if (!Node.isPropertyAccessExpression(receiver) || receiver.getName() !== 'headers') continue;
    const requestObject = receiver.getExpression();
    if (!Node.isIdentifier(requestObject) || requestObject.getText() !== requestParamName) continue;
    const header = normalizeHeaderNameNode(call.getArguments()[0]);
    if (header === 'content-type') return true;
  }

  return false;
}

function checkRouteHandlerJsonContentType(ctx: RuleContext, methodName: string, fn: FunctionLikeNode): ReviewFinding[] {
  if (!JSON_BODY_METHODS.has(methodName)) return [];
  const body = getFunctionBodyNode(fn);
  if (!body || functionChecksContentType(fn)) return [];

  const findings: ReviewFinding[] = [];
  const seen = new Set<number>();
  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isRouteHandlerJsonCall(call, fn)) continue;
    if (seen.has(call.getStart())) continue;
    seen.add(call.getStart());

    findings.push(
      finding(
        'route-handler-json-content-type-missing',
        'warning',
        'pattern',
        `Route handler ${methodName} parses request.json() without checking Content-Type — non-JSON requests fall into the malformed-body path`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            "Check request.headers.get('content-type') for application/json before parsing, and return 415/400 for unsupported body types.",
        },
      ),
    );
  }

  return findings;
}

function routeHandlerJsonContentTypeMissing(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  return forEachRouteHandler(ctx, (methodName, fn) => checkRouteHandlerJsonContentType(ctx, methodName, fn));
}

// ── Rule: route-handler-catch-status-undefined ──────────────────────────
// Catch blocks often convert upstream errors to responses. Passing a bare
// `status` identifier into Response.json can become undefined/invalid when the
// thrown value is not the expected error shape.

function checkRouteHandlerCatchStatusUndefined(ctx: RuleContext, fn: FunctionLikeNode): ReviewFinding[] {
  const body = getFunctionBodyNode(fn);
  if (!body) return [];
  const findings: ReviewFinding[] = [];

  function unwrapStatusInitializer(node: Node): Node {
    let current = node;
    while (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isTypeAssertion(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isAwaitExpression(current)
    ) {
      current = current.getExpression();
    }
    return current;
  }

  function isDirectCatchValue(node: Node | undefined, catchName: string | undefined): boolean {
    if (!node || !catchName) return false;
    const unwrapped = unwrapStatusInitializer(node);
    if (Node.isIdentifier(unwrapped)) return unwrapped.getText() === catchName;
    if (Node.isPropertyAccessExpression(unwrapped)) return unwrapped.getExpression().getText() === catchName;
    return false;
  }

  for (const catchClause of body.getDescendantsOfKind(SyntaxKind.CatchClause)) {
    const block = catchClause.getBlock();
    const catchName = catchClause.getVariableDeclaration()?.getName();
    const statusNames = new Set<string>();

    for (const decl of block.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const nameNode = decl.getNameNode();
      const initText = decl.getInitializer()?.getText() ?? '';
      if (Node.isObjectBindingPattern(nameNode)) {
        if (!isDirectCatchValue(decl.getInitializer(), catchName)) continue;
        for (const element of nameNode.getElements()) {
          const key = element.getPropertyNameNode()?.getText() ?? element.getNameNode().getText();
          if (key === 'status') statusNames.add(element.getNameNode().getText());
        }
      } else if (Node.isIdentifier(nameNode) && /status/i.test(nameNode.getText())) {
        if (catchName && new RegExp(`\\b${catchName}\\b`).test(initText) && /\.status\b/.test(initText)) {
          statusNames.add(nameNode.getText());
        }
      }
    }

    for (const call of block.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'json') continue;
      const receiver = callee.getExpression().getText();
      if (receiver !== 'Response' && receiver !== 'NextResponse') continue;
      const options = call.getArguments()[1];
      if (!options || !Node.isObjectLiteralExpression(options)) continue;

      for (const prop of options.getProperties()) {
        if (!Node.isPropertyAssignment(prop) && !Node.isShorthandPropertyAssignment(prop)) continue;
        const name = Node.isPropertyAssignment(prop)
          ? prop.getNameNode().getText().replace(/['"`]/g, '')
          : prop.getName();
        if (name !== 'status') continue;
        const value = Node.isPropertyAssignment(prop) ? prop.getInitializer() : prop.getNameNode();
        if (!value) continue;
        const isStatusAlias = Node.isIdentifier(value) && statusNames.has(value.getText());
        const isDirectErrorStatus =
          Boolean(catchName) &&
          /\.status\b/.test(value.getText()) &&
          new RegExp(`\\b${catchName}\\b`).test(value.getText());
        if (!isStatusAlias && !isDirectErrorStatus) continue;

        findings.push(
          finding(
            'route-handler-catch-status-undefined',
            'warning',
            'bug',
            'Catch block passes an error-derived status directly to Response.json() — unexpected thrown values can produce undefined or invalid HTTP status',
            ctx.filePath,
            prop.getStartLineNumber(),
            1,
            {
              suggestion:
                'Validate the status range or use a fallback such as status: isHttpStatus(status) ? status : 500.',
            },
          ),
        );
      }
    }
  }

  return findings;
}

function routeHandlerCatchStatusUndefined(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  return forEachRouteHandler(ctx, (_methodName, fn) => checkRouteHandlerCatchStatusUndefined(ctx, fn));
}

// ── Rule: forwarded-client-header ───────────────────────────────────────
// Forwarding caller-supplied x-forwarded-for or user-agent to sensitive
// upstreams gives clients influence over audit/fraud/auth context.

const FORWARDED_CLIENT_HEADERS = new Set(['x-forwarded-for', 'user-agent']);

function normalizeHeaderNameNode(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
    return node.getLiteralText().toLowerCase();
  return undefined;
}

function isClientHeaderRead(node: Node, requestParamNames: Set<string>, headerName: string): boolean {
  for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'get') continue;
    const receiver = callee.getExpression();
    if (!Node.isPropertyAccessExpression(receiver) || receiver.getName() !== 'headers') continue;
    const requestObject = receiver.getExpression();
    if (!Node.isIdentifier(requestObject) || !requestParamNames.has(requestObject.getText())) continue;
    const readHeader = normalizeHeaderNameNode(call.getArguments()[0]);
    if (readHeader === headerName) return true;
  }

  return false;
}

function collectClientHeaderAliases(body: Node, requestParamNames: Set<string>, headerName: string): Set<string> {
  const aliases = new Set<string>();
  for (const decl of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    if (!Node.isIdentifier(nameNode)) continue;
    const init = decl.getInitializer();
    if (!init || !isClientHeaderRead(init, requestParamNames, headerName)) continue;
    aliases.add(nameNode.getText());
  }
  return aliases;
}

function isClientHeaderReadOrAlias(
  node: Node,
  requestParamNames: Set<string>,
  headerName: string,
  aliases: Set<string>,
): boolean {
  if (isClientHeaderRead(node, requestParamNames, headerName)) return true;
  if (Node.isIdentifier(node) && aliases.has(node.getText())) return true;
  return node.getDescendantsOfKind(SyntaxKind.Identifier).some((identifier) => {
    if (!aliases.has(identifier.getText())) return false;
    const parent = identifier.getParent();
    if (parent && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) return false;
    return true;
  });
}

function checkForwardedClientHeaders(ctx: RuleContext, methodName: string, fn: FunctionLikeNode): ReviewFinding[] {
  const body = getFunctionBodyNode(fn);
  if (!body) return [];

  const requestParamNames = new Set(
    fn
      .getParameters()
      .slice(0, 1)
      .map((param) => param.getName())
      .filter(Boolean),
  );
  if (requestParamNames.size === 0) return [];

  const findings: ReviewFinding[] = [];
  const aliasesByHeader = new Map(
    [...FORWARDED_CLIENT_HEADERS].map((headerName) => [
      headerName,
      collectClientHeaderAliases(body, requestParamNames, headerName),
    ]),
  );

  for (const assignment of body.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const headerName = assignment.getNameNode().getText().replace(/['"`]/g, '').toLowerCase();
    if (!FORWARDED_CLIENT_HEADERS.has(headerName)) continue;
    const init = assignment.getInitializer();
    if (
      !init ||
      !isClientHeaderReadOrAlias(init, requestParamNames, headerName, aliasesByHeader.get(headerName) ?? new Set())
    )
      continue;

    findings.push(
      finding(
        'forwarded-client-header',
        'warning',
        'bug',
        `Route handler ${methodName} forwards caller-controlled '${headerName}' upstream — clients can spoof audit, fraud, or auth context`,
        ctx.filePath,
        assignment.getStartLineNumber(),
        1,
        {
          suggestion:
            'Prefer framework/trusted proxy metadata, or explicitly mark forwarded values as untrusted and avoid using them for authorization or fraud decisions.',
        },
      ),
    );
  }

  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'set') continue;
    const headerName = normalizeHeaderNameNode(call.getArguments()[0]);
    if (!headerName || !FORWARDED_CLIENT_HEADERS.has(headerName)) continue;
    const value = call.getArguments()[1];
    if (
      !value ||
      !isClientHeaderReadOrAlias(value, requestParamNames, headerName, aliasesByHeader.get(headerName) ?? new Set())
    )
      continue;

    findings.push(
      finding(
        'forwarded-client-header',
        'warning',
        'bug',
        `Route handler ${methodName} forwards caller-controlled '${headerName}' upstream — clients can spoof audit, fraud, or auth context`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Prefer framework/trusted proxy metadata, or explicitly mark forwarded values as untrusted and avoid using them for authorization or fraud decisions.',
        },
      ),
    );
  }

  return findings;
}

function forwardedClientHeader(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  return forEachRouteHandler(ctx, (methodName, fn) => checkForwardedClientHeaders(ctx, methodName, fn));
}

// ── Rule: middleware-cloned-request-headers ─────────────────────────────
// Cloning the entire incoming header bag in middleware can forward cookies,
// authorization, spoofable forwarding headers, and browser-only headers into
// internal rewrites/fetches. Middleware should usually construct an allowlist.

function middlewareClonedRequestHeaders(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  if (!/(^|\/)middleware\.[cm]?[jt]sx?$/.test(ctx.filePath)) return [];

  function isRequestHeaderClone(node: Node): boolean {
    if (!Node.isNewExpression(node)) return false;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr) || expr.getText() !== 'Headers') return false;
    const argText = node.getArguments()[0]?.getText() ?? '';
    return /\b(?:request|req)\.headers\b/.test(argText);
  }

  const clonedHeaderAliases = new Set<string>();
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    if (!Node.isIdentifier(nameNode)) continue;
    const init = decl.getInitializer();
    if (init && isRequestHeaderClone(init)) clonedHeaderAliases.add(nameNode.getText());
  }

  const findings: ReviewFinding[] = [];
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isIdentifier(callee) || callee.getText() !== 'fetch') continue;
    const init = call
      .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
      .find((prop) => prop.getNameNode().getText().replace(/['"`]/g, '') === 'headers')
      ?.getInitializer();
    if (!init) continue;
    const forwardsClone =
      (Node.isIdentifier(init) && clonedHeaderAliases.has(init.getText())) ||
      init
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .some((identifier) => clonedHeaderAliases.has(identifier.getText())) ||
      isRequestHeaderClone(init);
    if (!forwardsClone) continue;

    findings.push(
      finding(
        'middleware-cloned-request-headers',
        'warning',
        'bug',
        'Middleware forwards a clone of all incoming request headers to fetch() — upstream calls may receive cookies, authorization, or spoofable client headers',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Build a new Headers object from an explicit allowlist and drop cookie, authorization, x-forwarded-*, and browser-only headers unless intentionally needed.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: mock-route-missing-env-guard ──────────────────────────────────
// Mock/dev API routes should be unreachable in production builds unless an
// explicit environment guard blocks them.

function mockRouteMissingEnvGuard(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  if (!/(^|\/)app\/api\/(?:mock|dev-|dev\/|__mock__)/i.test(ctx.filePath)) return [];
  if (!/route\.[cm]?[jt]sx?$/i.test(ctx.filePath)) return [];

  const fullText = ctx.sourceFile.getFullText();
  const hasGuard =
    /process\.env\.(?:MOCKS?_ENABLED|NODE_ENV|DEV_[A-Z0-9_]*|ENABLE_[A-Z0-9_]*|[A-Z0-9_]*_ENABLED)/.test(fullText) ||
    /\b(notFound|NextResponse\.json|Response\.json)\s*\([^)]*status\s*:\s*40[034]/s.test(fullText) ||
    /\b(assert|ensure|guard|require)[A-Za-z0-9_]*(?:Mock|Dev|Enabled)/.test(fullText);

  if (hasGuard) return [];

  return [
    finding(
      'mock-route-missing-env-guard',
      'warning',
      'bug',
      'Mock/dev API route has no obvious environment guard — test fixtures or proxy behavior may be reachable outside local/mock mode',
      ctx.filePath,
      1,
      1,
      {
        suggestion:
          'Gate mock/dev route handlers with an explicit env check and return 404/403 when mock mode is disabled.',
      },
    ),
  ];
}

// ── Rule: proxy-rewrite-env-path ────────────────────────────────────────
// Middleware rewrites assembled from env-controlled origins and request paths
// are easy to turn into open/internal proxies if the env target is broad.

function proxyRewriteEnvPath(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const findings: ReviewFinding[] = [];
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const method = callee.getName();
    if (method !== 'rewrite' && method !== 'redirect') continue;
    if (callee.getExpression().getText() !== 'NextResponse') continue;
    const argText = call.getArguments()[0]?.getText() ?? '';
    if (!/process\.env\.[A-Z0-9_]+/.test(argText)) continue;
    if (!/\brequest\.(?:nextUrl\.)?(?:pathname|url|search)\b|\bnextUrl\.(?:pathname|search)\b/.test(argText)) continue;

    findings.push(
      finding(
        'proxy-rewrite-env-path',
        'warning',
        'bug',
        `NextResponse.${method}() combines an environment-controlled target with request path/search data — review for open proxy, open redirect, or internal routing exposure`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Parse the env URL with URL, allowlist expected hosts, normalize the request pathname, and reject paths outside the intended proxy prefix.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: non-public-env-jsx-prop ───────────────────────────────────────
// Passing process.env values through JSX props is a common way to accidentally
// expose server-only config to Client Components.

function collectNonPublicEnvAccesses(node: Node): string[] {
  const names = new Set<string>();

  const propertyAccesses = node.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
  if (Node.isPropertyAccessExpression(node)) propertyAccesses.push(node);
  for (const access of propertyAccesses) {
    const left = access.getExpression();
    if (!Node.isPropertyAccessExpression(left) || left.getName() !== 'env') continue;
    const proc = left.getExpression();
    if (!Node.isIdentifier(proc) || proc.getText() !== 'process') continue;
    const name = access.getName();
    if (!isExemptEnvVarName(name)) names.add(name);
  }

  const elementAccesses = node.getDescendantsOfKind(SyntaxKind.ElementAccessExpression);
  if (Node.isElementAccessExpression(node)) elementAccesses.push(node);
  for (const access of elementAccesses) {
    const left = access.getExpression();
    if (!Node.isPropertyAccessExpression(left) || left.getName() !== 'env') continue;
    const proc = left.getExpression();
    if (!Node.isIdentifier(proc) || proc.getText() !== 'process') continue;
    const arg = access.getArgumentExpression();
    if (!arg || !Node.isStringLiteral(arg)) continue;
    const name = arg.getLiteralValue();
    if (!isExemptEnvVarName(name)) names.add(name);
  }

  return [...names];
}

function jsxAttributeTagName(attr: import('ts-morph').JsxAttribute): string | undefined {
  const parent = attr.getParent();
  if (!parent || (!Node.isJsxOpeningElement(parent) && !Node.isJsxSelfClosingElement(parent))) return undefined;
  const tagText = parent.getTagNameNode().getText();
  return tagText.split('.')[0];
}

function jsxTagResolvesToClientBoundary(ctx: RuleContext, tagName: string | undefined, fullText: string): boolean {
  if (isClientBoundary(ctx, fullText)) return true;
  if (!tagName || /^[a-z]/.test(tagName)) return false;

  const graphFile = ctx.config?.graphFileMap?.get(ctx.filePath);
  const fileContextMap = ctx.config?.fileContextMap;
  if (!graphFile || !fileContextMap) return false;

  for (const edge of graphFile.importEdges) {
    if (edge.localName !== tagName && edge.importedName !== tagName) continue;
    const importedContext =
      fileContextMap.get(edge.to) ?? [...fileContextMap.values()].find((ctx) => ctx.importChain.includes(edge.to));
    if (importedContext?.isClientBoundary || importedContext?.hasUseClientDirective) return true;
  }

  return false;
}

function nonPublicEnvJsxProp(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const fullText = ctx.sourceFile.getFullText();
  if (hasServerDirective(fullText)) return [];

  const findings: ReviewFinding[] = [];
  for (const attr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const init = attr.getInitializer();
    if (!init || !Node.isJsxExpression(init)) continue;
    const expr = init.getExpression();
    if (!expr) continue;
    const envNames = collectNonPublicEnvAccesses(expr);
    if (envNames.length === 0) continue;
    if (!jsxTagResolvesToClientBoundary(ctx, jsxAttributeTagName(attr), fullText)) continue;

    findings.push(
      finding(
        'non-public-env-jsx-prop',
        'warning',
        'bug',
        `Non-public env var${envNames.length === 1 ? '' : 's'} ${envNames.join(', ')} passed through JSX prop '${attr.getNameNode().getText()}' — this can expose server-only config to Client Components`,
        ctx.filePath,
        attr.getStartLineNumber(),
        1,
        {
          suggestion:
            'If the value is intentionally public, expose it with a NEXT_PUBLIC_* name or a reviewed public env contract. Otherwise keep it server-side.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: next-image-remote-wildcard ────────────────────────────────────
// next/image with hostname "*" accepts images from anywhere, weakening image
// optimization boundaries and making allowlist review ineffective.

function nextImageRemoteWildcard(ctx: RuleContext): ReviewFinding[] {
  if (!/(^|\/)next\.config\.[cm]?[jt]s$/.test(ctx.filePath)) return [];
  const fullText = ctx.sourceFile.getFullText();
  if (!/remotePatterns/.test(fullText)) return [];

  const findings: ReviewFinding[] = [];
  for (const prop of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const name = prop.getNameNode().getText().replace(/['"`]/g, '');
    if (name !== 'hostname') continue;
    const init = prop.getInitializer();
    if (!init || !Node.isStringLiteral(init)) continue;
    if (init.getLiteralValue() !== '*') continue;

    findings.push(
      finding(
        'next-image-remote-wildcard',
        'warning',
        'bug',
        'next/image remotePatterns allows hostname "*" — any remote image host is accepted',
        ctx.filePath,
        prop.getStartLineNumber(),
        1,
        {
          suggestion: 'Replace wildcard hostnames with the smallest set of trusted image/CDN host patterns.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: sensitive-route-public-cache ──────────────────────────────────
// Account/auth/cart/checkout/B2B endpoints should not receive public CDN cache
// headers unless there is a very explicit reviewed exception.

const SENSITIVE_CACHE_ROUTE_RE = /\/(?:api\/[^'"]*)?(?:auth|account|cart|checkout|b2b|orders?|payment|user|profile)\b/i;

function getObjectLiteralStringProperty(
  obj: import('ts-morph').ObjectLiteralExpression,
  propertyName: string,
): string | undefined {
  const prop = obj.getProperty(propertyName);
  if (!prop || !Node.isPropertyAssignment(prop)) return undefined;
  const init = prop.getInitializer();
  if (!init || (!Node.isStringLiteral(init) && !Node.isNoSubstitutionTemplateLiteral(init))) return undefined;
  return init.getLiteralText();
}

function objectHasPublicCacheControlHeader(obj: import('ts-morph').ObjectLiteralExpression): boolean {
  const headersProp = obj.getProperty('headers');
  if (!headersProp || !Node.isPropertyAssignment(headersProp)) return false;
  const headersInit = headersProp.getInitializer();
  if (!headersInit || !Node.isArrayLiteralExpression(headersInit)) return false;

  for (const element of headersInit.getElements()) {
    if (!Node.isObjectLiteralExpression(element)) continue;
    const key = getObjectLiteralStringProperty(element, 'key');
    if (!key || key.toLowerCase() !== 'cache-control') continue;
    const value = getObjectLiteralStringProperty(element, 'value') ?? '';
    if (/\b(?:public|s-maxage|stale-while-revalidate)\b/i.test(value)) return true;
  }

  return false;
}

function sensitiveRoutePublicCache(ctx: RuleContext): ReviewFinding[] {
  if (!/(^|\/)next\.config\.[cm]?[jt]s$/.test(ctx.filePath)) return [];

  const findings: ReviewFinding[] = [];
  for (const obj of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    const source = getObjectLiteralStringProperty(obj, 'source');
    if (!source) continue;
    if (!SENSITIVE_CACHE_ROUTE_RE.test(source)) continue;
    if (!objectHasPublicCacheControlHeader(obj)) continue;

    findings.push(
      finding(
        'sensitive-route-public-cache',
        'warning',
        'bug',
        `Sensitive route pattern '${source}' receives public/shared cache headers — auth, account, cart, checkout, B2B, and order data should not be CDN-public`,
        ctx.filePath,
        obj.getStartLineNumber(),
        1,
        {
          suggestion:
            'Use private/no-store for user-specific or privileged routes, or document and narrowly scope any intentional public cache exception.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: swr-mutation-missing-invalidation ─────────────────────────────
// useSWRMutation performs a mutation, but related query caches often need an
// explicit mutate()/populateCache/revalidate plan. This rule is intentionally
// heuristic and only checks same-file evidence.

function isSWRMutationCall(call: import('ts-morph').CallExpression): boolean {
  const callee = call.getExpression().getText();
  return callee === 'useSWRMutation' || callee.endsWith('.useSWRMutation');
}

function objectTextHasAnyProperty(node: Node | undefined, names: Set<string>): boolean {
  if (!node || !Node.isObjectLiteralExpression(node)) return false;
  return node.getProperties().some((prop) => {
    if (!Node.isPropertyAssignment(prop) && !Node.isShorthandPropertyAssignment(prop)) return false;
    const name = Node.isPropertyAssignment(prop) ? prop.getNameNode().getText().replace(/['"`]/g, '') : prop.getName();
    return names.has(name);
  });
}

function nearestFunctionScope(node: Node): Node {
  let current: Node | undefined = node;
  while (current) {
    if (
      Node.isFunctionDeclaration(current) ||
      Node.isFunctionExpression(current) ||
      Node.isArrowFunction(current) ||
      Node.isMethodDeclaration(current)
    )
      return current;
    current = current.getParent();
  }
  return node.getSourceFile();
}

function hasSWRMutationInvalidationEvidence(scope: Node): boolean {
  const swrMutationCalls = scope.getDescendantsOfKind(SyntaxKind.CallExpression).filter(isSWRMutationCall);
  if (swrMutationCalls.length !== 1) return false;

  return scope.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const callee = call.getExpression();
    return (
      (Node.isIdentifier(callee) && (callee.getText() === 'mutate' || callee.getText() === 'useSWRConfig')) ||
      (Node.isPropertyAccessExpression(callee) && callee.getName() === 'mutate')
    );
  });
}

function swrMutationMissingInvalidation(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  const fullText = ctx.sourceFile.getFullText();
  if (!/useSWRMutation/.test(fullText)) return [];

  const optionsKeys = new Set(['populateCache', 'revalidate', 'optimisticData', 'rollbackOnError', 'onSuccess']);
  const findings: ReviewFinding[] = [];
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isSWRMutationCall(call)) continue;
    if (objectTextHasAnyProperty(call.getArguments()[2], optionsKeys)) continue;
    if (hasSWRMutationInvalidationEvidence(nearestFunctionScope(call))) continue;
    findings.push(
      finding(
        'swr-mutation-missing-invalidation',
        'warning',
        'pattern',
        'useSWRMutation has no same-file cache invalidation/population plan — related SWR queries can stay stale after mutation',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Add mutate()/useSWRConfig(), or pass populateCache/revalidate/onSuccess options documenting how affected cache keys refresh.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: swr-cache-key-shape-drift ─────────────────────────────────────
// Same first SWR cache key used with incompatible tuple shapes in one file.
// This often makes mutate(predicate) imprecise and cache invalidation brittle.

const SWR_HOOK_NAMES = new Set(['useSWR', 'useSWRImmutable', 'useSWRMutation']);

function getSWRCallName(call: import('ts-morph').CallExpression): string | undefined {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee) && SWR_HOOK_NAMES.has(callee.getText())) return callee.getText();
  if (Node.isPropertyAccessExpression(callee) && SWR_HOOK_NAMES.has(callee.getName())) return callee.getName();
  return undefined;
}

function describeArrayElementShape(node: Node): string {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return 'string';
  if (Node.isNumericLiteral(node)) return 'number';
  if (Node.isObjectLiteralExpression(node)) return 'object';
  if (Node.isArrayLiteralExpression(node)) return 'array';
  if (Node.isIdentifier(node)) return `id:${node.getText()}`;
  if (Node.isPropertyAccessExpression(node)) return `prop:${node.getText()}`;
  return node.getKindName();
}

function swrCacheKeyShapeDrift(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const byFirstKey = new Map<string, Array<{ line: number; shape: string; text: string }>>();
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!getSWRCallName(call)) continue;
    const keyArg = call.getArguments()[0];
    if (!keyArg || !Node.isArrayLiteralExpression(keyArg)) continue;
    const elements = keyArg.getElements();
    if (elements.length === 0) continue;
    const firstKey = elements[0].getText();
    const shape = elements.map(describeArrayElementShape).join('|');
    const entries = byFirstKey.get(firstKey) ?? [];
    entries.push({ line: keyArg.getStartLineNumber(), shape, text: keyArg.getText() });
    byFirstKey.set(firstKey, entries);
  }

  const findings: ReviewFinding[] = [];
  for (const [firstKey, entries] of byFirstKey) {
    const uniqueShapes = new Set(entries.map((entry) => entry.shape));
    if (uniqueShapes.size <= 1) continue;
    const first = entries[0];
    findings.push(
      finding(
        'swr-cache-key-shape-drift',
        'warning',
        'bug',
        `SWR cache key ${firstKey} is used with ${uniqueShapes.size} tuple shapes in one file — invalidation predicates can miss or over-match entries`,
        ctx.filePath,
        first.line,
        1,
        {
          suggestion:
            'Normalize this cache key to one tuple contract, or split distinct cache domains into separate first-key constants.',
          relatedSpans: entries.slice(1, 4).map((entry) => span(ctx.filePath, entry.line)),
        },
      ),
    );
  }

  return findings;
}

// ── Rule: session-local-storage-outside-helper ──────────────────────────
// Auth/session values in localStorage should go through centralized helpers
// so expiry, migration, and cleanup behavior stays consistent.

const SENSITIVE_STORAGE_KEY_RE =
  /(^|[_:.-])(?:access[_:.-]?token|refresh[_:.-]?token|id[_:.-]?token|auth(?:[_:.-]?state)?|session(?:[_:.-]?(?:id|token))?|jwt|bearer|login[_:.-]?token|customer[_:.-]?(?:id|token)|cart[_:.-]?id)($|[_:.-])/i;

function isSessionStorageHelperPath(filePath: string): boolean {
  return /\/(?:auth|session|storage|local-storage|localstorage|cookies?)\//i.test(filePath);
}

function getLiteralLikeText(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralText();
  return node.getText();
}

function sessionLocalStorageOutsideHelper(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  if (isSessionStorageHelperPath(ctx.filePath)) return [];

  const findings: ReviewFinding[] = [];
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (callee.getName() !== 'setItem' && callee.getName() !== 'removeItem') continue;
    const receiver = callee.getExpression().getText();
    if (
      receiver !== 'localStorage' &&
      receiver !== 'window.localStorage' &&
      receiver !== 'sessionStorage' &&
      receiver !== 'window.sessionStorage'
    )
      continue;
    const keyText = getLiteralLikeText(call.getArguments()[0]);
    if (!keyText || !SENSITIVE_STORAGE_KEY_RE.test(keyText)) continue;

    findings.push(
      finding(
        'session-local-storage-outside-helper',
        'warning',
        'bug',
        `Sensitive localStorage key '${keyText}' is written outside a session/storage helper — auth state cleanup and expiry can drift`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Route auth/session localStorage writes through the shared session/storage helper so login, logout, expiry, and migrations stay coherent.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: env-var-leak-to-client ─────────────────────────────────────────
//
// In Next.js, env vars referenced in Client Components must be prefixed with
// `NEXT_PUBLIC_` to be inlined at build time. A `process.env.SECRET_KEY`
// reference in a `'use client'` file produces `undefined` at runtime in the
// browser AND, worse, signals confusion about what's actually exposed.
//
// Detection: PropertyAccessExpression of shape `process.env.<NAME>`,
// element-access `process.env['NAME']`, or destructuring `const { X } = process.env`,
// in a client-boundary file, where <NAME> does not start with `NEXT_PUBLIC_`
// and isn't on the framework-public allowlist.
//
// FP avoidance:
//   - Skip 'use server' files entirely (server actions/functions reference
//     process.env legitimately — file-context propagation could otherwise
//     mark them as client-bound).
//   - Allowlist `NODE_ENV` and known Vercel-public env vars — Next/Vercel
//     bundlers inline these for the browser bundle.
//   - Skip references inside a `typeof process.env.X` guard.
//   - Skip references inside a `typeof window === 'undefined'` SSR-only branch.

const PUBLIC_ENV_PREFIX = 'NEXT_PUBLIC_';
/** Env vars Next.js / Vercel inline into the client bundle without the
 *  NEXT_PUBLIC_ prefix. Flagging these would generate massive false-positive
 *  noise in any real Next.js codebase. */
const KNOWN_PUBLIC_ENV_VARS = new Set(['NODE_ENV', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_REGION']);

function isInTypeofExpression(node: Node): boolean {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (Node.isTypeOfExpression(cur)) return true;
    if (Node.isFunctionLikeDeclaration(cur)) return false;
    cur = cur.getParent();
  }
  return false;
}

/** True when `node` is inside the consequent of a `typeof window === 'undefined'`
 *  branch (or the alternate of `typeof window !== 'undefined'`). Such branches
 *  never execute on the client and so referencing server-only env there is OK. */
function isInsideSsrOnlyBranch(node: Node): boolean {
  let cur: Node | undefined = node;
  while (cur) {
    const parent: Node | undefined = cur.getParent();
    if (!parent) break;
    if (Node.isIfStatement(parent)) {
      const condition = parent.getExpression();
      const thenBranch = parent.getThenStatement();
      const elseBranch = parent.getElseStatement();
      const guard = readTypeofWindowGuard(condition);
      if (guard) {
        const inThen = thenBranch && cur === thenBranch;
        const inElse = elseBranch && cur === elseBranch;
        if (guard === 'undefined' && inThen) return true;
        if (guard === 'defined' && inElse) return true;
      }
    }
    if (Node.isConditionalExpression(parent)) {
      const condition = parent.getCondition();
      const guard = readTypeofWindowGuard(condition);
      if (guard) {
        const inWhenTrue = cur === parent.getWhenTrue();
        const inWhenFalse = cur === parent.getWhenFalse();
        if (guard === 'undefined' && inWhenTrue) return true;
        if (guard === 'defined' && inWhenFalse) return true;
      }
    }
    if (Node.isFunctionLikeDeclaration(parent) || Node.isSourceFile(parent)) break;
    cur = parent;
  }
  return false;
}

/** Recognises `typeof window === 'undefined'` / `!==` / `!=`, returning the
 *  effective state of `window` inside the truthy branch. */
function readTypeofWindowGuard(node: Node | undefined): 'undefined' | 'defined' | undefined {
  if (!node) return undefined;
  if (!Node.isBinaryExpression(node)) return undefined;
  const op = node.getOperatorToken().getText();
  if (op !== '===' && op !== '==' && op !== '!==' && op !== '!=') return undefined;
  const left = node.getLeft();
  const right = node.getRight();
  const isTypeofWindow = (n: Node) =>
    Node.isTypeOfExpression(n) && Node.isIdentifier(n.getExpression()) && n.getExpression().getText() === 'window';
  const isUndefStr = (n: Node) => Node.isStringLiteral(n) && n.getLiteralValue() === 'undefined';
  if (!((isTypeofWindow(left) && isUndefStr(right)) || (isUndefStr(left) && isTypeofWindow(right)))) return undefined;
  const eq = op === '===' || op === '==';
  return eq ? 'undefined' : 'defined';
}

function isExemptEnvVarName(name: string): boolean {
  return name.startsWith(PUBLIC_ENV_PREFIX) || KNOWN_PUBLIC_ENV_VARS.has(name);
}

function envVarLeakToClient(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  const fullText = ctx.sourceFile.getFullText();
  // Server actions/functions legitimately reference process.env — never flag them
  // even if file-context propagation marks the file as client-bound.
  if (hasServerDirective(fullText)) return [];
  if (!isClientBoundary(ctx, fullText)) return [];

  const findings: ReviewFinding[] = [];

  for (const access of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    // Match `process.env.<NAME>`
    const left = access.getExpression();
    if (!Node.isPropertyAccessExpression(left)) continue;
    if (left.getName() !== 'env') continue;
    const procIdent = left.getExpression();
    if (!Node.isIdentifier(procIdent) || procIdent.getText() !== 'process') continue;

    const name = access.getName();
    if (isExemptEnvVarName(name)) continue;
    if (isInTypeofExpression(access)) continue;
    if (isInsideSsrOnlyBranch(access)) continue;

    findings.push(
      finding(
        'env-var-leak-to-client',
        'error',
        'bug',
        `'process.env.${name}' is referenced in a Client Component — server-only env vars are not bundled to the browser; only NEXT_PUBLIC_* vars are inlined`,
        ctx.filePath,
        access.getStartLineNumber(),
        1,
        {
          suggestion: `If '${name}' is intentionally public, rename it to NEXT_PUBLIC_${name}. Otherwise, read it on the server and pass the result through props or a server action.`,
        },
      ),
    );
  }

  // Also catch element-access form: `process.env['SECRET']`
  for (const access of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    const left = access.getExpression();
    if (!Node.isPropertyAccessExpression(left)) continue;
    if (left.getName() !== 'env') continue;
    const procIdent = left.getExpression();
    if (!Node.isIdentifier(procIdent) || procIdent.getText() !== 'process') continue;

    const arg = access.getArgumentExpression();
    if (!arg || !Node.isStringLiteral(arg)) continue;
    const name = arg.getLiteralValue();
    if (isExemptEnvVarName(name)) continue;
    if (isInTypeofExpression(access)) continue;
    if (isInsideSsrOnlyBranch(access)) continue;

    findings.push(
      finding(
        'env-var-leak-to-client',
        'error',
        'bug',
        `'process.env[${JSON.stringify(name)}]' is referenced in a Client Component — server-only env vars are not bundled to the browser; only NEXT_PUBLIC_* vars are inlined`,
        ctx.filePath,
        access.getStartLineNumber(),
        1,
        {
          suggestion: `If '${name}' is intentionally public, rename it to NEXT_PUBLIC_${name}. Otherwise, read it on the server and pass the result through props or a server action.`,
        },
      ),
    );
  }

  // Destructuring form: `const { SECRET } = process.env;`
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init || !Node.isPropertyAccessExpression(init)) continue;
    if (init.getName() !== 'env') continue;
    const procIdent = init.getExpression();
    if (!Node.isIdentifier(procIdent) || procIdent.getText() !== 'process') continue;
    const nameNode = decl.getNameNode();
    if (!Node.isObjectBindingPattern(nameNode)) continue;
    if (isInsideSsrOnlyBranch(decl)) continue;

    for (const element of nameNode.getElements()) {
      // The destructured key — `propertyNameNode` is set when the user renames
      // (`{ SECRET: s }`); otherwise it's the binding name.
      const keyNode = element.getPropertyNameNode() ?? element.getNameNode();
      if (!Node.isIdentifier(keyNode)) continue;
      const name = keyNode.getText();
      if (isExemptEnvVarName(name)) continue;
      findings.push(
        finding(
          'env-var-leak-to-client',
          'error',
          'bug',
          `'${name}' is destructured from process.env in a Client Component — server-only env vars are not bundled to the browser`,
          ctx.filePath,
          element.getStartLineNumber(),
          1,
          {
            suggestion: `If '${name}' is intentionally public, rename it to NEXT_PUBLIC_${name}. Otherwise, read it on the server and pass the result through props or a server action.`,
          },
        ),
      );
    }
  }

  return findings;
}

// ── Exported App Router Rules ────────────────────────────────────────────

export const nextjsAppRouterRules = [
  useClientDrilledTooHigh,
  serverApiInClient,
  browserApiInServer,
  useActionStateMissingPending,
  useActionStateMissingFeedback,
  serverActionFormMissingPending,
  serverActionFormReturnValueIgnored,
  serverActionFormMutationMissingInvalidation,
  serverActionUnvalidatedInput,
  routeHandlerJsonTypeAssertion,
  routeHandlerJsonUnguarded,
  routeHandlerJsonContentTypeMissing,
  routeHandlerCatchStatusUndefined,
  forwardedClientHeader,
  middlewareClonedRequestHeaders,
  mockRouteMissingEnvGuard,
  proxyRewriteEnvPath,
  nonPublicEnvJsxProp,
  nextImageRemoteWildcard,
  sensitiveRoutePublicCache,
  swrMutationMissingInvalidation,
  swrCacheKeyShapeDrift,
  sessionLocalStorageOutsideHelper,
  envVarLeakToClient,
];
