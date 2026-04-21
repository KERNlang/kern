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

  // Map each file to the set of containerIds that have an auth guard AND
  // record which files have BOTH guarded and unguarded routes ("mixed").
  // Codex review flagged that file-level presence was too coarse: a file
  // with `/api/me` (guarded) + `/api/public` (not) would false-positive on
  // the public endpoint. The fix: only fire when we can prove the SPECIFIC
  // route is guarded (matching containerId), OR when every route in the
  // file shares the file's guard scope. Mixed files stay silent.
  const authGuardContainers = collectAuthGuardContainers(ctx.allConcepts);
  if (authGuardContainers.size === 0) return [];

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
      if (!route?.node) continue;

      const serverFile = route.node.primarySpan.file;
      const fileGuards = authGuardContainers.get(serverFile);
      if (!fileGuards) continue;

      // Proof that this specific route is guarded:
      //  (a) the route's containerId matches an auth-guard containerId
      //      (FastAPI pattern: `@router.get` + `Depends(...)` share the
      //      function body), OR
      //  (b) the file contains exactly one route (Express pattern: guard
      //      is inside the handler callback, not the app.get call, so
      //      containers differ but there's no ambiguity about which route
      //      the guard protects).
      // Mixed multi-route files with no container match fall through to
      // silent — Codex review called out this false-positive class.
      const routeContainer = route.node.containerId;
      const routeIsGuardedByContainer = routeContainer !== undefined && fileGuards.routeContainers.has(routeContainer);
      const routeIsGuardedBySingleRouteFile = fileGuards.totalRoutesInFile === 1;
      if (!routeIsGuardedByContainer && !routeIsGuardedBySingleRouteFile) continue;

      findings.push({
        source: 'kern',
        ruleId: 'auth-drift',
        severity: 'warning',
        category: 'bug',
        message: `Frontend calls \`${target}\` without an Authorization header, but the server route requires authentication (guard declared in ${shortPath(serverFile)}). Add the Authorization header or change the server guard.`,
        primarySpan: node.primarySpan,
        fingerprint: createFingerprint('auth-drift', node.primarySpan.startLine, node.primarySpan.startCol),
        confidence: node.confidence * CROSS_STACK_EXACT_CONFIDENCE,
      });
    }
  }

  return findings;
}

interface FileAuthInfo {
  /** containerIds that enforce an auth guard. */
  routeContainers: Set<string>;
  /** Total server routes in the file — for the single-route-file fallback. */
  totalRoutesInFile: number;
}

function collectAuthGuardContainers(allConcepts: ReadonlyMap<string, ConceptMap>): Map<string, FileAuthInfo> {
  const result = new Map<string, FileAuthInfo>();
  for (const [filePath, map] of allConcepts) {
    const routeContainers = new Set<string>();
    let routeCount = 0;
    for (const node of map.nodes) {
      if (node.kind === 'entrypoint' && node.payload.kind === 'entrypoint' && node.payload.subtype === 'route') {
        routeCount++;
        continue;
      }
      if (node.kind !== 'guard' || node.payload.kind !== 'guard') continue;
      if (node.payload.subtype !== 'auth') continue;
      // The guard's containerId is the scope that enforces auth. Routes
      // sharing that containerId (same function body) are considered
      // guarded.
      if (node.containerId !== undefined) routeContainers.add(node.containerId);
    }
    if (routeContainers.size > 0) {
      result.set(filePath, { routeContainers, totalRoutesInFile: routeCount });
    }
  }
  return result;
}

function shortPath(filePath: string): string {
  const parts = filePath.split('/');
  return parts.slice(-2).join('/');
}
