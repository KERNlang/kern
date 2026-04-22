/**
 * Rule: sync-handler-does-io
 *
 * Fires when a route handler is explicitly synchronous and performs
 * network/db/fs I/O in the same function container.
 */

import type { ConceptNode } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import type { ConceptRuleContext } from './index.js';

const BLOCKING_IO_SUBTYPES = new Set(['network', 'db', 'fs']);

export function syncHandlerDoesIo(ctx: ConceptRuleContext): ReviewFinding[] {
  const effectsByContainer = new Map<string, ConceptNode[]>();

  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'effect') continue;
    if (node.payload.kind !== 'effect') continue;
    if (!BLOCKING_IO_SUBTYPES.has(node.payload.subtype)) continue;
    if (!node.containerId) continue;

    const existing = effectsByContainer.get(node.containerId) ?? [];
    existing.push(node);
    effectsByContainer.set(node.containerId, existing);
  }

  const findings: ReviewFinding[] = [];

  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'entrypoint') continue;
    if (node.payload.kind !== 'entrypoint') continue;
    if (node.payload.subtype !== 'route') continue;
    if (node.payload.isAsync !== false) continue;
    if (!node.containerId) continue;

    const effects = effectsByContainer.get(node.containerId);
    if (!effects || effects.length === 0) continue;
    const firstEffect = effects[0];
    if (firstEffect.payload.kind !== 'effect') continue;

    findings.push({
      source: 'kern',
      ruleId: 'sync-handler-does-io',
      severity: 'warning',
      category: 'bug',
      message: `Sync route handler \`${node.payload.name}\` performs ${firstEffect.payload.subtype} I/O. Make the handler async and use non-blocking I/O, or move the blocking work out of the request path.`,
      primarySpan: node.primarySpan,
      relatedSpans: effects.map((effect) => effect.primarySpan),
      fingerprint: createFingerprint('sync-handler-does-io', node.primarySpan.startLine, node.primarySpan.startCol),
      confidence: 0.9,
    });
  }

  return findings;
}
