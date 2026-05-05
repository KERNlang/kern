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
 *   - Literal or locally typed JSON payloads on fetch/axios-style clients.
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
import { apiCallRootCause } from './root-cause.js';

type FieldTypeTag = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'unknown';

interface ClientCall {
  target: string;
  normalizedPath: string;
  method?: string;
  sentFields: readonly string[];
  sentFieldTypes?: Readonly<Record<string, FieldTypeTag>>;
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
      clientCalls.push({
        target,
        normalizedPath: normalized,
        method: node.payload.method,
        sentFields: fields,
        sentFieldTypes: node.payload.sentFieldTypes,
        node,
      });
    }
  }
  if (clientCalls.length === 0) return [];

  const findings: ReviewFinding[] = [];
  const seen = new Set<string>();

  for (const call of clientCalls) {
    if (call.node.primarySpan.file !== ctx.filePath) continue;

    const route = findMatchingRoute(call.normalizedPath, serverRoutes);
    if (!route?.node) continue;
    if (route.node.payload.kind !== 'entrypoint') continue;
    if (route.node.payload.bodyFieldsResolved !== true) continue;
    const serverFields = route.node.payload.bodyFields;
    if (!serverFields || serverFields.length === 0) continue;

    const missing = serverFields.filter((f) => !call.sentFields.includes(f));

    // Type-mismatch step: when both ends are typed (neither side 'unknown'),
    // a tag disagreement on a name that DOES overlap is a high-precision
    // bug — `userId: string` (client) vs `userId: number` (server) silently
    // matches by name today but breaks at runtime. We emit this as a
    // distinct finding so devs can fix it independently of the
    // missing-fields class.
    //
    // Method-aware: the legacy missing-fields branch keeps the path-only
    // match for backward compatibility. The new /type branch is
    // additionally gated on HTTP method agreement so it never fires
    // against a wrong-verb collision (e.g. PUT and PATCH on the same
    // path with different body shapes). If either method is unknown we
    // skip /type — precision over recall.
    const routeMethod = route.node.payload.httpMethod?.toUpperCase();
    const callMethod = call.method?.toUpperCase();
    const methodsAgree = !!routeMethod && !!callMethod && routeMethod === callMethod;

    const serverTypes = route.node.payload.bodyFieldTypes;
    const clientTypes = call.sentFieldTypes;
    const typeMismatches: Array<{ field: string; client: FieldTypeTag; server: FieldTypeTag }> = [];
    if (methodsAgree && serverTypes && clientTypes) {
      for (const f of serverFields) {
        if (!call.sentFields.includes(f)) continue;
        const serverTag = serverTypes[f];
        const clientTag = clientTypes[f];
        if (!serverTag || !clientTag) continue;
        if (serverTag === 'unknown' || clientTag === 'unknown') continue;
        if (serverTag !== clientTag) typeMismatches.push({ field: f, client: clientTag, server: serverTag });
      }
    }

    if (missing.length === 0 && typeMismatches.length === 0) continue;

    if (missing.length > 0) {
      const fingerprint = createFingerprint(
        'body-shape-drift',
        call.node.primarySpan.startLine,
        call.node.primarySpan.startCol,
      );
      if (!seen.has(fingerprint)) {
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
          rootCause: apiCallRootCause(call.node, call.normalizedPath, call.method, route.node),
        });
      }
    }

    if (typeMismatches.length > 0) {
      const fingerprint = createFingerprint(
        'body-shape-drift/type',
        call.node.primarySpan.startLine,
        call.node.primarySpan.startCol,
      );
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        const detail = typeMismatches
          .map((m) => `\`${m.field}\` (client \`${m.client}\` vs server \`${m.server}\`)`)
          .join(', ');
        const plural = typeMismatches.length === 1 ? 'a field whose type' : 'fields whose types';
        const verb = callMethod ?? 'sends';
        findings.push({
          source: 'kern',
          ruleId: 'body-shape-drift/type',
          severity: 'warning',
          category: 'bug',
          message: `Frontend ${verb} to \`${call.normalizedPath}\` with ${plural} disagree with the server handler: ${detail}.`,
          primarySpan: call.node.primarySpan,
          fingerprint,
          confidence: call.node.confidence * CROSS_STACK_HEURISTIC_CONFIDENCE,
          rootCause: apiCallRootCause(call.node, call.normalizedPath, call.method, route.node),
        });
      }
    }
  }

  return findings;
}
