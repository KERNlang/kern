/**
 * Rule: contract-drift
 *
 * Cross-stack rule — fires when a frontend (TS) network call targets an API
 * path that has no matching server-side route in the reviewed project.
 *
 * This is the moat rule for TS ↔ Python projects: Pydantic schemas drift,
 * endpoints get renamed, frontend hits `/api/users/:id` but the FastAPI
 * handler was moved to `/api/v2/users/:id`. ESLint and Bandit can't see
 * this because they each only see one side of the wire.
 *
 * v1 scope: URL-path drift only (is there a server for this client?). Body
 * shape / Pydantic field correlation is a follow-up once the mappers emit
 * body concepts — see the TODO comments in ts-concepts.ts / review-python.
 *
 * Requires graph mode: `ctx.allConcepts` must be populated. Single-file
 * review silently returns no findings (can't correlate from one file).
 */

import type { ConceptNode } from '@kernlang/core';
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

interface ClientCall {
  target: string;
  normalizedPath: string;
  node: ConceptNode;
}

export function contractDrift(ctx: ConceptRuleContext): ReviewFinding[] {
  // Graph mode only — URL correlation is useless within a single file.
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes: ServerRoute[] = [];
  const clientCalls: ClientCall[] = [];

  for (const [, conceptMap] of ctx.allConcepts) {
    collectRoutes(conceptMap, serverRoutes);
    for (const node of conceptMap.nodes) {
      if (node.kind !== 'effect' || node.payload.kind !== 'effect' || node.payload.subtype !== 'network') continue;
      const target = node.payload.target;
      if (typeof target !== 'string') continue;
      const normalized = normalizeClientUrl(target);
      if (!normalized || !API_PATH_RE.test(normalized)) continue;
      clientCalls.push({ target, normalizedPath: normalized, node });
    }
  }

  // Rule gate: need at least one route AND one client call, otherwise the
  // project isn't a full-stack app and we'd fire on every external API hit.
  if (serverRoutes.length === 0 || clientCalls.length === 0) return [];

  const findings: ReviewFinding[] = [];

  for (const call of clientCalls) {
    // Only report on calls that happen in files from the reviewed project —
    // avoids firing on third-party SDK targets.
    if (call.node.primarySpan.file !== ctx.filePath) continue;
    if (hasMatchingRoute(call.normalizedPath, serverRoutes)) continue;

    findings.push({
      source: 'kern',
      ruleId: 'contract-drift',
      severity: 'warning',
      category: 'bug',
      message: `Frontend calls \`${call.target}\` but no server-side route matches this path in the reviewed project. Either the endpoint was renamed/removed on the backend or the frontend is targeting the wrong URL.`,
      primarySpan: call.node.primarySpan,
      fingerprint: createFingerprint('contract-drift', call.node.primarySpan.startLine, call.node.primarySpan.startCol),
      confidence: call.node.confidence * CROSS_STACK_HEURISTIC_CONFIDENCE,
    });
  }

  return findings;
}
