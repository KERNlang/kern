/**
 * Rule: param-name-swap
 *
 * Cross-stack rule — fires when a client URL and a server route share the
 * same path shape (same segment count, same param positions) but a named
 * param appears at a different position on each side. The classic bug:
 *
 *   client:  fetch(`/users/${userId}/posts/${postId}`)  → /users/:userId/posts/:postId
 *   server:  router.get('/users/:postId/posts/:userId')
 *
 * The path shape matches so `contract-drift` stays silent; the server
 * will pull the wrong value out of `req.params`. This rule narrows on
 * "same name, different position" only — firing on every name mismatch
 * would flood the report, because client param names come from the JS
 * identifier at the call site and server param names come from the route
 * template, and they are not required to agree.
 *
 * Requires graph mode. Silent in single-file review.
 */

import type { ConceptNode } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  API_PATH_RE,
  CROSS_STACK_HEURISTIC_CONFIDENCE,
  collectRoutesAcrossGraph,
  normalizeClientUrl,
} from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

interface ClientCall {
  target: string;
  normalizedPath: string;
  node: ConceptNode;
}

export function paramNameSwap(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (serverRoutes.length === 0) return [];

  const clientCalls: ClientCall[] = [];
  for (const [, conceptMap] of ctx.allConcepts) {
    for (const node of conceptMap.nodes) {
      if (node.kind !== 'effect' || node.payload.kind !== 'effect' || node.payload.subtype !== 'network') continue;
      const target = node.payload.target;
      if (typeof target !== 'string') continue;
      const normalized = normalizeClientUrl(target);
      if (!normalized || !API_PATH_RE.test(normalized)) continue;
      clientCalls.push({ target, normalizedPath: normalized, node });
    }
  }

  if (clientCalls.length === 0) return [];

  const findings: ReviewFinding[] = [];
  const seen = new Set<string>();

  for (const call of clientCalls) {
    if (call.node.primarySpan.file !== ctx.filePath) continue;

    const clientParts = call.normalizedPath.split('/');
    for (const route of serverRoutes) {
      const routeParts = route.path.split('/');
      if (routeParts.length !== clientParts.length) continue;
      if (!sameLiterals(clientParts, routeParts)) continue;

      const clientNames = paramNames(clientParts);
      const routeNames = paramNames(routeParts);
      if (clientNames.length < 2 || routeNames.length < 2) continue;

      const swap = findNameSwap(clientNames, routeNames);
      if (!swap) continue;

      const fingerprint = createFingerprint(
        'param-name-swap',
        call.node.primarySpan.startLine,
        call.node.primarySpan.startCol,
      );
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      findings.push({
        source: 'kern',
        ruleId: 'param-name-swap',
        severity: 'warning',
        category: 'bug',
        message: `Path param \`${swap.name}\` appears at position ${swap.clientIndex + 1} in the client URL \`${call.normalizedPath}\` but at position ${swap.serverIndex + 1} in server route \`${route.path}\`. A swap like this makes the server pull the wrong value from \`req.params\`.`,
        primarySpan: call.node.primarySpan,
        fingerprint,
        confidence: call.node.confidence * CROSS_STACK_HEURISTIC_CONFIDENCE,
      });
      break;
    }
  }

  return findings;
}

// Compare segments ignoring param names (both `:x` and `{x}` match any `:y`/`{y}`).
function sameLiterals(a: readonly string[], b: readonly string[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const ap = isParamSeg(a[i]);
    const bp = isParamSeg(b[i]);
    if (ap !== bp) return false;
    if (!ap && a[i] !== b[i]) return false;
  }
  return true;
}

function isParamSeg(s: string): boolean {
  return s.startsWith(':') || (s.startsWith('{') && s.endsWith('}'));
}

function paramNames(parts: readonly string[]): Array<{ index: number; name: string }> {
  const out: Array<{ index: number; name: string }> = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith(':')) out.push({ index: i, name: p.slice(1) });
    else if (p.startsWith('{') && p.endsWith('}')) out.push({ index: i, name: p.slice(1, -1) });
  }
  return out;
}

// A swap exists when a name appears in BOTH sides but at different positions.
// We only report the first such swap per route to keep the message tight.
function findNameSwap(
  client: ReadonlyArray<{ index: number; name: string }>,
  server: ReadonlyArray<{ index: number; name: string }>,
): { name: string; clientIndex: number; serverIndex: number } | undefined {
  const serverByName = new Map(server.map((p) => [p.name, p.index]));
  for (const cp of client) {
    const sIdx = serverByName.get(cp.name);
    if (sIdx !== undefined && sIdx !== cp.index) {
      return { name: cp.name, clientIndex: cp.index, serverIndex: sIdx };
    }
  }
  return undefined;
}
