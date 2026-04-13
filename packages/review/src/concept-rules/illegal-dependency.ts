/**
 * Rule: illegal-dependency
 *
 * Fires when an internal dependency reaches too far up the directory tree.
 * Works on any language that emits dependency concepts.
 *
 * TS: import x from '../../../shared/module'
 * Python: from ...core.shared import x
 * Go: internal import path that walks too far upward
 */

import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import type { ConceptRuleContext } from './index.js';

export function illegalDependency(ctx: ConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const edge of ctx.concepts.edges) {
    if (edge.kind !== 'dependency') continue;
    if (edge.payload.kind !== 'dependency') continue;
    if (edge.payload.subtype !== 'internal') continue;

    const upLevels = countUpLevels(edge.payload.specifier);
    if (upLevels <= 2) continue;

    findings.push({
      source: 'kern',
      ruleId: 'illegal-dependency',
      severity: 'warning',
      category: 'structure',
      message: `Deep cross-boundary import — may violate module architecture`,
      primarySpan: {
        file: edge.primarySpan.file,
        startLine: edge.primarySpan.startLine,
        startCol: edge.primarySpan.startCol,
        endLine: edge.primarySpan.endLine,
        endCol: edge.primarySpan.endCol,
      },
      fingerprint: createFingerprint('illegal-dependency', edge.primarySpan.startLine, edge.primarySpan.startCol),
      confidence: edge.confidence * 0.8, // lower confidence since this is a path-depth heuristic
    });
  }

  return findings;
}

function countUpLevels(specifier: string): number {
  const match = specifier.match(/^(\.\.\/)+/);
  if (!match) return 0;
  return match[0].length / 3;
}
