/**
 * Rule: contract-method-drift
 *
 * Cross-stack rule — fires when a frontend network call targets an API path
 * the server DOES define, but only for different HTTP methods. Sibling to
 * `contract-drift`:
 *   - contract-drift        : "no server route exists at this path"
 *   - contract-method-drift : "server routes exist at this path, just not
 *                             for your verb"
 *
 * Keeping them separate matters: the messages and fixes differ (rename the
 * client URL vs. change the verb), the fingerprints can't collide on the
 * same line, and the existing contract-drift `continue` gate stays intact.
 *
 * Confidence multiplier: `CROSS_STACK_EXACT_CONFIDENCE` (0.9) — once the path
 * matches, a method mismatch is unambiguous.
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

interface ClientCall {
  target: string;
  normalizedPath: string;
  method: string;
  node: ConceptNode;
}

// Verbs the TS/Python mappers emit for handlers that intentionally accept any
// method (Express `app.all()` emits `ALL`; `app.use()` emits `undefined`).
const WILDCARD_METHODS = new Set(['ALL', 'ANY']);

export function contractMethodDrift(ctx: ConceptRuleContext): ReviewFinding[] {
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
    const routesAtPath = findRoutesAtPath(call.normalizedPath, serverRoutes);
    if (routesAtPath.length === 0) continue;
    const hasMethodMatch = routesAtPath.some((r) => methodMatches(r.method, call.method));
    if (hasMethodMatch) continue;

    const serverMethods = collectKnownMethods(routesAtPath);
    if (serverMethods.length === 0) continue;

    const methodList = serverMethods.join(', ');
    const hint = serverMethods.length === 1 ? ` Did you mean \`${serverMethods[0]} ${call.target}\`?` : '';
    findings.push({
      source: 'kern',
      ruleId: 'contract-method-drift',
      severity: 'warning',
      category: 'bug',
      message: `Frontend calls \`${call.method} ${call.target}\` but the server only defines [${methodList}] for this path.${hint}`,
      primarySpan: call.node.primarySpan,
      fingerprint: createFingerprint(
        'contract-method-drift',
        call.node.primarySpan.startLine,
        call.node.primarySpan.startCol,
      ),
      confidence: call.node.confidence * CROSS_STACK_EXACT_CONFIDENCE,
    });
  }
  return findings;
}

function methodMatches(routeMethod: string | undefined, clientMethod: string): boolean {
  if (!routeMethod) return true;
  const r = routeMethod.toUpperCase();
  if (WILDCARD_METHODS.has(r)) return true;
  const c = clientMethod.toUpperCase();
  if (r === c) return true;
  // Express and Starlette/FastAPI both auto-respond to HEAD on GET routes
  // (returning headers, no body). Firing method-drift on `HEAD /api/x`
  // against `app.get('/api/x')` is a false positive — the server DOES
  // satisfy the request. Codex review called this out.
  if (c === 'HEAD' && r === 'GET') return true;
  return false;
}

function collectKnownMethods(routes: readonly { method: string | undefined }[]): string[] {
  const set = new Set<string>();
  for (const r of routes) {
    if (!r.method) continue;
    const m = r.method.toUpperCase();
    if (WILDCARD_METHODS.has(m)) continue;
    set.add(m);
  }
  return Array.from(set).sort();
}
