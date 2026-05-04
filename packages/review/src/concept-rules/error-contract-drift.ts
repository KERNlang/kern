/**
 * Rule: error-contract-drift
 *
 * Cross-stack rule — fires when a server route declares a literal HTTP error
 * status that the matched frontend call-site does not branch on, AND the
 * call-site already branches on at least one OTHER status this route emits
 * (proving the dispatch is endpoint-specific, not incidental).
 *
 * Phase 2 of the error-contract work. Phase 1 (#208) shipped the client-side
 * `handledErrorStatusCodes` extraction; this rule consumes it.
 *
 * The 0.9 evidence gate (campfire 2026-05-04 — Codex/Gemini/OpenCode unanimous):
 *   - Path + method match (one server route, exact verb).
 *   - Server `errorStatusCodes` is non-empty after the semantic-only filter.
 *   - Client `handledErrorStatusCodes` is non-empty (call-site has explicit
 *     literal-status dispatch — not generic `catch` or `response.ok` only).
 *   - Client already branches on at least ONE pre-existing server status for
 *     this endpoint. Without this overlap the rule would fire on every legacy
 *     mismatch where the client's specific status check happens to be unrelated
 *     to the server's set.
 *
 * Excluded statuses (v1):
 *   - 500 / 502 / 503 — server emits these via `next(err)` and unresolved
 *     `throw`, which are not stable client contracts. Codex called this out
 *     explicitly: "I would explicitly exclude inferred 500s from v1, because
 *     generic `throw` / `next(err)` is not a stable client contract."
 *   - Anything outside the 4xx/429 range. Phase-3 work will surface these
 *     once we have an `errorStatusCodesResolved` completeness bit on the server.
 *
 * Confidence: `CROSS_STACK_EXACT_CONFIDENCE` (0.9). The rule's static gates
 * already approximate this; kern-guard's `isNew` ratchet handles "did this
 * mismatch just appear in the PR diff" suppression.
 */

import type { ConceptNode } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  API_PATH_RE,
  CROSS_STACK_EXACT_CONFIDENCE,
  collectRoutesAcrossGraph,
  findHighConfidenceRouteForMethod,
  normalizeClientUrl,
} from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';
import { apiCallRootCause } from './root-cause.js';

interface ClientCall {
  target: string;
  normalizedPath: string;
  method: string;
  handled: readonly number[];
  node: ConceptNode;
}

// Codex/Gemini/OpenCode all converged on this set as the "stable" semantic
// statuses where a server contract change is meaningful for the client. 429
// is included because real audiofacets/web-viewer code branches on it (phase-1
// probe found 429×1) and rate-limit handling is a legitimate UX concern.
const SEMANTIC_ERROR_STATUSES = new Set([401, 403, 404, 409, 422, 429]);

export function errorContractDrift(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (serverRoutes.length === 0) return [];

  const clientCalls = collectExplicitDispatchCalls(ctx);
  if (clientCalls.length === 0) return [];

  const findings: ReviewFinding[] = [];
  for (const call of clientCalls) {
    if (call.node.primarySpan.file !== ctx.filePath) continue;

    const route = findHighConfidenceRouteForMethod(call.normalizedPath, call.method, serverRoutes);
    if (!route?.node) continue;
    if (route.node.payload.kind !== 'entrypoint') continue;
    const serverCodes = route.node.payload.errorStatusCodes;
    if (!serverCodes || serverCodes.length === 0) continue;

    const semanticServer = serverCodes.filter((c) => SEMANTIC_ERROR_STATUSES.has(c));
    if (semanticServer.length === 0) continue;

    const handledSet = new Set(call.handled);
    // The strongest 0.9 gate from the buddy round: client must already
    // branch on at least ONE server status for this endpoint. Without
    // this, a client that handles 401 globally (auth interceptor) but
    // never anything endpoint-specific would fire on every route the
    // server adds a 404 to. The overlap proves the dispatch is wired
    // to THIS endpoint's contract.
    const overlap = semanticServer.filter((c) => handledSet.has(c));
    if (overlap.length === 0) continue;

    const unhandled = semanticServer.filter((c) => !handledSet.has(c));
    if (unhandled.length === 0) continue;

    const codeList = unhandled.join(', ');
    const handledList = call.handled.filter((c) => SEMANTIC_ERROR_STATUSES.has(c)).join(', ');
    findings.push({
      source: 'kern',
      ruleId: 'error-contract-drift',
      severity: 'warning',
      category: 'bug',
      message:
        `Server route \`${call.method} ${route.path}\` emits status${unhandled.length === 1 ? '' : 'es'} ` +
        `[${codeList}] but this client call-site only branches on [${handledList}]. ` +
        `Add an explicit \`response.status === ${unhandled[0]}\` (or \`case ${unhandled[0]}:\`) branch, or ` +
        `confirm the generic fallback handles ${unhandled.length === 1 ? 'it' : 'them'} the same way as ${handledList}.`,
      primarySpan: call.node.primarySpan,
      fingerprint: createFingerprint(
        'error-contract-drift',
        call.node.primarySpan.startLine,
        call.node.primarySpan.startCol,
      ),
      confidence: call.node.confidence * CROSS_STACK_EXACT_CONFIDENCE,
      rootCause: apiCallRootCause(call.node, call.normalizedPath, call.method, route.node),
    });
  }
  return findings;
}

function collectExplicitDispatchCalls(ctx: ConceptRuleContext): ClientCall[] {
  const calls: ClientCall[] = [];
  if (!ctx.allConcepts) return calls;
  for (const [, conceptMap] of ctx.allConcepts) {
    for (const node of conceptMap.nodes) {
      if (node.kind !== 'effect') continue;
      if (node.payload.kind !== 'effect') continue;
      if (node.payload.subtype !== 'network') continue;
      const target = node.payload.target;
      const method = node.payload.method;
      const handled = node.payload.handledErrorStatusCodes;
      if (typeof target !== 'string') continue;
      if (typeof method !== 'string') continue;
      if (!handled || handled.length === 0) continue;
      const normalized = normalizeClientUrl(target);
      if (!normalized || !API_PATH_RE.test(normalized)) continue;
      calls.push({ target, normalizedPath: normalized, method, handled, node });
    }
  }
  return calls;
}
