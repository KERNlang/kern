import { Node, SyntaxKind } from 'ts-morph';
import { STATUS_LIKELY_RECEIVER_RE, STATUS_PROP_RE } from '../signatures.js';
import {
  enclosingVariableDeclaration,
  escapeRegExp,
  nearestBlock,
  nearestFunctionLike,
  nodeContains,
  numericLiteralValue,
} from './ast.js';

export function extractHandlesApiErrors(
  call: import('ts-morph').CallExpression,
  isWrappedClientCall: boolean,
): boolean | undefined {
  if (isWrappedClientCall) return undefined;
  if (isInsideTryWithCatch(call)) return true;
  if (hasCatchInPromiseChain(call)) return true;
  if (hasInlineStatusCheck(call)) return true;
  if (hasAssignedResponseStatusCheck(call)) return true;
  if (isPassedToApiResponseHelper(call)) return true;
  if (hasNearbyErrorUiPath(call)) return true;
  return false;
}

function isInsideTryWithCatch(node: import('ts-morph').Node): boolean {
  let parent = node.getParent();
  while (parent) {
    if (parent.getKind() === SyntaxKind.TryStatement) {
      const tryStmt = parent as import('ts-morph').TryStatement;
      return Boolean(tryStmt.getCatchClause());
    }
    parent = parent.getParent();
  }
  return false;
}

function hasCatchInPromiseChain(node: import('ts-morph').Node): boolean {
  let cursor: import('ts-morph').Node = node;
  for (let depth = 0; depth < 8; depth++) {
    const parent = cursor.getParent();
    if (!parent) return false;
    if (parent.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = parent as import('ts-morph').PropertyAccessExpression;
      if (pa.getName() === 'catch') return true;
    }
    cursor = parent;
  }
  return false;
}

function hasInlineStatusCheck(call: import('ts-morph').CallExpression): boolean {
  let cursor: import('ts-morph').Node = call;
  for (let depth = 0; depth < 8; depth++) {
    const parent = cursor.getParent();
    if (!parent) return false;
    const text = parent.getText();
    if (
      /\b\w+\.(ok|status|statusCode)\b/.test(text) &&
      /\b(if|throw|reject|setError|toast\.error|Alert\.alert)\b/.test(text)
    ) {
      return true;
    }
    if (parent.getKind() === SyntaxKind.ExpressionStatement || parent.getKind() === SyntaxKind.VariableDeclaration) {
      return false;
    }
    cursor = parent;
  }
  return false;
}

function hasAssignedResponseStatusCheck(call: import('ts-morph').CallExpression): boolean {
  const decl = enclosingVariableDeclaration(call);
  if (!decl) return false;
  const name = decl.getName();
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return false;
  const block = nearestBlock(decl);
  if (!block) return false;
  const escaped = escapeRegExp(name);
  const text = block.getText();
  return new RegExp(`\\b${escaped}\\.(ok|status|statusCode)\\b`).test(text);
}

function isPassedToApiResponseHelper(call: import('ts-morph').CallExpression): boolean {
  let cursor: import('ts-morph').Node = call;
  for (let depth = 0; depth < 4; depth++) {
    const parent = cursor.getParent();
    if (!parent) return false;
    const kind = parent.getKind();
    if (kind === SyntaxKind.AwaitExpression || kind === SyntaxKind.ParenthesizedExpression) {
      cursor = parent;
      continue;
    }
    if (kind !== SyntaxKind.CallExpression) return false;
    const helperName = (parent as import('ts-morph').CallExpression).getExpression().getText();
    return /^(parse|handle|check|ensure|assert|unwrap)[A-Za-z0-9_$]*(Api|Response|Result)$/i.test(helperName);
  }
  return false;
}

function hasNearbyErrorUiPath(call: import('ts-morph').CallExpression): boolean {
  const container = nearestFunctionLike(call);
  if (!container) return false;
  const text = container.getText();
  return /\b(setError|setErrorMessage|showError|toast\.error|Alert\.alert|notifyError)\s*\(/.test(text);
}

/**
 * Given a network call (fetch/axios/…), decide whether the eventual JSON
 * payload is consumed with a type annotation, `as T` cast, or `satisfies T`
 * clause. Returns:
 *   - `true` — the call-site is typed; the consumer enforces a shape.
 *   - `false` — the call-site is awaited/.then()'d but no assertion appears.
 *   - `undefined` — no `.json()` consumption in scope, or the pattern is
 *     too complex to analyze.
 *
 * Powers the `untyped-api-response` cross-stack rule (the frontend treats
 * the server's declared response shape as `any`). Kept intentionally
 * conservative — false positives here poison the pitch.
 */
export function isResponseAsserted(
  call: import('ts-morph').CallExpression,
  isWrappedClientCall = false,
): boolean | undefined {
  // Generic type argument on the call itself, e.g. `apiClient.get<User>(url)`.
  if (call.getTypeArguments().length > 0) return true;

  let cursor: import('ts-morph').Node = call;
  let sawJsonConsumption = isWrappedClientCall;
  for (let depth = 0; depth < 8; depth++) {
    const parent = cursor.getParent();
    if (!parent) return undefined;

    if (parent.getKind() === SyntaxKind.AwaitExpression || parent.getKind() === SyntaxKind.ParenthesizedExpression) {
      cursor = parent;
      continue;
    }

    if (parent.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = parent as import('ts-morph').PropertyAccessExpression;
      const parentCall = pa.getParent();
      if (pa.getName() === 'then' && parentCall?.getKind() === SyntaxKind.CallExpression) {
        if (callbackCallsJson(parentCall as import('ts-morph').CallExpression)) {
          sawJsonConsumption = true;
        }
        cursor = parentCall;
        continue;
      }
      if (pa.getName() === 'json' && parentCall?.getKind() === SyntaxKind.CallExpression) {
        sawJsonConsumption = true;
        cursor = parentCall;
        continue;
      }
      return undefined;
    }

    if (!sawJsonConsumption) return undefined;

    if (parent.getKind() === SyntaxKind.VariableDeclaration) {
      const decl = parent as import('ts-morph').VariableDeclaration;
      if (decl.getTypeNode()) return true;
      return containsAssertion(decl.getInitializer());
    }

    if (
      parent.getKind() === SyntaxKind.ReturnStatement ||
      parent.getKind() === SyntaxKind.ArrowFunction ||
      parent.getKind() === SyntaxKind.BinaryExpression
    ) {
      return containsAssertion(cursor);
    }

    if (
      parent.getKind() === SyntaxKind.AsExpression ||
      parent.getKind() === SyntaxKind.TypeAssertionExpression ||
      parent.getKind() === SyntaxKind.SatisfiesExpression
    ) {
      return true;
    }

    return undefined;
  }
  return undefined;
}

function callbackCallsJson(thenCall: import('ts-morph').CallExpression): boolean {
  const callback = thenCall.getArguments()[0];
  if (!callback) return false;
  const k = callback.getKind();
  if (k !== SyntaxKind.ArrowFunction && k !== SyntaxKind.FunctionExpression) return false;
  const callbackText = callback.getText();
  return /\.json\s*\(\s*\)/.test(callbackText);
}

function containsAssertion(node: import('ts-morph').Node | undefined): boolean {
  if (!node) return false;
  const k = node.getKind();
  if (
    k === SyntaxKind.AsExpression ||
    k === SyntaxKind.TypeAssertionExpression ||
    k === SyntaxKind.SatisfiesExpression
  ) {
    return true;
  }
  if (k === SyntaxKind.AwaitExpression || k === SyntaxKind.ParenthesizedExpression) {
    const child = (
      node as import('ts-morph').AwaitExpression | import('ts-morph').ParenthesizedExpression
    ).getExpression();
    return containsAssertion(child);
  }
  return false;
}

export function extractHandledErrorStatusCodes(call: import('ts-morph').CallExpression): readonly number[] | undefined {
  // P2-B: `.then((res) => { if (res.status === N) ... })` — the response is
  // the callback's first parameter, and the scope must be the callback body
  // (NOT the enclosing function), otherwise sibling `.then()` callbacks could
  // cross-bind on the same param name. When matched, scope and varName both
  // come from the callback.
  const thenBinding = findThenCallbackBinding(call);

  const enclosing =
    thenBinding?.scope ??
    call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ??
    call.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ??
    call.getFirstAncestorByKind(SyntaxKind.FunctionExpression) ??
    call.getFirstAncestorByKind(SyntaxKind.MethodDeclaration);
  if (!enclosing) return undefined;

  const responseVarName = thenBinding?.varName ?? findResponseVarForCall(call);
  const matchesBoundReceiver = (statusNode: import('ts-morph').Node, receiverText: string): boolean => {
    if (!responseVarName) return true;
    if (new RegExp(`\\b${responseVarName}\\b`).test(receiverText)) return true;
    return isInsideCatchOfTryContaining(statusNode, call);
  };

  const codes = new Set<number>();

  for (const bin of enclosing.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const op = bin.getOperatorToken().getText();
    if (op !== '===' && op !== '==') continue;
    const left = bin.getLeft();
    const right = bin.getRight();
    const code = numericLiteralValue(left) ?? numericLiteralValue(right);
    if (code === undefined) continue;
    const other = code === numericLiteralValue(left) ? right : left;
    if (!isStatusPropertyAccess(other)) continue;
    if (!matchesBoundReceiver(bin, other.getText())) continue;
    codes.add(code);
  }

  for (const sw of enclosing.getDescendantsOfKind(SyntaxKind.SwitchStatement)) {
    const expr = sw.getExpression();
    if (!isStatusPropertyAccess(expr)) continue;
    if (!expr || !matchesBoundReceiver(sw, expr.getText())) continue;
    for (const caseClause of sw.getDescendantsOfKind(SyntaxKind.CaseClause)) {
      const code = numericLiteralValue(caseClause.getExpression());
      if (code !== undefined) codes.add(code);
    }
  }

  return Array.from(codes).sort((a, b) => a - b);
}

function isInsideCatchOfTryContaining(node: import('ts-morph').Node, call: import('ts-morph').CallExpression): boolean {
  let cur: import('ts-morph').Node | undefined = node;
  while (cur) {
    if (Node.isCatchClause(cur)) {
      const tryStmt = cur.getParent();
      if (Node.isTryStatement(tryStmt)) {
        const tryBlock = tryStmt.getTryBlock();
        if (tryBlock && nodeContains(tryBlock, call)) return true;
      }
    }
    cur = cur.getParent();
  }
  return false;
}

function findThenCallbackBinding(
  call: import('ts-morph').CallExpression,
): { varName: string; scope: import('ts-morph').Node } | undefined {
  const parent = call.getParent();
  if (!parent || !Node.isPropertyAccessExpression(parent)) return undefined;
  if (parent.getName() !== 'then') return undefined;
  const grand = parent.getParent();
  if (!grand || !Node.isCallExpression(grand)) return undefined;
  const cb = grand.getArguments()[0];
  if (!cb) return undefined;
  if (!Node.isArrowFunction(cb) && !Node.isFunctionExpression(cb)) return undefined;
  const param = cb.getParameters()[0];
  if (!param) return undefined;
  const nameNode = param.getNameNode();
  if (!Node.isIdentifier(nameNode)) return undefined;
  return { varName: nameNode.getText(), scope: cb };
}

function findResponseVarForCall(call: import('ts-morph').CallExpression): string | undefined {
  let cur: import('ts-morph').Node = call;
  let parent: import('ts-morph').Node | undefined = cur.getParent();
  while (
    parent &&
    (Node.isAwaitExpression(parent) || Node.isParenthesizedExpression(parent) || Node.isAsExpression(parent))
  ) {
    cur = parent;
    parent = cur.getParent();
  }
  if (parent && Node.isVariableDeclaration(parent)) {
    const name = parent.getNameNode();
    if (Node.isIdentifier(name)) return name.getText();
  }
  return undefined;
}

function isStatusPropertyAccess(node: import('ts-morph').Node | undefined): boolean {
  if (!node) return false;
  const text = node.getText();
  if (!STATUS_PROP_RE.test(text.replace(/\?\./g, '.'))) return false;
  return STATUS_LIKELY_RECEIVER_RE.test(text);
}
