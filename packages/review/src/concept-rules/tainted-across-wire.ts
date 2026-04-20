/**
 * Rule: tainted-across-wire
 *
 * Cross-stack rule — fires when a frontend (TS) network call sends a
 * dynamic (user-controlled) body to a server-side route in the reviewed
 * project AND that route's handler has no validation guard in scope.
 *
 * This is rule #3 of the fullstack wedge. Pure server-side taint analysis
 * (already in @kernlang/review's taint-crossfile module) finds sinks
 * reachable from `req.body`, but it can't see the *client-side call site*
 * that's feeding the unvalidated input. And pure client-side analysis
 * doesn't know whether the server validates — so it either fires on every
 * dynamic POST (noise) or on none (misses the moat).
 *
 * By correlating both sides via the concept graph we can fire precisely:
 * "here's the fetch that sends user input to an endpoint whose handler
 * doesn't parse it with zod/yup/joi/pydantic". The finding lands on the
 * client-side call so the fix is visible where the developer is working.
 *
 * Preconditions to fire:
 *   1. Graph mode (`ctx.allConcepts` populated).
 *   2. Client concept has `bodyKind === 'dynamic'` — we know real data is
 *      crossing the wire, not a ping/HEAD/etc.
 *   3. Client target path matches a server route in the graph.
 *   4. That server route's container has NO `guard` concept with
 *      `subtype === 'validation'` (schema.parse / zod.parse / …).
 *
 * Silent on `bodyKind === undefined` (mapper couldn't classify) and on
 * missing server matches (contract-drift owns that class).
 */

import type { ConceptMap, ConceptNode } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  API_PATH_RE,
  CROSS_STACK_HEURISTIC_CONFIDENCE,
  collectRoutes,
  hasMatchingRoute,
  normalizeClientUrl,
  type ServerRoute,
} from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

export function taintedAcrossWire(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes: ServerRoute[] = [];
  for (const [, conceptMap] of ctx.allConcepts) {
    collectRoutes(conceptMap, serverRoutes);
  }
  if (serverRoutes.length === 0) return [];

  // Build the set of files that contain at least one validation guard.
  // Container-level matching is too strict: zod/yup parsers typically live
  // inside the route callback body (arrow function container) while the
  // route entrypoint itself is emitted at the call-expression level (module
  // container). File-level matching is coarser but safer — it silences the
  // common case where a validator exists in the same server file as the
  // route, which is a strong signal the handler is guarded. False negatives
  // (a validation-less route in a file that validates *other* routes) cost
  // us less than false positives on the pitch.
  const validatedFiles = collectValidatedFiles(ctx.allConcepts);

  const findings: ReviewFinding[] = [];
  const localConcepts = ctx.allConcepts.get(ctx.filePath) ?? ctx.concepts;

  for (const node of localConcepts.nodes) {
    if (node.kind !== 'effect' || node.payload.kind !== 'effect' || node.payload.subtype !== 'network') continue;
    if (node.payload.bodyKind !== 'dynamic') continue;
    const target = node.payload.target;
    if (typeof target !== 'string') continue;
    const normalized = normalizeClientUrl(target);
    if (!normalized || !API_PATH_RE.test(normalized)) continue;
    const matchedRoute = findMatchingRoute(normalized, serverRoutes);
    if (!matchedRoute) continue;
    const routeFile = matchedRoute.node?.primarySpan.file;
    if (routeFile && validatedFiles.has(routeFile)) continue;

    findings.push({
      source: 'kern',
      ruleId: 'tainted-across-wire',
      severity: 'warning',
      category: 'pattern',
      message: `Dynamic body sent to \`${target}\` but the matching server route has no validation guard (schema.parse / zod / yup / pydantic). Add a validator on the server before trusting the payload, or move validation to the client if this endpoint is internal-only.`,
      primarySpan: node.primarySpan,
      fingerprint: createFingerprint('tainted-across-wire', node.primarySpan.startLine, node.primarySpan.startCol),
      confidence: node.confidence * CROSS_STACK_HEURISTIC_CONFIDENCE,
    });
  }

  return findings;
}

function collectValidatedFiles(allConcepts: Map<string, ConceptMap>): Set<string> {
  const set = new Set<string>();
  for (const [file, conceptMap] of allConcepts) {
    for (const node of conceptMap.nodes as ConceptNode[]) {
      if (node.kind !== 'guard' || node.payload.kind !== 'guard') continue;
      if (node.payload.subtype !== 'validation') continue;
      set.add(file);
      break;
    }
  }
  return set;
}

/** Same matching logic as `hasMatchingRoute` but returns the route (for its containerId). */
function findMatchingRoute(clientPath: string, routes: readonly ServerRoute[]): ServerRoute | undefined {
  for (const route of routes) {
    if (hasMatchingRoute(clientPath, [route])) return route;
  }
  return undefined;
}
