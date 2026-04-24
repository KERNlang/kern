/**
 * Rule: auth-propagation-drift
 *
 * Cross-stack rule — complements `auth-drift` by catching non-raw-fetch API
 * clients (axios/got/ky-style direct calls) that call an authenticated server
 * route without visible auth/session propagation.
 */

import type { ConceptMap } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  CROSS_STACK_EXACT_CONFIDENCE,
  collectRoutesAcrossGraph,
  findHighConfidenceRouteForMethod,
  findMatchingRouteForMethod,
  normalizeClientUrl,
} from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

export function authPropagationDrift(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (serverRoutes.length === 0) return [];

  const authGuardContainers = collectAuthGuardContainers(ctx.allConcepts);
  if (authGuardContainers.size === 0) return [];

  const findings: ReviewFinding[] = [];
  const localConcepts = ctx.allConcepts.get(ctx.filePath) ?? ctx.concepts;

  for (const node of localConcepts.nodes) {
    if (node.kind !== 'effect' || node.payload.kind !== 'effect' || node.payload.subtype !== 'network') continue;
    if (node.payload.authPropagation !== 'absent') continue;
    // `auth-drift` owns the raw fetch/no Authorization case for backward
    // compatibility with the existing rule ID. This rule covers richer clients.
    if (node.payload.hasAuthHeader === false) continue;
    const target = node.payload.target;
    if (typeof target !== 'string') continue;
    const normalized = normalizeClientUrl(target);
    if (!normalized) continue;

    const route =
      ctx.crossStackMode === 'audit'
        ? findMatchingRouteForMethod(normalized, node.payload.method, serverRoutes)
        : findHighConfidenceRouteForMethod(normalized, node.payload.method, serverRoutes);
    if (!route?.node) continue;
    const fileGuards = authGuardContainers.get(route.node.primarySpan.file);
    if (!fileGuards) continue;

    const routeContainer = route.node.containerId;
    const guardedByContainer = routeContainer !== undefined && fileGuards.routeContainers.has(routeContainer);
    const guardedBySingleRouteFile = fileGuards.totalRoutesInFile === 1;
    if (!guardedByContainer && !guardedBySingleRouteFile) continue;

    findings.push({
      source: 'kern',
      ruleId: 'auth-propagation-drift',
      severity: 'warning',
      category: 'bug',
      message: `Client calls authenticated route \`${target}\` without visible auth/session propagation. Add an Authorization/Cookie/session credential path or route this call through an authenticated client wrapper.`,
      primarySpan: node.primarySpan,
      relatedSpans: [route.node.primarySpan],
      fingerprint: createFingerprint('auth-propagation-drift', node.primarySpan.startLine, node.primarySpan.startCol),
      confidence: node.confidence * CROSS_STACK_EXACT_CONFIDENCE,
    });
  }

  return findings;
}

interface FileAuthInfo {
  routeContainers: Set<string>;
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
      if (node.kind !== 'guard' || node.payload.kind !== 'guard' || node.payload.subtype !== 'auth') continue;
      if (node.containerId !== undefined) routeContainers.add(node.containerId);
    }
    if (routeContainers.size > 0) result.set(filePath, { routeContainers, totalRoutesInFile: routeCount });
  }
  return result;
}
