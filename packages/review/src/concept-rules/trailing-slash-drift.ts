/**
 * Rule: trailing-slash-drift
 *
 * Cross-stack rule — fires when a frontend network call uses a path that
 * differs from a defined server route only by the presence/absence of a
 * trailing slash. Common production foot-gun:
 *
 *   - FastAPI normalises trailing slashes via redirect_slashes=True (default
 *     on), but a 307 redirect strips the request body / Authorization header
 *     in many clients — so `POST /api/users/` against `/api/users` silently
 *     loses payload.
 *   - Express does NOT normalise — `/api/users/` ≠ `/api/users` and one of
 *     them returns 404 depending on which side declared which.
 *   - Next.js App Router treats them as distinct routes when
 *     `trailingSlash: false` (default).
 *
 * Sibling to `contract-drift` and `contract-method-drift`. Distinct rule
 * because the message and fix are specific (drop or add the trailing slash)
 * and the fingerprint must be separable.
 *
 * Confidence multiplier: `CROSS_STACK_EXACT_CONFIDENCE` (0.9). Once the
 * normalised paths match modulo the trailing slash, this is unambiguous.
 *
 * Requires graph mode; silent in single-file review.
 */

import type { ConceptNode } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  API_PATH_RE,
  CROSS_STACK_EXACT_CONFIDENCE,
  collectRoutesAcrossGraph,
  findRoutesAtPath,
  normalizeClientUrl,
} from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';
import { apiCallRootCause } from './root-cause.js';

interface ClientCall {
  target: string;
  normalizedPath: string;
  method: string;
  node: ConceptNode;
}

export function trailingSlashDrift(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (serverRoutes.length === 0) return [];

  const clientCalls: ClientCall[] = [];
  for (const [, conceptMap] of ctx.allConcepts) {
    for (const node of conceptMap.nodes) {
      if (node.kind !== 'effect' || node.payload.kind !== 'effect' || node.payload.subtype !== 'network') continue;
      const target = node.payload.target;
      const method = node.payload.method;
      if (typeof target !== 'string' || typeof method !== 'string') continue;
      const normalized = normalizeClientUrl(target);
      if (!normalized || !API_PATH_RE.test(normalized)) continue;
      clientCalls.push({ target, normalizedPath: normalized, method, node });
    }
  }
  if (clientCalls.length === 0) return [];

  const findings: ReviewFinding[] = [];
  for (const call of clientCalls) {
    if (call.node.primarySpan.file !== ctx.filePath) continue;

    // The shared matcher trims trailing slashes when comparing paths, so a
    // /api/users/ client call already matches an /api/users server route.
    // Use that as the candidate filter, then compare slash policy strictly.
    const candidates = findRoutesAtPath(call.normalizedPath, serverRoutes);
    if (candidates.length === 0) continue; // path doesn't exist server-side — that's contract-drift territory

    const clientHasSlash = pathEndsWithSlash(call.normalizedPath);
    const slashMatchExists = candidates.some((r) => pathEndsWithSlash(r.path) === clientHasSlash);
    if (slashMatchExists) continue; // some route agrees on slash policy — no drift

    // All candidates disagree with the client on trailing-slash policy.
    const driftRoute = candidates[0];
    const fixHint = clientHasSlash
      ? `Drop the trailing slash: \`${call.method} ${stripTrailingSlash(call.target)}\``
      : `The server route is declared as \`${driftRoute.path}\` (with trailing slash) — align the client URL, or remove the trailing slash from the route declaration`;

    findings.push({
      source: 'kern',
      ruleId: 'trailing-slash-drift',
      severity: 'warning',
      category: 'bug',
      message: `\`${call.method} ${call.target}\` differs from the matching server route \`${driftRoute.path}\` only by trailing slash. ${fixHint}.`,
      primarySpan: call.node.primarySpan,
      fingerprint: createFingerprint(
        'trailing-slash-drift',
        call.node.primarySpan.startLine,
        call.node.primarySpan.startCol,
      ),
      confidence: call.node.confidence * CROSS_STACK_EXACT_CONFIDENCE,
      rootCause: apiCallRootCause(call.node, call.normalizedPath, call.method, driftRoute.node),
    });
  }
  return findings;
}

function pathEndsWithSlash(path: string): boolean {
  return path.length > 1 && path.endsWith('/');
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}
