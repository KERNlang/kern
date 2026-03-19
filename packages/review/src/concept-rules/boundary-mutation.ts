/**
 * Rule: boundary-mutation
 *
 * Fires when a state mutation targets global/shared scope.
 * Works on any language that emits state_mutation concepts.
 *
 * TS: mutating a global cache or shared singleton
 * Python: mutating a shared module-level dict
 * Go: mutating shared package-level state
 */

import type { ConceptRuleContext } from './index.js';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';

export function boundaryMutation(ctx: ConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'state_mutation') continue;
    if (node.payload.kind !== 'state_mutation') continue;
    if (node.payload.scope !== 'global' && node.payload.scope !== 'shared') continue;

    findings.push({
      source: 'kern',
      ruleId: 'boundary-mutation',
      severity: 'warning',
      category: 'pattern',
      message: `Global/shared state mutation — consider encapsulating in a store or module`,
      primarySpan: {
        file: node.primarySpan.file,
        startLine: node.primarySpan.startLine,
        startCol: node.primarySpan.startCol,
        endLine: node.primarySpan.endLine,
        endCol: node.primarySpan.endCol,
      },
      fingerprint: createFingerprint('boundary-mutation', node.primarySpan.startLine, node.primarySpan.startCol),
      confidence: node.confidence,
    });
  }

  return findings;
}
