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

/**
 * Controls how handler bodies are serialized in LLM prompts.
 * - 'deep': source is available in <kern-source>, emit line references only
 * - 'ir-only': no source available, inline code (small) or compress (large)
 */
export type SerializationMode = 'deep' | 'ir-only';

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
/**
 * Context entry for graph-aware LLM prompts.
 * Maps file paths to their graph distance (0 = changed, 1+ = upstream).
 */
export interface LLMGraphContext {
  fileDistances: Map<string, number>;
}

export function buildLLMPrompt(
  inferred: InferResult[],
  templateMatches: TemplateMatch[],
  graphContext?: LLMGraphContext,
  mode: SerializationMode = 'ir-only',
): string {
  const lines: string[] = [];

  // Valid aliases list (for the LLM to reference)
  const aliases = inferred
    .filter(r => r.node.type !== 'import')
    .map(r => r.promptAlias);

  // NOTE: instructions are in the system prompt (llm-bridge.ts buildSystemPrompt).
  // Only data goes here — this content is wrapped in <kern-file> (untrusted boundary).
  lines.push(`Valid aliases: ${aliases.join(', ')}`);

  // Graph context instructions for LLM (Gemini feedback: be explicit about what markers mean)
  if (graphContext) {
    lines.push('');
    lines.push('Context markers:');
    lines.push('  [CHANGED] — this node is from a file the user modified. Focus your review here.');
    lines.push('  [CONTEXT d=N] — this node is from an upstream dependency at distance N.');
    lines.push('    Reference these only to support findings in [CHANGED] nodes.');
    lines.push('    Do NOT report findings against [CONTEXT] nodes unless they directly affect [CHANGED] code.');
  }

  lines.push('');
  lines.push('KERN IR:');

  for (const r of inferred) {
    if (r.node.type === 'import') continue;

    // Add graph provenance marker if available
    let marker = '';
    if (graphContext) {
      const filePath = r.sourceSpans?.[0]?.file || '';
      const distance = graphContext.fileDistances.get(filePath);
      if (distance !== undefined) {
        marker = distance === 0 ? ' [CHANGED]' : ` [CONTEXT d=${distance}]`;
      }
    }

    lines.push(`[${r.promptAlias}]${marker} ${serializeNodeWithBody(r.node, '', mode, r.startLine, r.endLine)}`);
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

function serializeNode(node: import('@kernlang/core').IRNode, indent: string): string {
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

/** Max handler lines before compression kicks in (IR-only mode). */
const HANDLER_COMPRESS_THRESHOLD = 30;

const CONTROL_FLOW_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'try', 'catch', 'finally',
  'return', 'throw', 'new', 'typeof', 'instanceof', 'void', 'delete', 'await',
]);

// Security-sensitive patterns to preserve verbatim in compressed output.
// These are detection patterns for code review, not actual usage.
const SECURITY_PATTERN = /\b(exec|eval|spawn|sql|query|auth|token|password|cookie|header|redirect|innerHTML|dangerouslySetInnerHTML|crypto|hash|sign|verify|decrypt|encrypt)\b/i; // eslint-disable-line -- detection pattern, not usage

/**
 * Compress a large handler body into a structural summary with security-relevant excerpts.
 * Uses regex extraction — no AST re-parse needed.
 */
export function compressHandlerBody(code: string): string {
  const lines = code.split('\n');
  const summary: string[] = [];

  summary.push(`// ${lines.length} lines`);

  // Function calls (deduplicated)
  const calls = new Set<string>();
  for (const line of lines) {
    for (const m of line.matchAll(/\b(\w+)\s*\(/g)) {
      if (!CONTROL_FLOW_KEYWORDS.has(m[1])) calls.add(m[1]);
    }
  }
  if (calls.size > 0) summary.push(`// calls: ${[...calls].join(', ')}`);

  // External API references
  const apiCount = lines.filter(l => /\b(db|sql|query|http|fetch|axios|fs\.|crypto|process\.env)/i.test(l)).length;
  if (apiCount > 0) summary.push(`// external APIs: ${apiCount} references`);

  // Control flow counts
  const ifCount = lines.filter(l => /\bif\s*\(/.test(l)).length;
  const loopCount = lines.filter(l => /\b(for|while)\s*\(/.test(l)).length;
  const tryCount = lines.filter(l => /\btry\s*\{/.test(l)).length;
  const switchCount = lines.filter(l => /\bswitch\s*\(/.test(l)).length;
  const flow: string[] = [];
  if (ifCount) flow.push(`${ifCount} if`);
  if (loopCount) flow.push(`${loopCount} loop`);
  if (tryCount) flow.push(`${tryCount} try`);
  if (switchCount) flow.push(`${switchCount} switch`);
  if (flow.length > 0) summary.push(`// control flow: ${flow.join(', ')}`);

  // Return statements
  const returnCount = lines.filter(l => /\breturn\b/.test(l)).length;
  if (returnCount > 0) summary.push(`// returns: ${returnCount}`);

  // Security-relevant verbatim snippets (capped at 10)
  const securityLines = lines
    .map((l, i) => ({ line: l.trim(), num: i + 1 }))
    .filter(({ line }) => SECURITY_PATTERN.test(line));

  if (securityLines.length > 0) {
    summary.push('// security-relevant:');
    for (const { line, num } of securityLines.slice(0, 10)) {
      const escaped = line
        .replace(/<kern-code>/gi, '&lt;kern-code&gt;')
        .replace(/<\/kern-code>/gi, '&lt;/kern-code&gt;');
      summary.push(`//   L${num}: ${escaped}`);
    }
  }

  return summary.join('\n');
}

export function serializeNodeWithBody(
  node: import('@kernlang/core').IRNode,
  indent: string,
  mode: SerializationMode = 'ir-only',
  nodeStartLine?: number,
  nodeEndLine?: number,
): string {
  const parts = [node.type];
  if (node.props) {
    for (const [k, v] of Object.entries(node.props)) {
      if (typeof v === 'string') {
        if (k === 'code') {
          if (mode === 'deep' && nodeStartLine !== undefined && nodeEndLine !== undefined) {
            // Deep mode: LLM has full source in <kern-source>, just reference lines
            parts.push(`lines=${nodeStartLine}-${nodeEndLine}`);
          } else {
            // IR-only mode: inline small handlers, compress large ones
            const lineCount = v.split('\n').length;
            if (lineCount > HANDLER_COMPRESS_THRESHOLD) {
              parts.push(`<kern-code>\n${compressHandlerBody(v)}\n</kern-code>`);
            } else {
              const escaped = v
                .replace(/<kern-code>/gi, '&lt;kern-code&gt;')
                .replace(/<\/kern-code>/gi, '&lt;/kern-code&gt;');
              parts.push(`<kern-code>\n${escaped}\n</kern-code>`);
            }
          }
        } else {
          parts.push(v.includes(' ') ? `${k}="${v}"` : `${k}=${v}`);
        }
      }
    }
  }
  let result = indent + parts.join(' ');
  if (node.children) {
    for (const child of node.children) {
      result += '\n' + serializeNodeWithBody(child, indent + '  ', mode, nodeStartLine, nodeEndLine);
    }
  }
  return result;
}
