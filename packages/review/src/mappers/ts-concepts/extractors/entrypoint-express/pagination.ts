import { Node, SyntaxKind } from 'ts-morph';
import { classifyPaginationAnchor } from '../../../../concept-rules/cross-stack-utils.js';
import { DB_COLLECTION_READ_CALLS, DB_WRITE_CALLS, PAGINATION_RE } from '../../signatures.js';
import type { ExpressRouteHandlerFn } from './route-handler.js';

// ── Express pagination-strategy extraction ───────────────────────────────
// Walks for `req.query.X` / `req.query['X']` / destructuring `const {a, b} =
// req.query`, classifies each key against anchor sets, and returns the strategy.
// Size keys (`limit`, `take`, `pageSize`, `perPage`) are pagination *parameters*
// but not anchor families on their own — a server reading only `limit` is
// classified as `'none'` (it doesn't pin a strategy).
//
// Anchor sets are imported from `concept-rules/cross-stack-utils` so the
// server-side classification stays in lockstep with the client-side one used
// by `pagination-key-drift`.
function classifyAnchor(key: string): 'page' | 'offset' | 'cursor' | undefined {
  return classifyPaginationAnchor(key);
}

export function extractExpressPaginationStrategy(handlerFn: ExpressRouteHandlerFn): {
  strategy: 'page' | 'offset' | 'cursor' | 'mixed' | 'none' | undefined;
  resolved: boolean;
} {
  const families = new Set<'page' | 'offset' | 'cursor'>();
  let sawDynamicAccess = false;

  // Pattern 1: `req.query.X` / `req.query[<lit>]` / destructuring
  for (const access of handlerFn.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (access.getName() !== 'query') continue;
    const reqIdent = access.getExpression();
    if (!/\b(req|request)\b/i.test(reqIdent.getText())) continue;
    const parent = access.getParent();

    // Form 1: `req.query.X` — direct dotted read
    if (parent && Node.isPropertyAccessExpression(parent) && parent.getExpression() === access) {
      const family = classifyAnchor(parent.getName());
      if (family) families.add(family);
      continue;
    }

    // Form 2: `req.query['X']` — element access with literal
    if (parent && Node.isElementAccessExpression(parent) && parent.getExpression() === access) {
      const arg = parent.getArgumentExpression();
      if (arg && Node.isStringLiteral(arg)) {
        const family = classifyAnchor(arg.getLiteralValue());
        if (family) families.add(family);
      } else {
        sawDynamicAccess = true;
      }
      continue;
    }

    // Form 3: `const { page, limit } = req.query` — destructuring
    if (parent && Node.isVariableDeclaration(parent) && parent.getInitializer() === access) {
      const nameNode = parent.getNameNode();
      if (Node.isObjectBindingPattern(nameNode)) {
        for (const elem of nameNode.getElements()) {
          if (elem.getDotDotDotToken()) {
            sawDynamicAccess = true;
            continue;
          }
          const keyNode = elem.getPropertyNameNode() ?? elem.getNameNode();
          if (Node.isIdentifier(keyNode)) {
            const family = classifyAnchor(keyNode.getText());
            if (family) families.add(family);
          } else if (Node.isStringLiteral(keyNode)) {
            const family = classifyAnchor(keyNode.getLiteralValue());
            if (family) families.add(family);
          }
        }
        continue;
      }
      sawDynamicAccess = true;
      continue;
    }

    sawDynamicAccess = true;
  }

  if (sawDynamicAccess) {
    return { strategy: undefined, resolved: false };
  }

  if (families.size === 0) {
    return { strategy: 'none', resolved: true };
  }

  if (families.size > 1) return { strategy: 'mixed', resolved: true };
  const only = families.values().next().value as 'page' | 'offset' | 'cursor';
  return { strategy: only, resolved: true };
}

export function hasUnboundedExpressCollectionQuery(
  handlerFn: ExpressRouteHandlerFn,
  method: string,
  routePath: string | undefined,
): boolean {
  if (method !== 'GET') return false;
  if (routePath && /[:{]/.test(routePath)) return false;
  const text = handlerFn.getText();
  if (PAGINATION_RE.test(text) || /\b(req|request)\.query\b/.test(text)) return false;
  if (!handlerHasDbCollectionRead(handlerFn)) return false;
  if (!/\.json\s*\(|send\s*\(/.test(text)) return false;

  const lastSegment = routePath?.split('/').filter(Boolean).pop();
  return Boolean(lastSegment?.endsWith('s')) || /\bfindMany\b|\.find\s*\(|\.toArray\s*\(/.test(text);
}

function handlerHasDbCollectionRead(handlerFn: ExpressRouteHandlerFn): boolean {
  return handlerFn.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (!DB_COLLECTION_READ_CALLS.has(pa.getName())) return false;
    return isDbLikeReceiver(pa.getExpression().getText());
  });
}

export function handlerHasDbWrite(handlerFn: ExpressRouteHandlerFn): boolean {
  return handlerFn.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (!DB_WRITE_CALLS.has(pa.getName())) return false;
    return isDbLikeReceiver(pa.getExpression().getText());
  });
}

function isDbLikeReceiver(receiver: string): boolean {
  return (
    /\b(db|prisma|mongo|collection|repo|repository|model|client|knex|sequelize|typeorm|pool)\b/i.test(receiver) ||
    /^[A-Z][A-Za-z0-9_]*(Model)?$/.test(receiver)
  );
}
