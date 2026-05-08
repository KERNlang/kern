import { Node, SyntaxKind } from 'ts-morph';
import { numericLiteralValue } from '../../helpers/ast.js';
import { API_SUCCESS_STATUS_CODES, TERMINAL_RESPONSE_METHODS } from '../../signatures.js';
import type { ExpressRouteHandlerFn } from './route-handler.js';

// ── Express success-status extraction ────────────────────────────────────
// Walks the handler body for `res.status(2xx)` / `res.sendStatus(2xx)`. If no
// explicit 2xx is present BUT there is a terminal `.json()`/`.send()`/`.end()`
// call, infers an implicit 200 (Express default). Implicit 204 is never
// inferred — only explicit `sendStatus(204)` or `status(204)` adds 204.
export function extractExpressSuccessStatusCodes(handlerFn: ExpressRouteHandlerFn): {
  codes: readonly number[] | undefined;
  resolved: boolean;
} {
  const explicit = new Set<number>();
  let sawTerminalWithoutPrecedingStatus = false;
  let sawDynamicStatus = false;
  let sawAnyExplicitStatusCall = false;

  for (const call of handlerFn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    const name = pa.getName();
    const receiverNode = pa.getExpression();
    const receiverText = receiverNode.getText();
    if (!/\b(res|reply|response)\b/i.test(receiverText)) continue;

    if (name === 'status' || name === 'sendStatus') {
      sawAnyExplicitStatusCall = true;
      const arg = call.getArguments()[0];
      const code = numericLiteralValue(arg);
      if (code === undefined) {
        sawDynamicStatus = true;
        continue;
      }
      if (API_SUCCESS_STATUS_CODES.has(code)) explicit.add(code);
      continue;
    }

    if (TERMINAL_RESPONSE_METHODS.has(name)) {
      // Per-terminal check, walking up the receiver chain (Gemini/Codex final
      // review #2): the implicit-200 inference must NOT fire for a terminal
      // whose ANY ancestor receiver is a status()/sendStatus() call. Examples:
      //   - `res.status(201).json(...)` — direct receiver IS status() → no 200
      //   - `res.status(404).type('json').send()` — chain has status() → no 200
      //   - `res.status(201).set('X-Count', 10).json(data)` — chain has status() → no 200
      //   - `res.json(...)` (bare) — chain has no status() → implicit 200 candidate
      // P2-D: also skip implicit-200 when an UNCONDITIONAL preceding statement
      // in any ancestor block sets `<sameReceiver>.status(N)` — covers the
      // `res.status(201); res.json(...)` separate-statement pattern.
      if (
        !chainContainsStatusOrSendStatusCall(receiverNode) &&
        !hasUnconditionalPrecedingStatusCall(call, receiverText, handlerFn)
      ) {
        sawTerminalWithoutPrecedingStatus = true;
      }
    }
  }

  if (sawDynamicStatus) {
    return { codes: explicit.size > 0 ? Array.from(explicit).sort((a, b) => a - b) : undefined, resolved: false };
  }

  if (sawTerminalWithoutPrecedingStatus) {
    explicit.add(200);
  }

  if (explicit.size === 0) {
    if (sawAnyExplicitStatusCall) return { codes: [], resolved: true };
    return { codes: undefined, resolved: false };
  }
  return { codes: Array.from(explicit).sort((a, b) => a - b), resolved: true };
}

/** True when `node` is a CallExpression of shape `<receiver>.status(...)` or
 *  `<receiver>.sendStatus(...)`, OR when any node up its property/call chain
 *  is. Walks through intermediate `.set(...)` / `.type(...)` / `.cookie(...)`
 *  links so that `res.status(201).set('X-Count', 10).json(data)` correctly
 *  reports that `.json` is preceded by an explicit status. */
function chainContainsStatusOrSendStatusCall(node: import('ts-morph').Node): boolean {
  let cur: import('ts-morph').Node = node;
  while (true) {
    if (Node.isCallExpression(cur)) {
      const callee = cur.getExpression();
      if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
        const pa = callee as import('ts-morph').PropertyAccessExpression;
        const name = pa.getName();
        if (name === 'status' || name === 'sendStatus') return true;
        cur = pa.getExpression();
        continue;
      }
      return false;
    }
    if (Node.isPropertyAccessExpression(cur)) {
      cur = cur.getExpression();
      continue;
    }
    return false;
  }
}

/** Variant of `chainContainsStatusOrSendStatusCall` that also requires the
 *  IMMEDIATE receiver of the matched `.status(...)` / `.sendStatus(...)` call
 *  to text-match `receiverText`. Used by P2-D to guard against unrelated
 *  status calls on different receivers in preceding statements. */
function chainContainsStatusOrSendStatusCallWithReceiver(node: import('ts-morph').Node, receiverText: string): boolean {
  let cur: import('ts-morph').Node = node;
  while (true) {
    if (Node.isCallExpression(cur)) {
      const callee = cur.getExpression();
      if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
        const pa = callee as import('ts-morph').PropertyAccessExpression;
        const name = pa.getName();
        if ((name === 'status' || name === 'sendStatus') && pa.getExpression().getText() === receiverText) {
          return true;
        }
        cur = pa.getExpression();
        continue;
      }
      return false;
    }
    if (Node.isPropertyAccessExpression(cur)) {
      cur = cur.getExpression();
      continue;
    }
    return false;
  }
}

/** P2-D: scan unconditional preceding statements in the terminal's ancestor
 *  blocks for any `<receiverText>.status(N)` / `.sendStatus(N)` call. When
 *  found, the implicit-200 inference for the terminal is suppressed. */
function hasUnconditionalPrecedingStatusCall(
  terminal: import('ts-morph').CallExpression,
  receiverText: string,
  handlerFn: ExpressRouteHandlerFn,
): boolean {
  const handlerBody = handlerFn.getBody();
  if (!handlerBody || !Node.isBlock(handlerBody)) return false;

  let cur: import('ts-morph').Node = terminal;
  let parent: import('ts-morph').Node | undefined = cur.getParent();
  while (parent) {
    if (cur === handlerFn) return false;

    if (Node.isBlock(parent)) {
      for (const sibling of parent.getStatements()) {
        if (sibling === cur) break;
        if (Node.isExpressionStatement(sibling)) {
          const expr = sibling.getExpression();
          if (chainContainsStatusOrSendStatusCallWithReceiver(expr, receiverText)) return true;
        }
      }
      if (parent === handlerBody) return false;
    }
    cur = parent;
    parent = cur.getParent();
  }
  return false;
}
