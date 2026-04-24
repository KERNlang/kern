/**
 * Rule: mutation-without-idempotency
 *
 * Backend rule — fires on mutating HTTP routes that perform a DB write without
 * visible idempotency, transaction, unique/upsert, or duplicate-protection
 * evidence.
 */

import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import { API_PATH_RE } from './cross-stack-utils.js';
import type { ConceptRuleContext } from './index.js';

const GUARD_MUTATING_METHODS = new Set(['POST']);
const AUDIT_MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

export function mutationWithoutIdempotency(ctx: ConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'entrypoint' || node.payload.kind !== 'entrypoint' || node.payload.subtype !== 'route') continue;
    const method = node.payload.httpMethod?.toUpperCase();
    const mutatingMethods = ctx.crossStackMode === 'audit' ? AUDIT_MUTATING_METHODS : GUARD_MUTATING_METHODS;
    if (!method || !mutatingMethods.has(method)) continue;
    if (!API_PATH_RE.test(node.payload.name)) continue;
    if (ctx.crossStackMode !== 'audit' && routeHasPathParam(node.payload.name)) continue;
    if (node.payload.hasDbWrite !== true) continue;
    if (node.payload.hasIdempotencyProtection === true) continue;

    findings.push({
      source: 'kern',
      ruleId: 'mutation-without-idempotency',
      severity: 'warning',
      category: 'bug',
      message: `Mutating route \`${method} ${node.payload.name}\` writes to the database without visible idempotency key, transaction, unique guard, upsert, or duplicate-protection evidence. Retries or double-submits can create duplicate side effects.`,
      primarySpan: node.primarySpan,
      fingerprint: createFingerprint(
        'mutation-without-idempotency',
        node.primarySpan.startLine,
        node.primarySpan.startCol,
      ),
      confidence: node.confidence * 0.75,
    });
  }

  return findings;
}

function routeHasPathParam(path: string): boolean {
  return path
    .split('/')
    .some((segment) => segment.startsWith(':') || (segment.startsWith('{') && segment.endsWith('}')));
}
