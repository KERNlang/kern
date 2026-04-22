/**
 * Async correctness — Wave 2 rules for common Promise/AbortController footguns.
 * Deliberately narrow: each rule fires only on high-confidence patterns.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { cleanupExpressionMatches, finding, getTopLevelCleanupExpressions, insertBeforeSpan } from './utils.js';

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

    const cleanupExprs = getTopLevelCleanupExpressions(body);
    const hasExistingReturn = cleanupExprs.length > 0;

    for (const ctrl of controllers) {
      const hasAbortCall = cleanupExprs.some((expr) =>
        cleanupExpressionMatches(expr, { cleanupPatterns: [new RegExp(`\\b${ctrl.name}\\s*\\.\\s*abort\\s*\\(`)] }),
      );
      if (!hasAbortCall) {
        // Autofix: insert a cleanup return immediately before the closing brace
        // of the effect body. Only safe when there is NO existing return — if
        // one is there, the user already has a cleanup and we'd need to merge
        // the abort into it, which is too risky for an automated transform.
        const closingBrace = body.getLastChildByKind(SyntaxKind.CloseBraceToken);
        const canAutofix = !hasExistingReturn && controllers.length === 1 && closingBrace != null;
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
              ...(canAutofix && closingBrace
                ? {
                    autofix: {
                      type: 'insert-before' as const,
                      span: insertBeforeSpan(closingBrace, ctx.filePath),
                      replacement: `  return () => ${ctrl.name}.abort();\n`,
                      description: `Insert cleanup return that aborts ${ctrl.name}`,
                    },
                  }
                : {}),
            },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule: unchecked-fetch-response ───────────────────────────────────────
// `fetch()` resolves even on 4xx/5xx — only network-level failures throw.
// Calling `.json()` / `.text()` without first checking `.ok` / `.status`
// means the frontend silently consumes an error payload as data, masking
// the real failure. Fires on:
//
//   const res = await fetch(url);
//   const data = await res.json();   // ← no ok/status check anywhere
//
// and on the anonymous form:
//
//   const data = await (await fetch(url)).json();
//
// Stays silent when the code reads `res.ok`, `res.status`, or
// `res.statusText` anywhere in the same function, or when the fetch lives
// in a `try` whose `catch` rethrows or returns early. Scoped to `fetch()`
// only; `axios`/`ky`/`got` throw on non-2xx by default.

const RESPONSE_BODY_METHODS = new Set(['json', 'text', 'blob', 'arrayBuffer', 'formData']);
const RESPONSE_STATUS_PROPS = new Set(['ok', 'status', 'statusText']);

function unboundBodyMethodOnAnonymousFetch(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (!RESPONSE_BODY_METHODS.has(callee.getName())) continue;

    // Anonymous form: `(await fetch(...)).json()`
    const target = callee.getExpression();
    let awaited: Node | undefined;
    if (Node.isParenthesizedExpression(target)) {
      const inner = target.getExpression();
      if (Node.isAwaitExpression(inner)) awaited = inner;
    } else if (Node.isAwaitExpression(target)) {
      awaited = target;
    }
    if (!awaited || !Node.isAwaitExpression(awaited)) continue;

    const awaited2 = awaited as import('ts-morph').AwaitExpression;
    const awaitedExpr = awaited2.getExpression();
    if (!isFetchCall(awaitedExpr)) continue;

    findings.push(
      finding(
        'unchecked-fetch-response',
        'warning',
        'bug',
        '`fetch()` response body is consumed without a status check — non-2xx responses (4xx/5xx) will be read as valid data because `fetch()` only rejects on network errors.',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Bind the response to a variable and check `response.ok` or `response.status` before calling `.json()`/`.text()`.',
        },
      ),
    );
  }

  // Named form: `const res = await fetch(...)` then `res.json()` with no
  // `res.ok` / `res.status` / `res.statusText` reference anywhere in the
  // containing function body.
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (!RESPONSE_BODY_METHODS.has(callee.getName())) continue;
    const obj = callee.getExpression();
    if (!Node.isIdentifier(obj)) continue;

    const declared = findFetchAssignment(obj.getText(), call);
    if (!declared) continue;

    const fnBody = getEnclosingFunctionBody(call);
    if (!fnBody) continue;

    if (hasStatusCheck(fnBody, obj.getText())) continue;

    findings.push(
      finding(
        'unchecked-fetch-response',
        'warning',
        'bug',
        `\`${obj.getText()}.${callee.getName()}()\` is called without checking \`${obj.getText()}.ok\` or \`${obj.getText()}.status\` — non-2xx responses will be parsed as valid data because \`fetch()\` only rejects on network errors.`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion: `Add \`if (!${obj.getText()}.ok) throw new Error(...)\` between the \`fetch()\` and \`.${callee.getName()}()\`.`,
        },
      ),
    );
  }

  return findings;
}

function isFetchCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;
  const expr = node.getExpression();
  return Node.isIdentifier(expr) && expr.getText() === 'fetch';
}

// Find the variable declaration that initialises `name` with `await fetch(...)`.
// Traverse up from the usage site so we pick the closest binding in scope.
function findFetchAssignment(name: string, usage: Node): import('ts-morph').VariableDeclaration | undefined {
  let cur: Node | undefined = usage;
  while (cur) {
    const block: Node | undefined = cur.getFirstAncestor(
      (n: Node) =>
        Node.isBlock(n) ||
        Node.isSourceFile(n) ||
        Node.isArrowFunction(n) ||
        Node.isFunctionDeclaration(n) ||
        Node.isFunctionExpression(n) ||
        Node.isMethodDeclaration(n),
    );
    if (!block) return undefined;
    for (const decl of block.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      if (decl.getName() !== name) continue;
      const init = decl.getInitializer();
      if (!init || !Node.isAwaitExpression(init)) continue;
      if (isFetchCall(init.getExpression())) return decl;
    }
    cur = block.getParent();
  }
  return undefined;
}

function getEnclosingFunctionBody(node: Node): Node | undefined {
  return node.getFirstAncestor(
    (n) =>
      Node.isFunctionDeclaration(n) ||
      Node.isArrowFunction(n) ||
      Node.isFunctionExpression(n) ||
      Node.isMethodDeclaration(n),
  );
}

function hasStatusCheck(fnBody: Node, name: string): boolean {
  for (const pa of fnBody.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const obj = pa.getExpression();
    if (!Node.isIdentifier(obj) || obj.getText() !== name) continue;
    if (RESPONSE_STATUS_PROPS.has(pa.getName())) return true;
  }
  return false;
}

// ── Exported Async Rules ─────────────────────────────────────────────────

export const asyncRules = [promiseAllErrorSwallow, abortControllerLeak, unboundBodyMethodOnAnonymousFetch];
