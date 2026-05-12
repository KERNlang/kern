/**
 * Build a short code snippet around a finding's primarySpan so the triage
 * model sees what the static rule saw. ±4 lines around the primary line,
 * line-numbered with a `>` marker on the focal line, truncated to ≤300
 * chars. Reader-driven so callers can plug an in-memory cache, fs, or
 * VCS-aware source.
 */

import type { ReviewFinding } from '../types.js';
import type { TriageReader } from './types.js';

const SNIPPET_RADIUS = 4;
const SNIPPET_MAX_CHARS = 300;

export function buildTriageSnippet(finding: ReviewFinding, reader: TriageReader): string {
  const source = reader(finding.primarySpan.file);
  if (!source) return '';
  const lines = source.split(/\r?\n/);
  const target = Math.max(1, finding.primarySpan.startLine);
  const start = Math.max(1, target - SNIPPET_RADIUS);
  const end = Math.min(lines.length, target + SNIPPET_RADIUS);
  const out: string[] = [];
  for (let i = start; i <= end; i++) {
    const marker = i === target ? '>' : ' ';
    const line = sanitizeSnippetLine(lines[i - 1] ?? '');
    out.push(`${marker} ${i}: ${line}`);
  }
  const joined = out.join('\n');
  if (joined.length <= SNIPPET_MAX_CHARS) return joined;
  return `${joined.slice(0, SNIPPET_MAX_CHARS - 1)}…`;
}

/**
 * Replace `|` with the visually similar but parser-distinct broken-bar `¦`
 * (U+00A6) in snippet content. Source code that legitimately contains a
 * line like `if (x|y)` or a stringified id|score|reason could otherwise
 * confuse the model into echoing it back as a triage verdict, contaminating
 * the parser. The model sees readable code, the parser stays unambiguous.
 */
function sanitizeSnippetLine(line: string): string {
  return line.replace(/\|/g, '¦');
}
