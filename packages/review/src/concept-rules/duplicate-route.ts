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

  // Group by `${METHOD} ${path}` for exact duplicates, BUT wildcard routes
  // (`ALL`/`ANY`/undefined) shadow specific verbs on the same path. Codex
  // review caught that the naïve keying missed `app.all('/x')` +
  // `app.get('/x')` collisions. We do two passes:
  //   1. Group routes at each path by wildcard-vs-specific classification.
  //   2. Within a path, if there's a wildcard route AND any specific verb
  //      route, they collide (pick the later one as the "duplicate").
  //   3. Also flag same-path-same-method duplicates as before.
  const byKey = new Map<string, typeof routes>();
  const byPath = new Map<string, typeof routes>();
  for (const r of routes) {
    const method = (r.method ?? 'ANY').toUpperCase();
    const key = `${method} ${r.path}`;
    const keyList = byKey.get(key) ?? [];
    keyList.push(r);
    byKey.set(key, keyList);
    const pathList = byPath.get(r.path) ?? [];
    pathList.push(r);
    byPath.set(r.path, pathList);
  }

  // Wildcard-vs-specific collisions: when a path has a wildcard-accepting
  // route and any specific-verb route, the handlers shadow each other.
  const WILDCARD = new Set(['ALL', 'ANY']);
  for (const [, pathRoutes] of byPath) {
    if (pathRoutes.length < 2) continue;
    const wildcards = pathRoutes.filter((r) => {
      const m = (r.method ?? 'ANY').toUpperCase();
      return WILDCARD.has(m);
    });
    if (wildcards.length === 0) continue;
    // Synthesize a collision key so the existing emission loop fires.
    // Keep the wildcard as canonical (first), flag every specific-verb route
    // on this path as the duplicate.
    const specifics = pathRoutes.filter((r) => {
      const m = (r.method ?? 'ANY').toUpperCase();
      return !WILDCARD.has(m);
    });
    if (specifics.length === 0) continue;
    const collisionKey = `* ${wildcards[0].path}`;
    if (!byKey.has(collisionKey)) byKey.set(collisionKey, [wildcards[0], ...specifics]);
  }

  const findings: ReviewFinding[] = [];
  const seen = new Set<string>();
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const isWildcardCollision = key.startsWith('* ');
    const duplicates = list.slice(1);
    for (const dup of duplicates) {
      if (!dup.node || dup.node.primarySpan.file !== ctx.filePath) continue;
      const fingerprint = createFingerprint(
        'duplicate-route',
        dup.node.primarySpan.startLine,
        dup.node.primarySpan.startCol,
      );
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      const first = list[0];
      const firstFile = first.node?.primarySpan.file ?? 'another file';
      const firstLine = first.node?.primarySpan.startLine;
      const firstRef = firstLine != null ? `${shortPath(firstFile)}:${firstLine}` : shortPath(firstFile);
      const firstMethod = (first.method ?? 'ANY').toUpperCase();
      const dupMethod = (dup.method ?? 'ANY').toUpperCase();
      const message = isWildcardCollision
        ? `Route \`${dupMethod} ${dup.path}\` is shadowed by wildcard route \`${firstMethod} ${dup.path}\` at ${firstRef}. The wildcard handler will match ${dupMethod} requests depending on registration order.`
        : `Duplicate route declaration: \`${key}\` is already declared at ${firstRef}. One of the two handlers will silently shadow the other.`;
      findings.push({
        source: 'kern',
        ruleId: 'duplicate-route',
        severity: 'warning',
        category: 'bug',
        message,
        primarySpan: dup.node.primarySpan,
        fingerprint,
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
