/**
 * Rule: orphan-route
 *
 * Cross-stack rule — mirror of contract-drift. Fires when a server-side route
 * exists that no client call in the reviewed graph targets. Real-bug classes:
 *   - Handler was kept live after the frontend renamed the URL it hits.
 *   - Endpoint was written before the UI that would call it (forgotten TODO).
 *   - A dev-only test endpoint made it into production code.
 *
 * v1 scope: path-only match (any client call whose normalized path matches
 * the route template suppresses the finding, regardless of HTTP method). The
 * method axis is left to `contract-method-drift` — compounding both here
 * would double-fire on the same line.
 *
 * Requires graph mode: silent in single-file review. Single-file can't know
 * "no one calls this" because callers live in other files by definition.
 */

import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  API_PATH_RE,
  CROSS_STACK_HEURISTIC_CONFIDENCE,
  collectRoutesAcrossGraph,
  findRoutesAtPath,
  normalizeClientUrl,
} from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

export function orphanRoute(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (serverRoutes.length === 0) return [];

  // Collect every client-call path in the graph once so each route checks
  // against a shared set rather than re-walking allConcepts.
  //
  // Codex review: if ANY network effect has an unresolved target (imported
  // constant, URL builder, variable expression), the rule MUST abstain —
  // the unresolved call could be hitting any of the "orphan" routes and
  // we'd fire a false positive. Only run the rule when every client call
  // is statically resolvable.
  const clientPaths = new Set<string>();
  let hasUnresolvedTarget = false;
  for (const [, conceptMap] of ctx.allConcepts) {
    for (const node of conceptMap.nodes) {
      if (node.kind !== 'effect' || node.payload.kind !== 'effect' || node.payload.subtype !== 'network') continue;
      const target = node.payload.target;
      if (typeof target !== 'string') {
        hasUnresolvedTarget = true;
        continue;
      }
      const normalized = normalizeClientUrl(target);
      if (!normalized) {
        hasUnresolvedTarget = true;
        continue;
      }
      if (!API_PATH_RE.test(normalized)) continue;
      clientPaths.add(normalized);
    }
  }

  // Gate: backend-only project (no client calls) — silent.
  // Gate: any unresolved client targets — silent (Codex P2).
  if (clientPaths.size === 0) return [];
  if (hasUnresolvedTarget) return [];

  const findings: ReviewFinding[] = [];
  const seenFingerprints = new Set<string>();

  for (const route of serverRoutes) {
    if (!route.node || route.node.primarySpan.file !== ctx.filePath) continue;
    if (clientCallMatches(route.path, clientPaths)) continue;

    const fingerprint = createFingerprint(
      'orphan-route',
      route.node.primarySpan.startLine,
      route.node.primarySpan.startCol,
    );
    // Router-mount expansion can cause the same per-file route to surface
    // twice under different prefixes when two mounts share a router (rare
    // but legal). Dedupe by fingerprint so we emit one finding per span.
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);

    const methodLabel = route.method ? `${route.method} ` : '';
    findings.push({
      source: 'kern',
      ruleId: 'orphan-route',
      severity: 'warning',
      category: 'bug',
      message: `Server defines \`${methodLabel}${route.path}\` but no client in the reviewed project calls this path. Either remove the handler or add the frontend caller.`,
      primarySpan: route.node.primarySpan,
      fingerprint,
      confidence: route.node.confidence * CROSS_STACK_HEURISTIC_CONFIDENCE,
    });
  }

  return findings;
}

function clientCallMatches(routePath: string, clientPaths: ReadonlySet<string>): boolean {
  for (const cp of clientPaths) {
    if (findRoutesAtPath(cp, [{ path: routePath, method: undefined }]).length > 0) return true;
  }
  return false;
}
