/**
 * Rule: unguarded-effect
 *
 * Fires when a network/db effect has no auth/validation guard in the same container.
 * Works on any language that emits effect + guard concepts.
 *
 * TS: fetch() in a route handler without auth/validation
 * Python: requests.get() in a view without auth/validation
 * Go: db.Query() in a handler without auth/validation
 */

import type { ConceptRuleContext } from './index.js';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';

const GUARD_SUBTYPES = new Set(['auth', 'validation']);

export function unguardedEffect(ctx: ConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Build a set of containerIds that have auth/validation guards
  const guardedContainers = new Set<string>();
  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'guard') continue;
    if (node.payload.kind !== 'guard') continue;
    if (!GUARD_SUBTYPES.has(node.payload.subtype)) continue;
    if (node.containerId) {
      guardedContainers.add(node.containerId);
    }
  }

  // Find network/db effects without a guard in the same container
  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'effect') continue;
    if (node.payload.kind !== 'effect') continue;

    const { subtype } = node.payload;
    if (subtype !== 'network' && subtype !== 'db') continue;

    if (node.containerId && guardedContainers.has(node.containerId)) continue;

    findings.push({
      source: 'kern',
      ruleId: 'unguarded-effect',
      severity: 'warning',
      category: 'bug',
      message: `Network/DB effect without auth/validation guard`,
      primarySpan: {
        file: node.primarySpan.file,
        startLine: node.primarySpan.startLine,
        startCol: node.primarySpan.startCol,
        endLine: node.primarySpan.endLine,
        endCol: node.primarySpan.endCol,
      },
      fingerprint: createFingerprint('unguarded-effect', node.primarySpan.startLine, node.primarySpan.startCol),
      confidence: node.confidence * 0.8, // lower confidence since container scoping is heuristic
    });
  }

  return findings;
}
