/**
 * Rule: missing-response-model
 *
 * Fires on Python route decorators that do not declare a FastAPI
 * `response_model=...`. Kept Python-scoped because other route mappers do
 * not currently surface an equivalent response-schema signal.
 */

import { classifyFileRoleByPath } from '../file-role.js';
import { isNonJsonFastApiResponseClass } from '../python-response-contract.js';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import { CROSS_STACK_HEURISTIC_CONFIDENCE, collectRoutesAcrossGraph, hasFastApiEvidence } from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

export function missingResponseModel(ctx: ConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  if (!hasFastApiEvidence(ctx.concepts)) return findings;
  const fileRole = classifyFileRoleByPath(ctx.filePath);
  if (fileRole === 'test') return findings;
  const graphRoutes = ctx.allConcepts ? collectRoutesAcrossGraph(ctx.allConcepts) : undefined;

  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'entrypoint') continue;
    if (node.payload.kind !== 'entrypoint') continue;
    if (node.payload.subtype !== 'route') continue;
    if (node.language !== 'py') continue;
    if (node.payload.responseModel) continue;
    if (node.payload.includeInSchema === false) continue;
    if (isNonJsonFastApiResponseClass(node.payload.responseClass)) continue;
    const effectiveRoutes = graphRoutes?.filter((route) => route.node?.id === node.id);
    if (fileRole === 'example') {
      const publiclyMounted = effectiveRoutes?.some((route) => route.mounted && route.includeInSchema !== false);
      if (!publiclyMounted) continue;
    }
    if (effectiveRoutes?.length && effectiveRoutes.every((route) => route.includeInSchema === false)) continue;

    findings.push({
      source: 'kern',
      ruleId: 'missing-response-model',
      severity: 'warning',
      category: 'bug',
      message: `Route \`${node.payload.name}\` has no FastAPI response_model. Add response_model=... so backend response-shape drift is caught at the contract boundary.`,
      primarySpan: node.primarySpan,
      fingerprint: createFingerprint('missing-response-model', node.primarySpan.startLine, node.primarySpan.startCol),
      confidence: node.confidence * CROSS_STACK_HEURISTIC_CONFIDENCE,
    });
  }

  return findings;
}
