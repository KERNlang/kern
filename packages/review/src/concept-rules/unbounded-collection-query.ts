/**
 * Rule: unbounded-collection-query
 *
 * Cross-stack rule — fires when a client calls a list endpoint without
 * page/cursor/limit parameters and the matching server route appears to return
 * a DB-backed collection without a bound.
 */

import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  CROSS_STACK_HEURISTIC_CONFIDENCE,
  collectRoutesAcrossGraph,
  findHighConfidenceRouteForMethod,
  findMatchingRouteForMethod,
  normalizeClientUrl,
} from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

const PAGINATION_QUERY_PARAMS = new Set(['limit', 'take', 'page', 'pageSize', 'perPage', 'cursor', 'offset', 'skip']);

export function unboundedCollectionQuery(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (serverRoutes.length === 0) return [];

  const findings: ReviewFinding[] = [];
  const localConcepts = ctx.allConcepts.get(ctx.filePath) ?? ctx.concepts;

  for (const node of localConcepts.nodes) {
    if (node.kind !== 'effect' || node.payload.kind !== 'effect' || node.payload.subtype !== 'network') continue;
    if (node.payload.queryParamsResolved !== true) continue;
    if (hasPaginationParam(node.payload.queryParams ?? [])) continue;
    const target = node.payload.target;
    if (typeof target !== 'string') continue;
    const normalized = normalizeClientUrl(target);
    if (!normalized) continue;

    const route =
      ctx.crossStackMode === 'audit'
        ? findMatchingRouteForMethod(normalized, node.payload.method, serverRoutes)
        : findHighConfidenceRouteForMethod(normalized, node.payload.method, serverRoutes);
    if (route?.node?.payload.kind !== 'entrypoint') continue;
    if (route.node.payload.hasUnboundedCollectionQuery !== true) continue;

    findings.push({
      source: 'kern',
      ruleId: 'unbounded-collection-query',
      severity: 'warning',
      category: 'bug',
      message: `Client calls list endpoint \`${target}\` without page/cursor/limit parameters, and the matching server route appears to return an unbounded DB collection. Add pagination on both sides before this endpoint grows.`,
      primarySpan: node.primarySpan,
      fingerprint: createFingerprint(
        'unbounded-collection-query',
        node.primarySpan.startLine,
        node.primarySpan.startCol,
      ),
      confidence: node.confidence * CROSS_STACK_HEURISTIC_CONFIDENCE,
    });
  }

  return findings;
}

function hasPaginationParam(params: readonly string[]): boolean {
  return params.some((param) => PAGINATION_QUERY_PARAMS.has(param));
}
