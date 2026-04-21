/**
 * Rule: missing-response-model
 *
 * Fires on Python route decorators that do not declare a FastAPI
 * `response_model=...`. Kept Python-scoped because other route mappers do
 * not currently surface an equivalent response-schema signal.
 */

import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import { CROSS_STACK_HEURISTIC_CONFIDENCE, hasFastApiEvidence } from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

export function missingResponseModel(ctx: ConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  if (!hasFastApiEvidence(ctx.concepts)) return findings;

  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'entrypoint') continue;
    if (node.payload.kind !== 'entrypoint') continue;
    if (node.payload.subtype !== 'route') continue;
    if (node.language !== 'py') continue;
    if (node.payload.responseModel) continue;

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
