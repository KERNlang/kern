/**
 * Rule: duplicate-route
 *
 * Server-side rule — fires when two or more route decorators declare the
 * same `{path, method}` combination in the reviewed project. Real-bug
 * classes:
 *   - Someone renamed a handler but forgot to delete the old one; both fire,
 *     order-dependent, one silently shadows the other.
 *   - A copy-paste left an `@router.get("/users")` pair intact.
 *   - A FastAPI router was mounted twice under the same prefix by accident.
 *
 * Fires on the SECOND and later occurrences (the first is the canonical
 * declaration; duplicates are the bug). No-verb routes (`app.use`) key
 * under `ANY` so two `use('/x')` calls still surface as duplicates.
 *
 * Path-only scope: does not cross-correlate client calls. Graph mode only.
 */

import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import { CROSS_STACK_EXACT_CONFIDENCE, collectRoutesAcrossGraph } from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

export function duplicateRoute(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const routes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (routes.length < 2) return [];

  const byKey = new Map<string, typeof routes>();
  for (const r of routes) {
    const key = `${(r.method ?? 'ANY').toUpperCase()} ${r.path}`;
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }

  const findings: ReviewFinding[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const duplicates = list.slice(1);
    for (const dup of duplicates) {
      if (!dup.node || dup.node.primarySpan.file !== ctx.filePath) continue;
      const first = list[0];
      const firstFile = first.node?.primarySpan.file ?? 'another file';
      const firstLine = first.node?.primarySpan.startLine;
      const firstRef = firstLine != null ? `${shortPath(firstFile)}:${firstLine}` : shortPath(firstFile);
      findings.push({
        source: 'kern',
        ruleId: 'duplicate-route',
        severity: 'warning',
        category: 'bug',
        message: `Duplicate route declaration: \`${key}\` is already declared at ${firstRef}. One of the two handlers will silently shadow the other.`,
        primarySpan: dup.node.primarySpan,
        fingerprint: createFingerprint(
          'duplicate-route',
          dup.node.primarySpan.startLine,
          dup.node.primarySpan.startCol,
        ),
        confidence: dup.node.confidence * CROSS_STACK_EXACT_CONFIDENCE,
      });
    }
  }
  return findings;
}

function shortPath(filePath: string): string {
  const parts = filePath.split('/');
  return parts.slice(-2).join('/');
}
