/**
 * Rule: ignored-error
 *
 * Fires when an error is caught/received but not handled.
 * Works on any language that emits error_handle concepts.
 *
 * TS: catch (e) {}
 * Python: except: pass
 * Go: if err != nil {}
 */

import type { ConceptRuleContext } from './index.js';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';

export function ignoredError(ctx: ConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'error_handle') continue;
    if (node.payload.kind !== 'error_handle') continue;
    if (node.payload.disposition !== 'ignored') continue;

    findings.push({
      source: 'kern',
      ruleId: 'ignored-error',
      severity: 'error',
      category: 'bug',
      message: `Error is caught but ignored — handle, log, or rethrow`,
      primarySpan: {
        file: node.primarySpan.file,
        startLine: node.primarySpan.startLine,
        startCol: node.primarySpan.startCol,
        endLine: node.primarySpan.endLine,
        endCol: node.primarySpan.endCol,
      },
      fingerprint: createFingerprint('ignored-error', node.primarySpan.startLine, node.primarySpan.startCol),
      confidence: node.confidence,
    });
  }

  return findings;
}
