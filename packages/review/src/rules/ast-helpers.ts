/**
 * Shared AST traversal & resolution primitives for review rules.
 *
 * Distinct from rules/utils.ts (which holds review-output helpers like
 * `finding`, `span`, plus boundary/cleanup-expression helpers): this file
 * is exclusively for AST-level walking, unwrapping, and static-value
 * resolution. Anything a rule needs to *understand* the source tree
 * before deciding to fire belongs here.
 *
 * Helpers are intentionally narrow — adding generalization (e.g., a
 * configurable env-var name to `isInNonProductionBranch`) is deferred
 * until a second caller needs it.
 */

import { Node, SyntaxKind } from 'ts-morph';

/**
 * Unwraps a fluent method chain back to the leftmost receiver node.
 *
 * `res.status(500).json(...)` → the `res` Identifier.
 * `db.collection('x').find(...)` → the `db` Identifier.
 * `(getDb()).collection('x').find(...)` → the `(getDb())` ParenthesizedExpression
 * (the chain stops as soon as the callee isn't a PropertyAccessExpression).
 *
 * Returns the original node when it isn't a CallExpression chain. Callers
 * that need the receiver's text should call `.getText()` on the result —
 * returning the Node (rather than a pre-stringified value) keeps the door
 * open to type-checking the receiver in future rules.
 */
export function unwrapMethodChainToReceiver(node: Node): Node {
  let cur: Node = node;
  while (Node.isCallExpression(cur)) {
    const innerCallee = cur.getExpression();
    if (!Node.isPropertyAccessExpression(innerCallee)) break;
    cur = innerCallee.getExpression();
  }
  return cur;
}

/**
 * Resolve the static string value of an expression when every subterm is
 * literal. Returns `undefined` when any part is non-literal — defers to
 * the documented FN class rather than heuristically guessing.
 *
 * Handles:
 *   - StringLiteral, NoSubstitutionTemplateLiteral
 *   - TemplateExpression with all-literal spans
 *   - BinaryExpression (`+` only) with both sides literal-resolvable
 *
 * Reusable for: bearer-token-literal, cors-wildcard origin classification,
 * hardcoded-secrets, jwt-secret detection, future api-key-literal rules.
 */
export function resolveLiteralStringValue(node: Node): string | undefined {
  if (Node.isParenthesizedExpression(node)) {
    return resolveLiteralStringValue(node.getExpression());
  }
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }
  if (Node.isTemplateExpression(node)) {
    let s = node.getHead().getLiteralText();
    for (const span of node.getTemplateSpans()) {
      const sub = resolveLiteralStringValue(span.getExpression());
      if (sub === undefined) return undefined;
      s += sub;
      s += span.getLiteral().getLiteralText();
    }
    return s;
  }
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
    const left = resolveLiteralStringValue(node.getLeft());
    if (left === undefined) return undefined;
    const right = resolveLiteralStringValue(node.getRight());
    if (right === undefined) return undefined;
    return left + right;
  }
  return undefined;
}

/**
 * Returns true if `node` sits inside an `if` branch that ensures
 * `process.env.NODE_ENV` is not `'production'`. Polarity-aware: handles
 * both `if (env === 'production') { … } else { dev }` and
 * `if (env !== 'production') { dev }` shapes correctly. Walks up to
 * (but not past) `boundary`.
 *
 * Used by error-leak to suppress findings inside dev-only branches that
 * intentionally surface stack traces. Reusable for: debug-log-prod,
 * verbose-error-handler, console-log-in-prod, unsafe-tls-skip — any
 * "sensitive sink in prod-only branch" rule.
 */
export function isInNonProductionBranch(node: Node, boundary: Node): boolean {
  let cur: Node | undefined = node;
  while (cur && cur !== boundary) {
    const parent: Node | undefined = cur.getParent();
    if (parent && Node.isIfStatement(parent)) {
      const cond = parent.getExpression().getText();
      const mentionsNodeEnv = cond.includes('process.env.NODE_ENV');
      const mentionsProd = cond.includes("'production'") || cond.includes('"production"');

      if (mentionsNodeEnv && mentionsProd) {
        // Strict-equality assumed. Loose `==`/`!=` rare in modern code and
        // adds polarity-detection noise; a `==` shape silently passes through
        // as the non-negated path, which is the safe-by-default direction
        // (we keep firing the rule rather than over-suppressing).
        const isNegated = cond.includes('!==') || cond.includes('!=');
        const inThen = parent.getThenStatement() === cur;
        const inElse = parent.getElseStatement() === cur;

        // if (env !== 'production') { dev } else { prod }
        if (isNegated && inThen) return true;
        // if (env === 'production') { prod } else { dev }
        if (!isNegated && inElse) return true;
      }
    }
    cur = parent;
  }
  return false;
}

/**
 * True when `ancestor` is an ancestor of (or equal to) `node`. A pure
 * AST-walk primitive. Currently used by bearer-token-literal to verify
 * that a string-value node sits inside a known Headers-tuple element.
 */
export function isAncestorOf(ancestor: Node | undefined, node: Node): boolean {
  if (!ancestor) return false;
  let cur: Node | undefined = node;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.getParent();
  }
  return false;
}
