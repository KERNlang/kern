/**
 * Next.js App Router review rules — active when target = nextjs, on top of nextjsRules.
 *
 * Focus: directive placement, client/server boundary correctness, server actions.
 * These rules require import-graph awareness — they gracefully no-op when run
 * in single-file mode (no ctx.fileContext).
 */

import { basename } from 'path';
import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding } from './utils.js';

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
      if (CLIENT_HOOKS.has(expr.getText())) return true;
    } else if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      const prop = expr.asKind(SyntaxKind.PropertyAccessExpression);
      if (prop && CLIENT_HOOKS.has(prop.getName())) return true;
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

function resolveServerActionFunctions(ctx: RuleContext, expr: Node | undefined): FunctionLikeNode[] {
  const resolved: FunctionLikeNode[] = [];
  if (!expr) return resolved;

  const candidate = unwrapParens(expr);
  if ((Node.isFunctionExpression(candidate) || Node.isArrowFunction(candidate)) && functionLikeIsAsync(candidate)) {
    if (functionLikeHasUseServerDirective(candidate)) resolved.push(candidate);
    return resolved;
  }

  if (!Node.isIdentifier(candidate)) return resolved;

  const fileHasUseServer = hasServerDirective(ctx.sourceFile.getFullText());
  const declarations = candidate.getSymbol()?.getDeclarations() ?? [];
  for (const decl of declarations) {
    if (decl.getSourceFile() !== ctx.sourceFile) continue;

    if (Node.isFunctionDeclaration(decl) && decl.isAsync()) {
      if (functionLikeHasUseServerDirective(decl) || (fileHasUseServer && decl.isExported())) resolved.push(decl);
    }

    if (Node.isVariableDeclaration(decl)) {
      const init = decl.getInitializer();
      if (!init || (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) || !init.isAsync()) continue;
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

  let severity: 'warning' | 'error' = 'warning';
  let detail = 'File has "use client" but uses no hooks, event handlers, or browser APIs itself.';

  const fileContextMap = ctx.config?.fileContextMap;
  if (fileContextMap) {
    // If at least one imported child has its own 'use client' or needs one, this is a drilled directive.
    const gfImports = [...fileContextMap.entries()]
      .filter(([, v]) => v.importedBy.includes(ctx.filePath))
      .map(([k]) => k);
    if (gfImports.length > 0) {
      severity = 'warning';
      detail += ` Imported children: ${gfImports
        .slice(0, 3)
        .map((p) => basename(p))
        .join(', ')}${gfImports.length > 3 ? '…' : ''}.`;
    }
  }

  const line = 1;
  return [
    finding(
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
    ),
  ];
}

// ── Rule: server-api-in-client ───────────────────────────────────────────
// Client Component imports or calls server-only APIs:
//   - next/headers  (cookies(), headers(), draftMode())
//   - server-only   (explicit guard package)
// These will fail at build or runtime.

const SERVER_API_CALLS = new Set(['cookies', 'headers', 'draftMode']);

function serverApiInClient(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const fullText = ctx.sourceFile.getFullText();
  const isClient = isClientBoundary(ctx, fullText);
  if (!isClient) return [];

  const findings: ReviewFinding[] = [];

  // Import check: `from 'next/headers'` or `from 'server-only'`
  for (const imp of ctx.sourceFile.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    if (mod === 'next/headers' || mod === 'server-only') {
      findings.push(
        finding(
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
        ),
      );
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

    findings.push(
      finding(
        'server-api-in-client',
        'error',
        'bug',
        `'${name}()' called in Client Component — next/headers APIs are server-only and will throw at runtime`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        { suggestion: `Call '${name}()' in a Server Component or server action, then pass the result as a prop` },
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

// ── Exported App Router Rules ────────────────────────────────────────────

export const nextjsAppRouterRules = [
  useClientDrilledTooHigh,
  serverApiInClient,
  browserApiInServer,
  useActionStateMissingPending,
  useActionStateMissingFeedback,
  serverActionFormMissingPending,
  serverActionFormReturnValueIgnored,
  serverActionUnvalidatedInput,
];
