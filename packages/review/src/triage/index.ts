/**
 * scoreFindings — public triage entry point.
 *
 * Batches findings into model calls, parses the per-line response, and
 * attaches a `triage` decoration to each finding (either `status: 'scored'`
 * with noise likelihood + reason category, or `status: 'skipped'` with the
 * reason scoring failed).
 *
 * BYOM: callers supply the TriageProvider. The engine has no LLM SDK
 * dependency and no API key handling. See ./types.ts for the contract.
 *
 * The function mutates `findings` in place AND returns the same array so
 * existing consumers that hold the ReviewFinding[] reference (Sight,
 * SARIF reporter, telemetry) pick up the decoration without re-wiring.
 * Matches the precedent set by llm-bridge.ts.
 *
 * Prompt IDs are batch-local ordinals (`t0`, `t1`, ...), NOT finding
 * fingerprints — Codex + OpenCode + Gemini all flagged that fingerprints
 * are not guaranteed unique within a batch (two findings in different
 * files at the same `ruleId:line:col` collide on `createFingerprint`).
 * The model echoes the ordinal back; mapping is by position, so two
 * findings sharing a fingerprint each get their own verdict. The
 * fingerprint is still shown to the model as context.
 */

import type { ReviewFinding } from '../types.js';
import { buildTriageSnippet } from './context.js';
import {
  buildTriageUserPrompt,
  parseTriageResponse,
  TRIAGE_SYSTEM_PROMPT,
  type TriageLineResult,
  type TriagePromptItem,
} from './prompt.js';
import { type FindingTriage, TRIAGE_PROMPT_VERSION, type TriageProvider, type TriageReader } from './types.js';

export interface ScoreFindingsOptions {
  provider: TriageProvider;
  reader: TriageReader;
  /** Findings per model call. Default 20; matches guard's batch size. Larger
   *  batches save round-trips but increase the blast radius of a single
   *  malformed response (line-format parser limits this but doesn't
   *  eliminate it for total response truncation). */
  batchSize?: number;
  /** Override max output tokens. Default scales with batch size:
   *  `Math.max(1024, batchSize * 100)`. Reasoning-capable providers can
   *  spend hidden tokens before emitting the final line; the floor of
   *  1024 prevents empty-content on small batches. */
  maxTokens?: number;
  /** Override temperature. Default 0 — triage must be deterministic for
   *  audit/replay. */
  temperature?: number;
  /** Optional model string forwarded to the provider on every batch. Most
   *  providers are model-bound at construction, but exposing this lets a
   *  caller route cheap-triage vs expensive-review through one provider
   *  instance. */
  model?: string;
  /** When true, skip findings whose `triage.status === 'scored'` was
   *  produced by the current `TRIAGE_PROMPT_VERSION`. Lets watch-mode /
   *  retry callers avoid paying for redundant model calls without losing
   *  prompt-version replay (a bumped version re-scores everything).
   *  Default `false` — preserves existing behavior. */
  skipAlreadyScored?: boolean;
}

const DEFAULT_BATCH_SIZE = 20;
const SKIP_REASON_MAX_CHARS = 200;

export async function scoreFindings(
  findings: ReviewFinding[],
  options: ScoreFindingsOptions,
): Promise<ReviewFinding[]> {
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const temperature = options.temperature ?? 0;

  // Build the work list — caller can opt into skipping already-scored
  // findings to avoid paying for redundant model calls. Skipped (i.e.
  // previously failed) findings still get re-scored: a retry is the
  // expected path for those.
  const targets = options.skipAlreadyScored
    ? findings.filter((f) => !(f.triage?.status === 'scored' && f.triage.promptVersion === TRIAGE_PROMPT_VERSION))
    : findings;

  for (let i = 0; i < targets.length; i += batchSize) {
    const slice = targets.slice(i, i + batchSize);
    const items: TriagePromptItem[] = slice.map((f, idx) => ({
      id: `t${idx}`,
      finding: f,
      snippet: buildTriageSnippet(f, options.reader),
    }));
    const maxTokens = options.maxTokens ?? Math.max(1024, items.length * 100);

    let raw: string;
    try {
      raw = await options.provider.complete({
        system: TRIAGE_SYSTEM_PROMPT,
        user: buildTriageUserPrompt(items),
        maxTokens,
        temperature,
        model: options.model,
      });
    } catch (err) {
      // Whole batch failed — every finding gets a `skipped` decoration with
      // the error message. Callers can retry or proceed with un-scored
      // findings; downstream filters can decide whether to keep or demote
      // skipped findings independently from scored ones.
      const message = sanitizeSkipReason(err instanceof Error ? err.message : String(err));
      for (const f of slice) {
        attachSkipped(f, `provider error: ${message}`);
      }
      continue;
    }

    const results = parseTriageResponse(raw);
    type AddressedLine = Exclude<TriageLineResult, { kind: 'unparsed' }>;
    const byId = new Map<string, AddressedLine>();
    for (const r of results) {
      if (r.kind === 'unparsed') continue;
      // First win — if the model emits two lines for the same id (rare
      // with reasoning models that double back on themselves), keep the
      // first. Last-wins would let a hedged second pass overwrite a
      // confident first call. With batch-local ordinals as IDs, the only
      // way to collide is the model itself emitting a duplicate.
      if (!byId.has(r.id)) byId.set(r.id, r);
    }

    for (let idx = 0; idx < slice.length; idx++) {
      const f = slice[idx];
      if (!f) continue;
      const r = byId.get(`t${idx}`);
      if (!r) {
        attachSkipped(f, 'no response line for finding');
        continue;
      }
      if (r.kind === 'skip') {
        attachSkipped(f, sanitizeSkipReason(r.reason));
        continue;
      }
      const decoration: FindingTriage = {
        status: 'scored',
        noiseLikelihood: r.noiseLikelihood,
        reason: r.reason,
        promptVersion: TRIAGE_PROMPT_VERSION,
      };
      f.triage = decoration;
    }
  }

  return findings;
}

function attachSkipped(f: ReviewFinding, reason: string): void {
  f.triage = {
    status: 'skipped',
    skipReason: sanitizeSkipReason(reason),
    promptVersion: TRIAGE_PROMPT_VERSION,
  };
}

/**
 * Truncate skipReason to a safe length and redact patterns that look like
 * credentials. Provider error messages can carry HTTP response bodies,
 * Authorization headers, or API-key suffixes (the OpenAI SDK appends the
 * masked key prefix to 401 errors, the Anthropic SDK echoes the raw body).
 * `skipReason` surfaces in SARIF/telemetry/PR comments, so anything that
 * could expose a secret needs scrubbing before it leaves the engine.
 */
function sanitizeSkipReason(raw: string): string {
  const redacted = raw
    // Bearer / api-key style tokens — match common provider error echoes.
    .replace(/\b(sk-[a-zA-Z0-9_-]{8,})\b/g, '[redacted]')
    .replace(/\b(Bearer\s+[A-Za-z0-9._-]+)/g, 'Bearer [redacted]')
    .replace(/\b(x-api-key:\s*[A-Za-z0-9._-]+)/gi, 'x-api-key: [redacted]')
    .replace(/\b(authorization:\s*[A-Za-z0-9._\s-]+)/gi, 'authorization: [redacted]');
  if (redacted.length <= SKIP_REASON_MAX_CHARS) return redacted;
  return `${redacted.slice(0, SKIP_REASON_MAX_CHARS - 1)}…`;
}

export { buildTriageSnippet } from './context.js';
export type { TriageLineResult, TriagePromptItem } from './prompt.js';
export { buildTriageUserPrompt, parseTriageResponse, TRIAGE_SYSTEM_PROMPT } from './prompt.js';
export type {
  FindingTriage,
  TriageCompletionInput,
  TriageProvider,
  TriageReader,
  TriageReasonCategory,
} from './types.js';
// Re-exports — single import point for consumers.
export { TRIAGE_PROMPT_VERSION } from './types.js';
