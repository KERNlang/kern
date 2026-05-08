/**
 * Rule: status-code-drift
 *
 * Cross-stack rule — fires when a frontend network call branches on a 2xx
 * status code that the matched server route does not actually emit. Sibling
 * to `error-contract-drift` (which handles 4xx/5xx).
 *
 * Common production foot-gun:
 *   - Client: `if (res.status === 201) showCreatedToast()`
 *   - Server: `res.status(200).json(created)` — the 201 branch never fires.
 *
 * Confidence multiplier: `CROSS_STACK_EXACT_CONFIDENCE` (0.9).
 *
 * Gate design:
 *   1. Path + method match (`findHighConfidenceRouteForMethod`).
 *   2. Server has resolved success-status evidence with at least one 2xx code.
 *      Multi-2xx routes are supported: the rule fires when the client's
 *      checked code is NOT in the server's emitted set.
 *   3. Client branches on EXACTLY ONE 2xx code (200/201/202). When the client
 *      checks multiple 2xx codes, the call-site has dispatch logic that's
 *      probably wired to the actual contract; skip to avoid double-counting
 *      with `error-contract-drift`-style designs.
 *   4. The client's checked 2xx must NOT be in the server's emitted set.
 *   5. Skip the 200/204 pair when the server emits a SINGLE code — DELETE/
 *      PATCH routes commonly return 204 and clients commonly check 200; the
 *      semantics overlap enough that the rule needs more signal data before
 *      firing on it. For multi-2xx servers the skip does not apply (the
 *      client's check is an unambiguous miss).
 *
 * Requires graph mode; silent in single-file review.
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

    // Gate 2: server must have resolved success-status evidence with at least one 2xx code.
    if (route.node.payload.successStatusCodesResolved !== true) continue;
    const serverCodes = route.node.payload.successStatusCodes;
    if (!serverCodes || serverCodes.length === 0) continue;

    // Gate 4: drift exists only when the client's code is NOT in the server's emitted set.
    if (serverCodes.includes(clientCode)) continue;

    // Gate 5: skip 200/204 pair when server emits a SINGLE code (legacy
    // single-code mismatch case). For multi-2xx servers the client's miss is
    // unambiguous — the rule should fire even on the 200/204 pair.
    if (serverCodes.length === 1) {
      const serverCode = serverCodes[0];
      if ((clientCode === 200 && serverCode === 204) || (clientCode === 204 && serverCode === 200)) continue;
    }

    const sortedServerCodes = [...serverCodes].sort((a, b) => a - b);
    const serverCodeText =
      sortedServerCodes.length === 1
        ? `\`${sortedServerCodes[0]}\``
        : `one of [${sortedServerCodes.map((c) => `\`${c}\``).join(', ')}]`;
    findings.push({
      source: 'kern',
      ruleId: 'status-code-drift',
      severity: 'warning',
      category: 'bug',
      message:
        `Client branches on status \`${clientCode}\` but server route \`${call.method} ${route.path}\` returns ${serverCodeText}. ` +
        `The \`if (res.status === ${clientCode})\` branch will never run — either change the client check to match a server-emitted code, ` +
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
