/**
 * Rule: pagination-key-drift
 *
 * Cross-stack rule — fires when the client uses one pagination anchor family
 * (e.g. `?page=1`) against a server route whose handler reads a different
 * anchor family (e.g. `req.query.offset`). Common production foot-gun:
 *
 *   - Client: `fetch('/api/users?page=2')`
 *   - Server: `(req, res) => { const offset = req.query.offset ?? 0; ... }`
 *     The server ignores `?page=` entirely and always serves the first page.
 *
 * Confidence multiplier: `CROSS_STACK_EXACT_CONFIDENCE` (0.9) — once both
 * sides have a resolved single-family strategy and the families differ, the
 * mismatch is unambiguous.
 *
 * Gates:
 *   1. Path + method match (`findHighConfidenceRouteForMethod`).
 *   2. Server `paginationStrategyResolved === true` AND strategy ∈
 *      `{page, offset, cursor}` (NOT `mixed`/`none` — `mixed` means the server
 *      tolerates either family, so the rule MUST stay silent there).
 *   3. Client `queryParamsResolved === true` AND derived strategy ∈
 *      `{page, offset, cursor}`.
 *   4. Client and server strategies are different anchor families.
 *
 * Size keys (`limit`, `take`, `pageSize`, `perPage`) are intentionally not
 * anchors. A handler that reads only `limit` has strategy `'none'` and the
 * rule will not fire — `limit` is compatible with either offset OR cursor
 * pagination, so flagging it would produce false positives.
 *
 * Requires graph mode; silent in single-file review.
 *
 * Documented coverage gaps (intentional v1 limits):
 *   - FastAPI server routes are skipped (Python mapper doesn't populate
 *     `paginationStrategyResolved`). Phase 2 work.
 *   - Servers that alias `req.query` to a local variable, pass it as an
 *     argument, or otherwise leak the reference are marked unresolved by the
 *     mapper — the rule stays silent rather than risk a false positive.
 *   - axios/ky-style fetch wrappers that pass query params via a config
 *     object (not the URL) are not extracted by the client-side mapper, so
 *     the rule doesn't fire on those calls.
 */

import type { ConceptNode } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  API_PATH_RE,
  aggregatePaginationStrategy,
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
  queryParams: readonly string[];
  clientStrategy: 'page' | 'offset' | 'cursor';
  node: ConceptNode;
}

export function paginationKeyDrift(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (serverRoutes.length === 0) return [];

  const clientCalls = collectClientPaginationCalls(ctx);
  if (clientCalls.length === 0) return [];

  const findings: ReviewFinding[] = [];
  for (const call of clientCalls) {
    if (call.node.primarySpan.file !== ctx.filePath) continue;

    const route = findHighConfidenceRouteForMethod(call.normalizedPath, call.method, serverRoutes);
    if (!route?.node) continue;
    if (route.node.payload.kind !== 'entrypoint') continue;
    if (route.node.payload.paginationStrategyResolved !== true) continue;
    const serverStrategy = route.node.payload.paginationStrategy;
    // Skip when the server tolerates either family or doesn't paginate at all.
    if (serverStrategy !== 'page' && serverStrategy !== 'offset' && serverStrategy !== 'cursor') continue;
    if (serverStrategy === call.clientStrategy) continue;

    const clientKeyExample = call.queryParams.find((k) => isAnchorKey(k));
    findings.push({
      source: 'kern',
      ruleId: 'pagination-key-drift',
      severity: 'warning',
      category: 'bug',
      message:
        `Client paginates with \`${call.clientStrategy}\` family (e.g. \`?${clientKeyExample}=...\`) but server route ` +
        `\`${call.method} ${route.path}\` reads only \`${serverStrategy}\` family keys. ` +
        `The server will ignore the client's pagination parameter and always return the same page.`,
      primarySpan: call.node.primarySpan,
      fingerprint: createFingerprint(
        'pagination-key-drift',
        call.node.primarySpan.startLine,
        call.node.primarySpan.startCol,
      ),
      confidence: call.node.confidence * CROSS_STACK_EXACT_CONFIDENCE,
      rootCause: apiCallRootCause(call.node, call.normalizedPath, call.method, route.node),
    });
  }
  return findings;
}

function isAnchorKey(key: string): boolean {
  return aggregatePaginationStrategy([key]) !== 'none';
}

function collectClientPaginationCalls(ctx: ConceptRuleContext): ClientCall[] {
  const calls: ClientCall[] = [];
  if (!ctx.allConcepts) return calls;
  for (const [, conceptMap] of ctx.allConcepts) {
    for (const node of conceptMap.nodes) {
      if (node.kind !== 'effect') continue;
      if (node.payload.kind !== 'effect') continue;
      if (node.payload.subtype !== 'network') continue;
      const target = node.payload.target;
      const method = node.payload.method;
      if (typeof target !== 'string') continue;
      if (typeof method !== 'string') continue;
      // Client must have a fully-resolved query param list to classify.
      if (node.payload.queryParamsResolved !== true) continue;
      const queryParams = node.payload.queryParams;
      if (!queryParams || queryParams.length === 0) continue;
      const clientStrategy = aggregatePaginationStrategy(queryParams);
      // Skip when client uses no anchor or mixes families — the rule fires
      // only when client commits to one family.
      if (clientStrategy !== 'page' && clientStrategy !== 'offset' && clientStrategy !== 'cursor') continue;
      const normalized = normalizeClientUrl(target);
      if (!normalized || !API_PATH_RE.test(normalized)) continue;
      calls.push({ target, normalizedPath: normalized, method, queryParams, clientStrategy, node });
    }
  }
  return calls;
}
