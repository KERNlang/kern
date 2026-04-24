/**
 * Rule: body-shape-drift
 *
 * Cross-stack rule — fires when a client `fetch(url, { body: JSON.stringify({ … }) })`
 * omits one or more fields that the matching server handler reads off
 * `req.body` (Express inline handler). Classic LLM-authored drift:
 *
 *   client:   fetch('/api/users', { body: JSON.stringify({ name }) })
 *   server:   app.post('/api/users', (req, res) => {
 *               const { name, email } = req.body;   // ← email never sent
 *               ...
 *             });
 *
 * V1 is deliberately narrow per the red-team consensus on the body-shape
 * plan:
 *   - Express only (no Pydantic/FastAPI cross-file model resolution).
 *   - Raw `fetch` only on the client (no axios/ky/got/wrapper clients).
 *   - Inline handlers only (imported-identifier handlers stay silent).
 *   - Missing-fields direction only (client omits what server needs). The
 *     "extra" direction (client sends what server ignores) conflicts with
 *     legitimate pass-through handlers and is deferred.
 *   - Fires only when BOTH `sentFieldsResolved` and `bodyFieldsResolved`
 *     are true. Opaque bodies, wrapper clients, whole-body forwarding all
 *     stay silent by design — false negatives are the price of zero
 *     false positives.
 *
 * Requires graph mode: the client call and server route live in different
 * files by definition. Single-file review returns no findings.
 */

import type { ConceptNode } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  API_PATH_RE,
  CROSS_STACK_HEURISTIC_CONFIDENCE,
  collectRoutesAcrossGraph,
  findMatchingRoute,
  normalizeClientUrl,
} from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

interface ClientCall {
  target: string;
  normalizedPath: string;
  sentFields: readonly string[];
  node: ConceptNode;
}

export function bodyShapeDrift(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (serverRoutes.length === 0) return [];

  const clientCalls: ClientCall[] = [];
  for (const [, conceptMap] of ctx.allConcepts) {
    for (const node of conceptMap.nodes) {
      if (node.kind !== 'effect' || node.payload.kind !== 'effect' || node.payload.subtype !== 'network') continue;
      if (node.payload.sentFieldsResolved !== true) continue;
      const fields = node.payload.sentFields;
      if (!fields) continue;
      const target = node.payload.target;
      if (typeof target !== 'string') continue;
      const normalized = normalizeClientUrl(target);
      if (!normalized || !API_PATH_RE.test(normalized)) continue;
      clientCalls.push({ target, normalizedPath: normalized, sentFields: fields, node });
    }
  }
  if (clientCalls.length === 0) return [];

  const findings: ReviewFinding[] = [];
  const seen = new Set<string>();

  for (const call of clientCalls) {
    if (call.node.primarySpan.file !== ctx.filePath) continue;

    const route = findMatchingRoute(call.normalizedPath, serverRoutes);
    if (!route || !route.node) continue;
    if (route.node.payload.kind !== 'entrypoint') continue;
    if (route.node.payload.bodyFieldsResolved !== true) continue;
    const serverFields = route.node.payload.bodyFields;
    if (!serverFields || serverFields.length === 0) continue;

    const missing = serverFields.filter((f) => !call.sentFields.includes(f));
    if (missing.length === 0) continue;

    const fingerprint = createFingerprint(
      'body-shape-drift',
      call.node.primarySpan.startLine,
      call.node.primarySpan.startCol,
    );
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const missingList = missing.map((f) => `\`${f}\``).join(', ');
    const plural = missing.length === 1 ? 'field' : 'fields';
    findings.push({
      source: 'kern',
      ruleId: 'body-shape-drift',
      severity: 'warning',
      category: 'bug',
      message: `Frontend POSTs to \`${call.normalizedPath}\` without ${plural} ${missingList}, but the matching server handler reads ${missing.length === 1 ? 'it' : 'them'} off \`req.body\`. The handler will see \`undefined\` for the missing ${plural}.`,
      primarySpan: call.node.primarySpan,
      fingerprint,
      confidence: call.node.confidence * CROSS_STACK_HEURISTIC_CONFIDENCE,
    });
  }

  return findings;
}
