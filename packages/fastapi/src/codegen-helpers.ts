/**
 * Codegen helpers — shared micro-utilities and annotation emitters
 * used across all Python code generators.
 */

import type { IRNode } from '@kernlang/core';

// ── Micro-helpers ──────────────────────────────────────────────────────

export function p(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

export function kids(node: IRNode, type?: string): IRNode[] {
  const c = node.children || [];
  return type ? c.filter((n) => n.type === type) : c;
}

export function firstChild(node: IRNode, type: string): IRNode | undefined {
  return kids(node, type)[0];
}

// ── Reason & Confidence Annotations (Python) ────────────────────────────

export function emitPyReasonAnnotations(node: IRNode): string[] {
  const reasonNode = firstChild(node, 'reason');
  const evidenceNode = firstChild(node, 'evidence');
  const needsNodes = kids(node, 'needs');
  const confidence = p(node).confidence as string | undefined;

  if (!reasonNode && !evidenceNode && !confidence && needsNodes.length === 0) return [];

  const lines: string[] = [];
  if (confidence) lines.push(`# @confidence ${confidence}`);
  if (reasonNode) {
    const rp = p(reasonNode);
    lines.push(`# @reason ${rp.because || ''}`);
    if (rp.basis) lines.push(`# @basis ${rp.basis}`);
    if (rp.survives) lines.push(`# @survives ${rp.survives}`);
  }
  if (evidenceNode) {
    const ep = p(evidenceNode);
    const parts = [`source=${ep.source}`];
    if (ep.method) parts.push(`method=${ep.method}`);
    if (ep.authority) parts.push(`authority=${ep.authority}`);
    lines.push(`# @evidence ${parts.join(', ')}`);
  }
  for (const needsNode of needsNodes) {
    const np = p(needsNode);
    const desc = (np.what as string) || (np.description as string) || '';
    const wouldRaise = np['would-raise-to'] as string;
    const tag = wouldRaise ? `${desc} (would raise to ${wouldRaise})` : desc;
    lines.push(`# @needs ${tag}`);
  }
  return lines;
}

/** Emit a TODO comment for nodes with low literal confidence (< 0.5). */
export function emitPyLowConfidenceTodo(node: IRNode, confidence: string | undefined): string[] {
  if (!confidence) return [];
  const val = parseFloat(confidence);
  if (Number.isNaN(val) || val >= 0.5 || confidence.includes(':')) return [];
  const name = (p(node).name as string) || node.type;
  return [`# TODO(low-confidence): ${name} confidence=${confidence}`];
}
