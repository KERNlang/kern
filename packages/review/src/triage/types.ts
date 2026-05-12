/**
 * Triage primitives — BYOM noise-scoring for ReviewFinding[].
 *
 * The engine ships the interface, prompt template, response parser, and
 * context builder. Callers supply the model via TriageProvider.
 *
 * Mirrors kern-guard's noise-scorer shape (5-reason taxonomy, line-format
 * response, deterministic scoring) so guard can swap its internal
 * implementation for this one without disturbing its downstream Bayesian
 * blend / filter pipeline. Decision logic (cert-promotion, exploration
 * sampling, capped-to-summary) stays in guard — that's reputation-aware
 * orchestration, not a primitive.
 */

import type { ReviewFinding } from '../types.js';

/**
 * Prompt schema version. Bump on any wording change to TRIAGE_SYSTEM_PROMPT
 * or the line-format spec — persisted callers (guard) use this to know
 * whether a stored verdict needs re-running after an upgrade.
 */
export const TRIAGE_PROMPT_VERSION = 1;

export type TriageReasonCategory = 'pedantic' | 'actionable' | 'context-dependent' | 'duplicate' | 'high-value';

/**
 * Verdict attached to a ReviewFinding by `scoreFindings`. Discriminated by
 * `status` so `skipped` and `scored` carry distinct payloads — a "skipped"
 * verdict is "we don't know," not "we know it's noise."
 */
export type FindingTriage = { promptVersion: number } & (
  | {
      status: 'scored';
      /** [0, 1]. 0 = high signal (author will act). 1 = pure noise. */
      noiseLikelihood: number;
      reason: TriageReasonCategory;
    }
  | {
      status: 'skipped';
      /** Why scoring was skipped (parser failure, model refusal, batch error). */
      skipReason: string;
    }
);

/** Caller-supplied model integration. Engine has no opinion on which model
 *  runs — only the contract: send these prompts, return the text response. */
export interface TriageProvider {
  complete(input: TriageCompletionInput): Promise<string>;
}

export interface TriageCompletionInput {
  system: string;
  user: string;
  maxTokens: number;
  /** Triage requires deterministic scoring — pass 0 unless you have a reason
   *  not to. Re-running with temperature > 0 breaks audit/replay. */
  temperature: number;
  /** Optional per-call model override. Most providers configure their model
   *  once at construction, but exposing this lets a single provider serve
   *  cheap-triage / expensive-review routing without re-wrapping. Providers
   *  that ignore this field MUST still respect the rest of the contract. */
  model?: string;
}

/** File reader the context builder uses to fetch source snippets. Returns
 *  undefined when the file is unreadable — the finding still gets triaged
 *  from message + ruleId alone, the snippet line just renders as empty. */
export type TriageReader = (filePath: string) => string | undefined;

/**
 * Convenience re-export of ReviewFinding so callers that only import from
 * the triage module still get the type they need to pass in.
 */
export type { ReviewFinding };
