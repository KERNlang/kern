/**
 * LLM Review — structured prompt builder and response parser.
 *
 * Builds a KERN IR prompt with short aliases (N1, N2, ...) for LLM review.
 * Parses strict JSON schema responses, validates nodeIds, rejects unknowns.
 *
 * Phase 4 of the review pipeline.
 */

import type { InferResult, TemplateMatch, ReviewFinding, SourceSpan } from './types.js';
import { createFingerprint } from './types.js';

// ── Export KERN IR (v1 compat + v2 enhanced) ─────────────────────────────

/**
 * Export KERN IR with prompt aliases for AI review.
 * v2: Includes nodeId aliases and handler bodies.
 */
export function exportKernIR(
  inferred: InferResult[],
  templateMatches: TemplateMatch[],
): string {
  const lines: string[] = [];
  lines.push('// KERN IR — inferred from TypeScript source');
  lines.push('// Send this to AI for structural review (5x smaller than original TS)');
  lines.push('');

  for (const r of inferred) {
    if (r.node.type === 'import') continue; // skip imports for brevity

    lines.push(`// [${r.promptAlias}] L${r.startLine}-${r.endLine} (${r.confidencePct}% confidence)`);
    lines.push(serializeNode(r.node, ''));
    lines.push('');
  }

  for (const t of templateMatches) {
    if (t.suggestedKern) {
      lines.push(`// L${t.startLine}-${t.endLine} — ${t.libraryName} (${t.confidencePct}%)`);
      lines.push(t.suggestedKern);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── LLM Prompt Builder ───────────────────────────────────────────────────

/**
 * Build a structured prompt with short aliases for LLM code review.
 * Handler bodies are included so the LLM can review actual logic.
 */
export function buildLLMPrompt(
  inferred: InferResult[],
  templateMatches: TemplateMatch[],
): string {
  const lines: string[] = [];

  // Valid aliases list (for the LLM to reference)
  const aliases = inferred
    .filter(r => r.node.type !== 'import')
    .map(r => r.promptAlias);

  lines.push('Review this KERN IR. Return ONLY a JSON array of findings.');
  lines.push(`Schema: [{"nodeAlias":"N3","severity":"warning","category":"structure","message":"...","evidence":"..."}]`);
  lines.push('');
  lines.push(`Valid aliases: ${aliases.join(', ')}`);
  lines.push('Any alias not in this list will be rejected.');
  lines.push('');
  lines.push('Categories: bug, type, pattern, style, structure');
  lines.push('Severities: error, warning, info');
  lines.push('');
  lines.push('KERN IR:');

  for (const r of inferred) {
    if (r.node.type === 'import') continue;

    lines.push(`[${r.promptAlias}] ${serializeNodeWithBody(r.node, '')}`);
  }

  for (const t of templateMatches) {
    if (t.suggestedKern) {
      lines.push(`// template: ${t.suggestedKern}`);
    }
  }

  return lines.join('\n');
}

// ── LLM Response Parser ─────────────────────────────────────────────────

interface LLMFinding {
  nodeAlias: string;
  severity: 'error' | 'warning' | 'info';
  category: 'bug' | 'type' | 'pattern' | 'style' | 'structure';
  message: string;
  evidence?: string;
}

/**
 * Parse strict JSON response from LLM, validate nodeIds, reject unknowns.
 * Returns unified ReviewFinding[] mapped back to TS source spans.
 */
export function parseLLMResponse(
  response: string,
  inferred: InferResult[],
): ReviewFinding[] {
  // Build alias → InferResult lookup
  const aliasMap = new Map<string, InferResult>();
  for (const r of inferred) {
    aliasMap.set(r.promptAlias, r);
  }

  const validAliases = new Set(aliasMap.keys());

  // Extract JSON array from response (might be wrapped in markdown code blocks)
  let jsonStr = response.trim();
  // Strip markdown code fences
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed: LLMFinding[];
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [{
      source: 'llm',
      ruleId: 'parse-error',
      severity: 'error',
      category: 'bug',
      message: `Failed to parse LLM response as JSON: ${jsonStr.substring(0, 100)}...`,
      primarySpan: { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
      fingerprint: createFingerprint('parse-error', 0, 0),
    }];
  }

  if (!Array.isArray(parsed)) {
    return [{
      source: 'llm',
      ruleId: 'parse-error',
      severity: 'error',
      category: 'bug',
      message: 'LLM response is not a JSON array',
      primarySpan: { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
      fingerprint: createFingerprint('parse-error', 0, 1),
    }];
  }

  const findings: ReviewFinding[] = [];
  const validSeverities = new Set(['error', 'warning', 'info']);
  const validCategories = new Set(['bug', 'type', 'pattern', 'style', 'structure']);

  for (const item of parsed) {
    // Validate nodeAlias
    if (!item.nodeAlias || !validAliases.has(item.nodeAlias)) {
      continue; // reject unknown aliases silently
    }

    // Validate severity and category
    if (!validSeverities.has(item.severity)) continue;
    if (!validCategories.has(item.category)) continue;
    if (!item.message || typeof item.message !== 'string') continue;

    // Sanitize message: strip ANSI escape codes and control characters
    const message = item.message
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // ANSI escape sequences
      .replace(/\x1b\][^\x07]*\x07/g, '')     // OSC sequences (title bar injection)
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ''); // control chars (keep \t \n \r)

    const node = aliasMap.get(item.nodeAlias)!;
    const primarySpan: SourceSpan = node.sourceSpans[0] || {
      file: '',
      startLine: node.startLine,
      startCol: 1,
      endLine: node.endLine,
      endCol: 1,
    };

    findings.push({
      source: 'llm',
      ruleId: `llm-${item.category}`,
      severity: item.severity,
      category: item.category,
      message,
      primarySpan,
      nodeIds: [node.nodeId],
      confidence: 0.7, // LLM findings get lower confidence
      fingerprint: createFingerprint(`llm-${item.category}`, primarySpan.startLine, primarySpan.startCol),
    });
  }

  return findings;
}

// ── Node Serialization ───────────────────────────────────────────────────

function serializeNode(node: import('@kern/core').IRNode, indent: string): string {
  const parts = [node.type];
  if (node.props) {
    for (const [k, v] of Object.entries(node.props)) {
      if (k === 'code') continue; // skip handler bodies for brevity in export mode
      if (typeof v === 'string') {
        parts.push(v.includes(' ') ? `${k}="${v}"` : `${k}=${v}`);
      }
    }
  }
  let result = indent + parts.join(' ');
  if (node.children) {
    for (const child of node.children) {
      result += '\n' + serializeNode(child, indent + '  ');
    }
  }
  return result;
}

function serializeNodeWithBody(node: import('@kern/core').IRNode, indent: string): string {
  const parts = [node.type];
  if (node.props) {
    for (const [k, v] of Object.entries(node.props)) {
      if (typeof v === 'string') {
        if (k === 'code') {
          // Include handler bodies in LLM prompt (wrapped in <<<>>>)
          parts.push(`<<<\n${v}\n>>>`);
        } else {
          parts.push(v.includes(' ') ? `${k}="${v}"` : `${k}=${v}`);
        }
      }
    }
  }
  let result = indent + parts.join(' ');
  if (node.children) {
    for (const child of node.children) {
      result += '\n' + serializeNodeWithBody(child, indent + '  ');
    }
  }
  return result;
}
