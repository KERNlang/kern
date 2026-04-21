/**
 * Rule: auth-drift
 *
 * Cross-stack rule — fires when a frontend network call targets a server
 * route file that declares an auth guard (FastAPI `Depends(get_current_user)`,
 * Flask `@login_required`, early-return `if (!req.user)` Express patterns),
 * but the client call sends no Authorization header.
 *
 * Real-bug classes:
 *   - Protected endpoint called from a public page or before login finished.
 *   - Frontend forgot to add the Bearer token after a refactor that moved
 *     auth out of a wrapper.
 *   - Endpoint was auth-gated late in the PR but the client still fires
 *     unauthenticated.
 *
 * v1 scope:
 *   - Only fires on raw `fetch(...)`. Wrapped clients typically inject auth
 *     inside the wrapper; the TS mapper already reports
 *     `hasAuthHeader: undefined` for them.
 *   - Auth guard is "present" when any guard concept of subtype 'auth' lives
 *     in the same file as a matching server route. File granularity is
 *     coarse on purpose — FastAPI's idiomatic `APIRouter(dependencies=[...])`
 *     puts the guard on the router, not each handler.
 *
 * Confidence: `CROSS_STACK_EXACT_CONFIDENCE` (0.9). Graph mode only.
 */

import type { ConceptMap } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  API_PATH_RE,
  CROSS_STACK_EXACT_CONFIDENCE,
  collectRoutesAcrossGraph,
  findMatchingRoute,
  normalizeClientUrl,
} from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

export function authDrift(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (serverRoutes.length === 0) return [];

  const filesWithAuth = collectFilesWithAuthGuard(ctx.allConcepts);
  if (filesWithAuth.size === 0) return [];

  const findings: ReviewFinding[] = [];

  for (const [, conceptMap] of ctx.allConcepts) {
    for (const node of conceptMap.nodes) {
      if (node.kind !== 'effect' || node.payload.kind !== 'effect' || node.payload.subtype !== 'network') continue;
      if (node.primarySpan.file !== ctx.filePath) continue;
      // Must be explicitly `false`. `undefined` = mapper couldn't tell; stay silent.
      if (node.payload.hasAuthHeader !== false) continue;
      const target = node.payload.target;
      if (typeof target !== 'string') continue;
      const normalized = normalizeClientUrl(target);
      if (!normalized || !API_PATH_RE.test(normalized)) continue;

      const route = findMatchingRoute(normalized, serverRoutes);
      if (!route || !route.node) continue;
      if (!filesWithAuth.has(route.node.primarySpan.file)) continue;

      findings.push({
        source: 'kern',
        ruleId: 'auth-drift',
        severity: 'warning',
        category: 'bug',
        message: `Frontend calls \`${target}\` without an Authorization header, but the server route requires authentication (guard declared in ${shortPath(route.node.primarySpan.file)}). Add the Authorization header or change the server guard.`,
        primarySpan: node.primarySpan,
        fingerprint: createFingerprint('auth-drift', node.primarySpan.startLine, node.primarySpan.startCol),
        confidence: node.confidence * CROSS_STACK_EXACT_CONFIDENCE,
      });
    }
  }

  return findings;
}

function collectFilesWithAuthGuard(allConcepts: ReadonlyMap<string, ConceptMap>): Set<string> {
  const set = new Set<string>();
  for (const [filePath, map] of allConcepts) {
    for (const node of map.nodes) {
      if (node.kind !== 'guard' || node.payload.kind !== 'guard') continue;
      if (node.payload.subtype !== 'auth') continue;
      set.add(filePath);
      break;
    }
  }
  return set;
}

function shortPath(filePath: string): string {
  const parts = filePath.split('/');
  return parts.slice(-2).join('/');
}
