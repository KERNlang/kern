/**
 * Rule: unrecovered-effect
 *
 * Fires when a network/db effect has no error recovery ancestor.
 * Works on any language that emits effect + error_handle concepts.
 *
 * TS: fetch() without try/catch
 * Python: requests.get() without try/except
 * Go: http.Get() with err ignored
 */

import type { ConceptRuleContext } from './index.js';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';

const RECOVERABLE_DISPOSITIONS = new Set(['wrapped', 'returned', 'rethrown', 'retried']);

export function unrecoveredEffect(ctx: ConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Build a set of containerIds that have error recovery
  const recoveredContainers = new Set<string>();
  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'error_handle') continue;
    if (node.payload.kind !== 'error_handle') continue;
    if (RECOVERABLE_DISPOSITIONS.has(node.payload.disposition) && node.containerId) {
      recoveredContainers.add(node.containerId);
    }
  }

  // Find effects without recovery in the same container
  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'effect') continue;
    if (node.payload.kind !== 'effect') continue;

    const { subtype } = node.payload;
    if (subtype !== 'network' && subtype !== 'db') continue;

    // Check if the container function has error recovery
    if (node.containerId && recoveredContainers.has(node.containerId)) continue;

    // Also check if there's any error_handle in the same container (even logged)
    // Guard: undefined === undefined would match unrelated top-level nodes
    const hasAnyHandler = node.containerId !== undefined && ctx.concepts.nodes.some(n =>
      n.kind === 'error_handle' && n.containerId === node.containerId
    );
    if (hasAnyHandler) continue;

    findings.push({
      source: 'kern',
      ruleId: 'unrecovered-effect',
      severity: 'warning',
      category: 'bug',
      message: `${subtype} effect without error recovery — wrap in try/catch or add .catch()`,
      primarySpan: {
        file: node.primarySpan.file,
        startLine: node.primarySpan.startLine,
        startCol: node.primarySpan.startCol,
        endLine: node.primarySpan.endLine,
        endCol: node.primarySpan.endCol,
      },
      fingerprint: createFingerprint('unrecovered-effect', node.primarySpan.startLine, node.primarySpan.startCol),
      confidence: node.confidence * 0.8, // lower confidence since container scoping is heuristic
    });
  }

  return findings;
}
