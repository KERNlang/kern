/**
 * Rule: untyped-both-ends-response
 *
 * Cross-stack linker for the response typing wedge. Fires when the client
 * consumes a matching API response without a type assertion and the Python
 * server route also has no `response_model=...`.
 */

import type { ConceptMap } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  API_PATH_RE,
  CROSS_STACK_HEURISTIC_CONFIDENCE,
  collectRoutesAcrossGraph,
  findMatchingRoute,
  isFastApiRouteMissingResponseModel,
  normalizeClientUrl,
  type ServerRoute,
} from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

export function untypedBothEndsResponse(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];
  const allConcepts = ctx.allConcepts;

  const routesMissingModel = collectRoutesAcrossGraph(allConcepts).filter((route) =>
    routeMissingResponseModel(route, allConcepts),
  );
  if (routesMissingModel.length === 0) return [];

  const findings: ReviewFinding[] = [];
  const localConcepts = allConcepts.get(ctx.filePath) ?? ctx.concepts;

  for (const node of localConcepts.nodes) {
    if (node.language !== 'ts') continue;
    if (node.kind !== 'effect' || node.payload.kind !== 'effect' || node.payload.subtype !== 'network') continue;
    if (node.payload.responseAsserted !== false) continue;
    const target = node.payload.target;
    if (typeof target !== 'string') continue;
    const normalized = normalizeClientUrl(target);
    if (!normalized || !API_PATH_RE.test(normalized)) continue;
    const matchedRoute = findMatchingRoute(normalized, routesMissingModel);
    if (!matchedRoute?.node) continue;

    findings.push({
      source: 'kern',
      ruleId: 'untyped-both-ends-response',
      severity: 'warning',
      category: 'bug',
      message: `Response for \`${target}\` is untyped on both ends: the client consumes it without a type assertion and the matching backend route has no response_model.`,
      primarySpan: node.primarySpan,
      relatedSpans: [matchedRoute.node.primarySpan],
      fingerprint: createFingerprint(
        'untyped-both-ends-response',
        node.primarySpan.startLine,
        node.primarySpan.startCol,
      ),
      confidence: Math.min(node.confidence, matchedRoute.node.confidence) * CROSS_STACK_HEURISTIC_CONFIDENCE,
    });
  }

  return findings;
}

function routeMissingResponseModel(route: ServerRoute, allConcepts: ReadonlyMap<string, ConceptMap>): boolean {
  const node = route.node;
  if (!node) return false;
  return isFastApiRouteMissingResponseModel(node, allConcepts.get(node.primarySpan.file));
}
