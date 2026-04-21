/**
 * Rule: untyped-api-response
 *
 * Cross-stack rule — fires when a frontend (TS) network call targets a
 * server-side route in the reviewed project AND consumes the JSON body
 * without a type annotation, `as T` cast, or `satisfies T` clause.
 *
 * This is rule #2 of the fullstack wedge (TS ↔ Python/Express). The server
 * has a declared response shape (Pydantic `response_model=`, Express
 * `Response<T>`, …) but the client is treating the payload as `any`, which
 * means any breaking change in the response shape will silently rot the
 * frontend at runtime. ESLint can catch "no-explicit-any" at the TS level
 * but it can't tell you *which* fetch() is actually talking to a project
 * endpoint — only the concept graph knows that.
 *
 * Preconditions to fire:
 *   1. Graph mode (`ctx.allConcepts` populated).
 *   2. Client concept has `responseAsserted === false` (mapper proved the
 *      .json() consumption is untyped).
 *   3. The call's target path matches a server-side route in the graph —
 *      otherwise this is just a generic untyped-fetch case, which Biome
 *      already covers and we don't want to duplicate.
 *
 * Kept conservative: when the mapper returns `undefined` for
 * responseAsserted (patterns it couldn't analyze) the rule stays silent.
 * False positives here would poison the pitch.
 */

import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  API_PATH_RE,
  CROSS_STACK_HEURISTIC_CONFIDENCE,
  collectRoutesAcrossGraph,
  hasMatchingRoute,
  normalizeClientUrl,
} from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

export function untypedApiResponse(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (serverRoutes.length === 0) return [];

  const findings: ReviewFinding[] = [];
  // Only scan this file's concepts so we don't duplicate findings per call.
  const localConcepts = ctx.allConcepts.get(ctx.filePath) ?? ctx.concepts;
  for (const node of localConcepts.nodes) {
    if (node.kind !== 'effect' || node.payload.kind !== 'effect' || node.payload.subtype !== 'network') continue;
    if (node.payload.responseAsserted !== false) continue; // undefined stays silent
    const target = node.payload.target;
    if (typeof target !== 'string') continue;
    const normalized = normalizeClientUrl(target);
    if (!normalized || !API_PATH_RE.test(normalized)) continue;
    if (!hasMatchingRoute(normalized, serverRoutes)) continue;

    findings.push({
      source: 'kern',
      ruleId: 'untyped-api-response',
      severity: 'warning',
      category: 'bug',
      message: `Response from \`${target}\` is consumed without a type annotation. The server route defines a response shape — assign the awaited value to a typed variable or use \`as T\` / \`satisfies T\` so response-shape drift is caught at compile time instead of breaking at runtime.`,
      primarySpan: node.primarySpan,
      fingerprint: createFingerprint('untyped-api-response', node.primarySpan.startLine, node.primarySpan.startCol),
      // Same tier as contract-drift. Upgrade once the Python mapper surfaces
      // `response_model=` and we can also cite the specific server type the
      // frontend should be asserting against.
      confidence: node.confidence * CROSS_STACK_HEURISTIC_CONFIDENCE,
    });
  }
  return findings;
}
