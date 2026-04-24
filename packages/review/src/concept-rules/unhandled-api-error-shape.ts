/**
 * Rule: unhandled-api-error-shape
 *
 * Cross-stack rule — fires when a client calls a matching project API route
 * without a visible error path while the backend route can explicitly return
 * an error status such as 401/403/404/422/500.
 */

import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  CROSS_STACK_EXACT_CONFIDENCE,
  collectRoutesAcrossGraph,
  findHighConfidenceRouteForMethod,
  findMatchingRouteForMethod,
  normalizeClientUrl,
} from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

const ERROR_STATUS_CODES = new Set([401, 403, 404, 422, 500]);

export function unhandledApiErrorShape(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (serverRoutes.length === 0) return [];

  const findings: ReviewFinding[] = [];
  const localConcepts = ctx.allConcepts.get(ctx.filePath) ?? ctx.concepts;

  for (const node of localConcepts.nodes) {
    if (node.kind !== 'effect' || node.payload.kind !== 'effect' || node.payload.subtype !== 'network') continue;
    if (node.payload.handlesApiErrors !== false) continue;
    const target = node.payload.target;
    if (typeof target !== 'string') continue;
    const normalized = normalizeClientUrl(target);
    if (!normalized) continue;
    if (!isRawFetchEffect(node.evidence)) continue;

    const route =
      ctx.crossStackMode === 'audit'
        ? findMatchingRouteForMethod(normalized, node.payload.method, serverRoutes)
        : findHighConfidenceRouteForMethod(normalized, node.payload.method, serverRoutes);
    const statusCodes = route?.node?.payload.kind === 'entrypoint' ? route.node.payload.errorStatusCodes : undefined;
    const relevantCodes = (statusCodes ?? []).filter((code) => ERROR_STATUS_CODES.has(code));
    if (relevantCodes.length === 0) continue;

    const codeList = relevantCodes.join('/');
    findings.push({
      source: 'kern',
      ruleId: 'unhandled-api-error-shape',
      severity: 'warning',
      category: 'bug',
      message: `Client calls \`${target}\` with only the success path handled, but the matching server route can return ${codeList}. Add a \`response.ok\`/status branch, catch path, or error UI for the API error shape.`,
      primarySpan: node.primarySpan,
      relatedSpans: route?.node ? [route.node.primarySpan] : undefined,
      fingerprint: createFingerprint(
        'unhandled-api-error-shape',
        node.primarySpan.startLine,
        node.primarySpan.startCol,
      ),
      confidence: node.confidence * CROSS_STACK_EXACT_CONFIDENCE,
    });
  }

  return findings;
}

function isRawFetchEffect(evidence: string): boolean {
  return /^\s*(?:await\s+)?fetch\s*\(/.test(evidence);
}
