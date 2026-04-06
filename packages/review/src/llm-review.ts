/**
 * LLM Review — structured prompt builder and response parser.
 *
 * Builds a KERN IR prompt with short aliases (N1, N2, ...) for LLM review.
 * Parses strict JSON schema responses, validates nodeIds, rejects unknowns.
 *
 * Phase 4 of the review pipeline.
 */

import type { ProofObligation } from './obligations.js';
import type { InferResult, ReviewFinding, SourceSpan, TemplateMatch } from './types.js';
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
export function exportKernIR(inferred: InferResult[], templateMatches: TemplateMatch[]): string {
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
  obligations?: ProofObligation[],
): string {
  const lines: string[] = [];

  // Valid aliases list (for the LLM to reference)
  const aliases = inferred.filter((r) => r.node.type !== 'import').map((r) => r.promptAlias);

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

  // Obligations section — verification claims for the AI reviewer
  if (obligations && obligations.length > 0) {
    lines.push('');
    lines.push('<kern-obligations>');
    for (const o of obligations) {
      lines.push(`  [${o.id}] (${o.type}) L${o.line}: ${o.claim}`);
      if (o.evidence_for.length > 0) {
        lines.push(`    Evidence FOR: ${o.evidence_for.join('; ')}`);
      }
      if (o.evidence_against.length > 0) {
        lines.push(`    Evidence AGAINST: ${o.evidence_against.join('; ')}`);
      }
      if (o.prevalence !== undefined) {
        lines.push(`    Peer prevalence: ${Math.round(o.prevalence * 100)}%`);
      }
      lines.push(`    Check: ${o.suggested_check}`);
    }
    lines.push('</kern-obligations>');
  }

  return lines.join('\n');
}

// ── LLM Response Parser ─────────────────────────────────────────────────

interface LLMFinding {
  nodeAlias?: string;
  line?: number;
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  evidence?: string;
}

/** Map AI-returned categories to valid internal categories. */
const CATEGORY_MAP: Record<string, string> = {
  bug: 'bug', correctness: 'bug', logic: 'bug', error: 'bug',
  security: 'bug', vulnerability: 'bug', injection: 'bug',
  type: 'type', typing: 'type', types: 'type',
  pattern: 'pattern', antipattern: 'pattern', 'anti-pattern': 'pattern',
  style: 'style', formatting: 'style', readability: 'style',
  performance: 'pattern',
  structure: 'structure', architecture: 'structure', design: 'structure',
};

/**
 * Parse strict JSON response from LLM, validate nodeIds, reject unknowns.
 * Returns unified ReviewFinding[] mapped back to TS source spans.
 */
export function parseLLMResponse(response: string, inferred: InferResult[]): ReviewFinding[] {
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
    return [
      {
        source: 'llm',
        ruleId: 'parse-error',
        severity: 'error',
        category: 'bug',
        message: `Failed to parse LLM response as JSON: ${jsonStr.substring(0, 100)}...`,
        primarySpan: { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
        fingerprint: createFingerprint('parse-error', 0, 0),
      },
    ];
  }

  if (!Array.isArray(parsed)) {
    return [
      {
        source: 'llm',
        ruleId: 'parse-error',
        severity: 'error',
        category: 'bug',
        message: 'LLM response is not a JSON array',
        primarySpan: { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
        fingerprint: createFingerprint('parse-error', 0, 1),
      },
    ];
  }

  const findings: ReviewFinding[] = [];
  const validSeverities = new Set(['error', 'warning', 'info']);

  for (const item of parsed) {
    // Resolve source location: prefer nodeAlias, fall back to line number
    let primarySpan: SourceSpan | null = null;
    let nodeIds: string[] | undefined;

    if (item.nodeAlias && validAliases.has(item.nodeAlias)) {
      const node = aliasMap.get(item.nodeAlias)!;
      primarySpan = node.sourceSpans[0] || {
        file: '', startLine: node.startLine, startCol: 1, endLine: node.endLine, endCol: 1,
      };
      nodeIds = [node.nodeId];
    } else if (item.line && typeof item.line === 'number' && item.line > 0) {
      // AI used "line" field — create a span from the line number
      primarySpan = { file: '', startLine: item.line, startCol: 1, endLine: item.line, endCol: 1 };
    } else {
      continue; // no location at all — skip
    }

    // Validate severity
    if (!validSeverities.has(item.severity)) continue;
    if (!item.message || typeof item.message !== 'string') continue;

    // Normalize category — accept what AIs naturally return
    type FindingCategory = 'bug' | 'type' | 'pattern' | 'style' | 'structure';
    const category = (CATEGORY_MAP[(item.category || '').toLowerCase()] || 'bug') as FindingCategory;

    // Sanitize message: strip ANSI escape codes and control characters
    const message = item.message
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // ANSI escape sequences
      .replace(/\x1b\][^\x07]*\x07/g, '') // OSC sequences (title bar injection)
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ''); // control chars (keep \t \n \r)

    findings.push({
      source: 'llm',
      ruleId: `llm-${category}`,
      severity: item.severity,
      category,
      message,
      primarySpan,
      ...(nodeIds ? { nodeIds } : {}),
      confidence: 0.7, // LLM findings get lower confidence
      fingerprint: createFingerprint(`llm-${category}`, primarySpan.startLine, primarySpan.startCol),
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
      result += `\n${serializeNode(child, `${indent}  `)}`;
    }
  }
  return result;
}

/** Max handler lines before compression kicks in (IR-only mode). */
const HANDLER_COMPRESS_THRESHOLD = 30;

// Security-sensitive patterns to preserve verbatim in compressed output.
// These are detection patterns for code review, not actual usage.
const SECURITY_PATTERN =
  /\b(exec|eval|spawn|sql|query|auth|token|password|cookie|header|redirect|innerHTML|dangerouslySetInnerHTML|crypto|hash|sign|verify|decrypt|encrypt)\b/i; // eslint-disable-line -- detection pattern, not usage

// ── Effect annotation patterns ──────────────────────────────────────────
const EFFECT_DB_PATTERN = /\b(db|sql|query|mongo|prisma|knex|sequelize|typeorm|drizzle)\b/i;
const EFFECT_FS_PATTERN = /\b(fs\.|readFile|writeFile|readdir|mkdir|unlink|createReadStream|createWriteStream)\b/i;
const EFFECT_NET_PATTERN = /\b(fetch|axios|http|https|request|got|superagent|XMLHttpRequest|WebSocket)\b/i;
const EFFECT_EXEC_PATTERN = /\b(exec|execSync|spawn|spawnSync|fork|execFile)\b/i; // eslint-disable-line -- detection pattern
const EFFECT_CRYPTO_PATTERN = /\b(crypto|hash|sign|verify|decrypt|encrypt|createHash|createHmac|randomBytes)\b/i;

const STRIP_PATTERNS = [
  /^\s*\/\//,
  /^\s*\/?\*/,
  /^\s*console\.(log|debug|info|trace|dir|table|time|timeEnd|count|group|groupEnd)\b/,
  /^\s*logger\.(debug|trace|verbose)\b/,
  /^\s*debugger\b/,
  /^\s*\/\*\*/,
  /^\s*\*\s/,
  /^\s*\*\//,
  /^\s*$/,
];
const TYPE_ONLY_PATTERN = /^\s*(type\s|interface\s|as\s+\w|<\w+>$)/;
const CONTROL_FLOW_LINE = /^\s*(if|else\s*if|else|for|while|do|switch|case|default|try|catch|finally)\b/;
const EXIT_PATTERN = /^\s*(return|yield|throw)\b/;
const CLOSE_BRACE = /^\s*\}(\s*(else|catch|finally)\b.*)?;?\s*$/;
const ASSIGNMENT_PATTERN = /^\s*(const|let|var)\s+(\w+)\s*=/;
const CLEANUP_PATTERN = /\b(release|close|destroy|disconnect|dispose|cleanup|teardown|end)\s*\(/;
const AWAIT_PATTERN = /\bawait\b/;

function annotateLine(trimmed: string): string {
  const annotations: string[] = [];
  if (EFFECT_DB_PATTERN.test(trimmed)) annotations.push('[EFFECT:db]');
  if (EFFECT_FS_PATTERN.test(trimmed)) annotations.push('[EFFECT:fs]');
  if (EFFECT_NET_PATTERN.test(trimmed)) annotations.push('[EFFECT:net]');
  if (EFFECT_EXEC_PATTERN.test(trimmed)) annotations.push('[EFFECT:exec]');
  if (EFFECT_CRYPTO_PATTERN.test(trimmed)) annotations.push('[EFFECT:crypto]');
  if (SECURITY_PATTERN.test(trimmed) && !annotations.some((a) => a.startsWith('[EFFECT:')))
    annotations.push('[TAINT:sink]');
  if (
    /^\s*(if|else\s+if)\s*\(/.test(trimmed) &&
    /\b(auth|admin|permission|role|valid|check|verify|allowed|forbidden|unauthorized)\b/i.test(trimmed)
  )
    annotations.push('[GUARD]');
  if (/^\s*catch\b/.test(trimmed)) annotations.push('[ERROR:handle]');
  else if (/^\s*throw\b/.test(trimmed) && /\b(err|error|e)\s*;?\s*$/.test(trimmed))
    annotations.push('[ERROR:propagate]');
  else if (/^\s*throw\b/.test(trimmed)) annotations.push('[ERROR:raise]');
  if (CLEANUP_PATTERN.test(trimmed)) annotations.push('[CLEANUP]');
  return annotations.length > 0 ? ` ${annotations.join(' ')}` : '';
}

function isStrippableLine(trimmed: string): boolean {
  return STRIP_PATTERNS.some((p) => p.test(trimmed)) || TYPE_ONLY_PATTERN.test(trimmed);
}

function isEffectLine(trimmed: string): boolean {
  return (
    EFFECT_DB_PATTERN.test(trimmed) ||
    EFFECT_FS_PATTERN.test(trimmed) ||
    EFFECT_NET_PATTERN.test(trimmed) ||
    EFFECT_EXEC_PATTERN.test(trimmed) ||
    EFFECT_CRYPTO_PATTERN.test(trimmed) ||
    AWAIT_PATTERN.test(trimmed)
  );
}

/**
 * Compress a large handler body into a logic-flow skeleton that preserves
 * the decision structure, effects, error handling, and return paths.
 * Uses line-based regex analysis — no AST re-parse needed.
 */
export function compressHandlerBody(code: string): string {
  const lines = code.split('\n');
  const totalLines = lines.length;
  const keptIndices = new Set<number>();
  const lineData = lines.map((raw, idx) => ({ raw, trimmed: raw.trim(), idx, lineNum: idx + 1 }));

  // Pass 1: classify every line
  for (const { trimmed, idx } of lineData) {
    if (trimmed === '') continue;
    if (CONTROL_FLOW_LINE.test(trimmed)) {
      keptIndices.add(idx);
      continue;
    }
    if (EXIT_PATTERN.test(trimmed)) {
      keptIndices.add(idx);
      continue;
    }
    if (CLOSE_BRACE.test(trimmed)) {
      keptIndices.add(idx);
      continue;
    }
    if (SECURITY_PATTERN.test(trimmed)) {
      keptIndices.add(idx);
      continue;
    }
    if (isEffectLine(trimmed)) {
      keptIndices.add(idx);
      continue;
    }
    if (CLEANUP_PATTERN.test(trimmed)) {
      keptIndices.add(idx);
      continue;
    }
    if (isStrippableLine(trimmed)) continue;
    if (ASSIGNMENT_PATTERN.test(trimmed) && (AWAIT_PATTERN.test(trimmed) || /=\s*new\s+/.test(trimmed))) {
      keptIndices.add(idx);
    }
  }

  // Pass 2: backfill assignments whose variables are referenced in kept lines
  const keptContent = [...keptIndices].map((i) => lineData[i].trimmed).join('\n');
  for (const { trimmed, idx } of lineData) {
    if (keptIndices.has(idx)) continue;
    const assignMatch = trimmed.match(ASSIGNMENT_PATTERN);
    if (assignMatch) {
      const varName = assignMatch[2];
      if (new RegExp(`\\b${varName}\\b`).test(keptContent)) keptIndices.add(idx);
    }
  }

  // Pass 3: build skeleton
  const skeleton: string[] = [`// ${totalLines} lines, logic skeleton:`];
  const sortedIndices = [...keptIndices].sort((a, b) => a - b);
  let prevIdx = -1;
  for (const idx of sortedIndices) {
    const { raw, trimmed, lineNum } = lineData[idx];
    if (prevIdx >= 0 && idx - prevIdx > 1) {
      const hasContent = lineData.slice(prevIdx + 1, idx).some((l) => l.trimmed !== '' && l.trimmed !== '}');
      if (hasContent) skeleton.push(`  // ... (${idx - prevIdx - 1} lines)`);
    }
    const escaped = raw.replace(/<kern-code>/gi, '&lt;kern-code&gt;').replace(/<\/kern-code>/gi, '&lt;/kern-code&gt;');
    const annotations = annotateLine(trimmed);
    skeleton.push(`${escaped}${' '.repeat(Math.max(1, 40 - escaped.length))}// L${lineNum}${annotations}`);
    prevIdx = idx;
  }
  return skeleton.join('\n');
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
      result += `\n${serializeNodeWithBody(child, `${indent}  `, mode, nodeStartLine, nodeEndLine)}`;
    }
  }
  return result;
}
