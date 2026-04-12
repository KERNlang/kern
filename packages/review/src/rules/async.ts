/**
 * Async correctness — Wave 2 rules for common Promise/AbortController footguns.
 * Deliberately narrow: each rule fires only on high-confidence patterns.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding } from './utils.js';

// ── Rule: promise-all-error-swallow ──────────────────────────────────────
// Promise.all([...]) without .catch and not inside a try/catch is a bug:
// a single rejection silently cancels the handler and the error is lost.

function promiseAllErrorSwallow(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== 'Promise.all' && callee !== 'Promise.allSettled') continue;
    // allSettled is safe by construction (never rejects)
    if (callee === 'Promise.allSettled') continue;

    // Walk up to see if we're inside a try block
    let inTry = false;
    let chained = false;
    let cur: Node | undefined = call.getParent();

    while (cur) {
      if (Node.isTryStatement(cur)) {
        inTry = true;
        break;
      }
      // Function boundary — stop searching for try
      if (Node.isFunctionDeclaration(cur) || Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) {
        break;
      }
      cur = cur.getParent();
    }

    // Check for .catch chain: Promise.all(...).catch(...) / .then(..., onRejected)
    const parent = call.getParent();
    if (parent && Node.isPropertyAccessExpression(parent)) {
      const method = parent.getName();
      if (method === 'catch') chained = true;
      if (method === 'then') {
        // Check if .then has a second argument (onRejected)
        const thenCall = parent.getParent();
        if (thenCall && Node.isCallExpression(thenCall) && thenCall.getArguments().length >= 2) {
          chained = true;
        } else {
          // See if there's a .catch further along
          let chain: Node | undefined = thenCall;
          while (chain && Node.isCallExpression(chain)) {
            const p = chain.getParent();
            if (p && Node.isPropertyAccessExpression(p) && p.getName() === 'catch') {
              chained = true;
              break;
            }
            chain = p?.getParent();
          }
        }
      }
    }

    // Check if awaited inside an async function — the caller may handle it
    const awaited = parent && Node.isAwaitExpression(parent);

    if (!inTry && !chained && !awaited) {
      findings.push(
        finding(
          'promise-all-error-swallow',
          'warning',
          'bug',
          'Promise.all() called without .catch, try/catch, or await — a single rejection will be silently unhandled',
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          {
            suggestion:
              'Add .catch(err => ...), wrap in try/catch inside an async function, or use Promise.allSettled if per-promise failures are expected',
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: abortcontroller-leak ───────────────────────────────────────────
// `new AbortController()` created inside useEffect without `.abort()` in
// the cleanup return. Classic memory leak + stale-response bug.

const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);

function abortControllerLeak(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    const calleeName = calleeText.includes('.') ? calleeText.split('.').pop()! : calleeText;
    if (!EFFECT_HOOKS.has(calleeName)) continue;

    const args = call.getArguments();
    if (args.length === 0) continue;
    const fnArg = args[0];
    if (!Node.isArrowFunction(fnArg) && !Node.isFunctionExpression(fnArg)) continue;

    const body = fnArg.getBody();
    if (!body) continue;
    if (!Node.isBlock(body)) continue;

    // Find `new AbortController()` created directly in the effect body
    const controllers: { name: string; line: number }[] = [];
    for (const newExpr of body.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      if (newExpr.getExpression().getText() !== 'AbortController') continue;

      // Walk up to find the variable declaration
      let cur: Node | undefined = newExpr.getParent();
      while (cur && !Node.isVariableDeclaration(cur)) {
        cur = cur.getParent();
      }
      if (cur && Node.isVariableDeclaration(cur)) {
        const nameNode = cur.getNameNode();
        if (Node.isIdentifier(nameNode)) {
          controllers.push({ name: nameNode.getText(), line: newExpr.getStartLineNumber() });
        }
      }
    }

    if (controllers.length === 0) continue;

    // Check the cleanup function (the return value of the effect body)
    let cleanupText = '';
    for (const stmt of body.getStatements()) {
      if (Node.isReturnStatement(stmt)) {
        const expr = stmt.getExpression();
        if (expr && (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr))) {
          cleanupText = expr.getText();
        }
        break;
      }
    }

    for (const ctrl of controllers) {
      // Require both: the ref name appears in cleanup AND .abort() is called
      const hasAbortCall = new RegExp(`\\b${ctrl.name}\\s*\\.\\s*abort\\s*\\(`).test(cleanupText);
      if (!hasAbortCall) {
        findings.push(
          finding(
            'abortcontroller-leak',
            'warning',
            'bug',
            `AbortController '${ctrl.name}' created in ${calleeName} but never aborted in cleanup — in-flight requests survive unmount and may overwrite newer state`,
            ctx.filePath,
            ctrl.line,
            1,
            {
              suggestion: `Return a cleanup function that calls ${ctrl.name}.abort(): return () => ${ctrl.name}.abort();`,
            },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Exported Async Rules ─────────────────────────────────────────────────

export const asyncRules = [promiseAllErrorSwallow, abortControllerLeak];
