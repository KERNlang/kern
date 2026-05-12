/**
 * Triage prompt + tolerant line-format parser.
 *
 * Per-finding line response (`<id>|<score>|<reason>`) is tolerant: one
 * malformed line falls through to a skip verdict without losing the rest
 * of the batch. A whole-batch JSON parse would lose siblings on one
 * stray comma — line-format is the engine's correctness contract with
 * reasoning models that emit hidden tokens before the final answer.
 */

import type { ReviewFinding } from '../types.js';
import type { TriageReasonCategory } from './types.js';

export const TRIAGE_SYSTEM_PROMPT = `You are a UX gatekeeper for a code-review bot. For each finding, output a noise-likelihood score from 0.00 (high signal — author would thank us) to 1.00 (definitely noise — pedantic nit, low effort to ignore). You are NOT verifying correctness; assume severity and confidence are accurate. You are deciding interruption cost.

Per finding, you will see:
- finding text (rule message)
- ruleId, source, severity, confidence
- file path + short code snippet around the primary span

Output ONE LINE per finding in the format:
  <id>|<noiseLikelihood>|<reasonCategory>

Where:
  noiseLikelihood is a decimal 0.00 to 1.00 (two decimals)
  reasonCategory is one of: pedantic | actionable | context-dependent | duplicate | high-value

If you cannot score a finding, emit:
  <id>|skip|<short-reason>

Do not output anything else — no preamble, no headers, no JSON wrappers.`;

export interface TriagePromptItem {
  /** Batch-local identifier echoed back by the model. `scoreFindings` uses
   *  the finding's fingerprint here so the reverse lookup is direct. */
  id: string;
  finding: ReviewFinding;
  /** Code snippet around primarySpan (already truncated). Empty when the
   *  reader couldn't supply file contents. */
  snippet: string;
}

export type TriageLineResult =
  | { kind: 'scored'; id: string; noiseLikelihood: number; reason: TriageReasonCategory }
  | { kind: 'skip'; id: string; reason: string }
  | { kind: 'unparsed'; raw: string };

export function buildTriageUserPrompt(batch: readonly TriagePromptItem[]): string {
  const lines: string[] = [`Score the following ${batch.length} finding(s):`];
  for (const item of batch) {
    const f = item.finding;
    lines.push(
      '',
      `# id: ${item.id}`,
      `rule: ${f.ruleId}  source: ${f.source}  severity: ${f.severity}  confidence: ${
        typeof f.confidence === 'number' ? f.confidence.toFixed(2) : 'unknown'
      }`,
      `path: ${f.primarySpan.file}`,
      `message: ${truncateInline(f.message, 280)}`,
      `snippet:`,
      indentLines(item.snippet || '(snippet unavailable)', '  '),
    );
  }
  lines.push('', 'Respond with one line per finding using the format from the system prompt.');
  return lines.join('\n');
}

// Permits whitespace around pipes — LLMs emit `id | 0.18 | reason` more often
// than `id|0.18|reason`. Strict no-whitespace would route every spaced line
// to unparsed, demoting otherwise-valid verdicts to skip.
//
// ID is "anything that isn't a pipe" — fingerprint chars vary across the
// codebase (Windows paths embed `\`, scoped names embed `@`, file-keyed
// fingerprints in llm-bridge embed full paths). A character allow-list was
// the original choice but it silently demoted valid verdicts to unparsed
// in real corpora — Codex + Gemini + OpenCode all flagged this on impl-review.
const SCORE_LINE = /^\s*([^|]+?)\s*\|\s*([0-9]*\.?[0-9]+|skip)\s*\|\s*(.+?)\s*$/;
const KNOWN_REASONS: ReadonlySet<string> = new Set([
  'pedantic',
  'actionable',
  'context-dependent',
  'duplicate',
  'high-value',
]);

export function parseTriageResponse(raw: string): TriageLineResult[] {
  const out: TriageLineResult[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    const m = trimmed.match(SCORE_LINE);
    if (!m) {
      out.push({ kind: 'unparsed', raw: trimmed });
      continue;
    }
    const id = m[1];
    const value = m[2];
    const tail = m[3];
    if (id === undefined || value === undefined || tail === undefined) {
      out.push({ kind: 'unparsed', raw: trimmed });
      continue;
    }
    if (value === 'skip') {
      out.push({ kind: 'skip', id, reason: tail.trim() });
      continue;
    }
    const score = Number.parseFloat(value);
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      out.push({ kind: 'unparsed', raw: trimmed });
      continue;
    }
    const reasonRaw = tail.trim().toLowerCase();
    const reason: TriageReasonCategory = KNOWN_REASONS.has(reasonRaw)
      ? (reasonRaw as TriageReasonCategory)
      : 'context-dependent';
    out.push({ kind: 'scored', id, noiseLikelihood: score, reason });
  }
  return out;
}

function truncateInline(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function indentLines(s: string, prefix: string): string {
  return s
    .split(/\r?\n/)
    .map((l) => `${prefix}${l}`)
    .join('\n');
}
