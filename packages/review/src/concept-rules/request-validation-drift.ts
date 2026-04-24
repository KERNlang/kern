/**
 * Rule: request-validation-drift
 *
 * Cross-stack/backend rule:
 *   - client sends fields outside the backend's resolved validation schema;
 *   - or a mutating backend route reads body fields and writes to DB with no
 *     visible body validation.
 */

import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  API_PATH_RE,
  CROSS_STACK_HEURISTIC_CONFIDENCE,
  collectRoutesAcrossGraph,
  findHighConfidenceRouteForMethod,
  findMatchingRouteForMethod,
  normalizeClientUrl,
} from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

const GUARD_BODY_METHODS = new Set(['POST']);
const AUDIT_BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export function requestValidationDrift(ctx: ConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  findings.push(...backendUnvalidatedBodyFindings(ctx));
  findings.push(...clientExtraFieldFindings(ctx));
  return findings;
}

function backendUnvalidatedBodyFindings(ctx: ConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'entrypoint' || node.payload.kind !== 'entrypoint' || node.payload.subtype !== 'route') continue;
    const method = node.payload.httpMethod?.toUpperCase();
    const bodyMethods = ctx.crossStackMode === 'audit' ? AUDIT_BODY_METHODS : GUARD_BODY_METHODS;
    if (!method || !bodyMethods.has(method)) continue;
    if (!API_PATH_RE.test(node.payload.name)) continue;
    if (node.payload.hasDbWrite !== true) continue;
    if (node.payload.bodyFieldsResolved !== true || !node.payload.bodyFields || node.payload.bodyFields.length === 0) {
      continue;
    }
    if (node.payload.hasBodyValidation === true) continue;

    const fields = node.payload.bodyFields.map((field) => `\`${field}\``).join(', ');
    findings.push({
      source: 'kern',
      ruleId: 'request-validation-drift',
      severity: 'warning',
      category: 'bug',
      message: `Route \`${method} ${node.payload.name}\` reads request body fields ${fields} and writes to the database without visible request-body validation.`,
      primarySpan: node.primarySpan,
      fingerprint: createFingerprint('request-validation-drift', node.primarySpan.startLine, node.primarySpan.startCol),
      confidence: node.confidence * 0.8,
    });
  }

  return findings;
}

function clientExtraFieldFindings(ctx: ConceptRuleContext): ReviewFinding[] {
  if (!ctx.allConcepts || ctx.allConcepts.size === 0) return [];

  const serverRoutes = collectRoutesAcrossGraph(ctx.allConcepts);
  if (serverRoutes.length === 0) return [];

  const findings: ReviewFinding[] = [];
  const localConcepts = ctx.allConcepts.get(ctx.filePath) ?? ctx.concepts;

  for (const node of localConcepts.nodes) {
    if (node.kind !== 'effect' || node.payload.kind !== 'effect' || node.payload.subtype !== 'network') continue;
    if (node.payload.sentFieldsResolved !== true || !node.payload.sentFields) continue;
    const target = node.payload.target;
    if (typeof target !== 'string') continue;
    const normalized = normalizeClientUrl(target);
    if (!normalized) continue;

    const route =
      ctx.crossStackMode === 'audit'
        ? findMatchingRouteForMethod(normalized, node.payload.method, serverRoutes)
        : findHighConfidenceRouteForMethod(normalized, node.payload.method, serverRoutes);
    if (route?.node?.payload.kind !== 'entrypoint') continue;
    if (route.node.payload.bodyValidationResolved !== true || !route.node.payload.validatedBodyFields) continue;

    const validated = new Set(route.node.payload.validatedBodyFields);
    const extra = node.payload.sentFields.filter((field) => !validated.has(field));
    if (extra.length === 0) continue;

    const fieldList = extra.map((field) => `\`${field}\``).join(', ');
    findings.push({
      source: 'kern',
      ruleId: 'request-validation-drift',
      severity: 'warning',
      category: 'bug',
      message: `Client sends ${fieldList} to \`${target}\`, but the matching backend validation schema does not accept ${extra.length === 1 ? 'that field' : 'those fields'}. Remove the extra payload data or update the backend schema intentionally.`,
      primarySpan: node.primarySpan,
      fingerprint: createFingerprint('request-validation-drift', node.primarySpan.startLine, node.primarySpan.startCol),
      confidence: node.confidence * CROSS_STACK_HEURISTIC_CONFIDENCE,
    });
  }

  return findings;
}
