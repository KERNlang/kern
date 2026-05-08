/**
 * Rule: status-code-drift
 *
 * Cross-stack rule — fires when a frontend network call branches on a 2xx
 * status code that the matched server route does not actually emit. Sibling
 * to `error-contract-drift` (which handles 4xx/5xx), but with a different
 * gate design because success codes don't have the "client already handles
 * one other server code" overlap to lean on (most routes emit a single 2xx).
 *
 * Common production foot-gun:
 *   - Client: `if (res.status === 201) showCreatedToast()`
 *   - Server: `res.status(200).json(created)` — the 201 branch never fires.
 *
 * Confidence multiplier: `CROSS_STACK_EXACT_CONFIDENCE` (0.9).
 *
 * V1 gate design (tight, may evolve as signal data lands):
 *   1. Path + method match (`findHighConfidenceRouteForMethod`).
 *   2. Server has resolved success-status evidence with EXACTLY ONE 2xx code.
 *      Multi-2xx routes are skipped — the rule can't yet distinguish "server
 *      returns 200 OR 201 depending on body" from genuine drift.
 *   3. Client branches on EXACTLY ONE 2xx code (200/201/202). When the client
 *      checks multiple 2xx codes, the call-site has dispatch logic that's
 *      probably wired to the actual contract; skip to avoid double-counting
 *      with `error-contract-drift`-style designs.
 *   4. The client's checked 2xx must NOT match the server's emitted 2xx.
 *   5. Skip the 200/204 pair entirely — DELETE/PATCH routes commonly return
 *      204 and clients commonly check 200; the semantics overlap enough that
 *      the rule needs more signal data before firing on it.
 *
 * Requires graph mode; silent in single-file review.
 *
 * Documented coverage gaps (intentional v1 limits — buddy review consensus):
 *   - Multi-2xx server routes are skipped (gate 2) — false negatives accepted.
 *   - FastAPI server routes are skipped because the Python mapper doesn't yet
 *     populate `successStatusCodesResolved`. Phase 2 work.
 *   - `.then(res => res.status === 201)` callback form isn't call-bound — the
 *     mapper falls back to function-wide attribution there, which only fires
 *     when the function has a single network call. Phase 2 work.
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

/** Success status codes the client commonly branches on explicitly. 204
 *  intentionally omitted — DELETE/PATCH overlap creates more noise than
 *  signal at this rule's current precision target. */
const CLIENT_DISPATCHED_SUCCESS_STATUSES = new Set([200, 201, 202]);

interface ClientCall {
  target: string;
  normalizedPath: string;
  method: string;
  handled: readonly number[];
  node: ConceptNode;
}

export function statusCodeDrift(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (serverRoutes.length === 0) return [];

  const clientCalls = collectClientCalls(ctx);
  if (clientCalls.length === 0) return [];

  const findings: ReviewFinding[] = [];
  for (const call of clientCalls) {
    if (call.node.primarySpan.file !== ctx.filePath) continue;

    // Gate 3: client must dispatch on EXACTLY ONE 2xx code.
    const checkedSuccess = call.handled.filter((c) => CLIENT_DISPATCHED_SUCCESS_STATUSES.has(c));
    if (checkedSuccess.length !== 1) continue;
    const clientCode = checkedSuccess[0];

    const route = findHighConfidenceRouteForMethod(call.normalizedPath, call.method, serverRoutes);
    if (!route?.node) continue;
    if (route.node.payload.kind !== 'entrypoint') continue;

    // Gate 2: server must have resolved success-status evidence with EXACTLY ONE 2xx code.
    if (route.node.payload.successStatusCodesResolved !== true) continue;
    const serverCodes = route.node.payload.successStatusCodes;
    if (!serverCodes || serverCodes.length !== 1) continue;
    const serverCode = serverCodes[0];

    // Gate 4: drift exists only when the codes differ.
    if (clientCode === serverCode) continue;

    // Gate 5: skip 200/204 pair — too much legitimate ambiguity.
    if ((clientCode === 200 && serverCode === 204) || (clientCode === 204 && serverCode === 200)) continue;

    findings.push({
      source: 'kern',
      ruleId: 'status-code-drift',
      severity: 'warning',
      category: 'bug',
      message:
        `Client branches on status \`${clientCode}\` but server route \`${call.method} ${route.path}\` returns \`${serverCode}\`. ` +
        `The \`if (res.status === ${clientCode})\` branch will never run — either change the client check to \`${serverCode}\` ` +
        `or change the server to return \`${clientCode}\`.`,
      primarySpan: call.node.primarySpan,
      fingerprint: createFingerprint(
        'status-code-drift',
        call.node.primarySpan.startLine,
        call.node.primarySpan.startCol,
      ),
      confidence: call.node.confidence * CROSS_STACK_EXACT_CONFIDENCE,
      rootCause: apiCallRootCause(call.node, call.normalizedPath, call.method, route.node),
    });
  }
  return findings;
}

function collectClientCalls(ctx: ConceptRuleContext): ClientCall[] {
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
