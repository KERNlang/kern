/**
 * Per-rule baseline confidence registry — integer 0–100 per RULE-FEEDBACK.md.
 *
 * The `finding()` factory injects the baseline at emit time when a rule does
 * not pass an explicit per-match confidence. Rules MAY override per match
 * (e.g. `taint-redirect` scores higher when source+sink are both unambiguous,
 * lower when the path is partially constant-folded).
 *
 * Bands (informational — downstream UI decides what to do with them):
 *   high   ≥ 90
 *   medium 70–89
 *   low    < 70
 *
 * Deterministic per (rule, match context). Same input must always produce
 * the same number. No randomness.
 */

const DEFAULT_BASELINE = 80;

/**
 * Explicit per-rule baselines. Anything not listed falls back to
 * `DEFAULT_BASELINE`. Keep alphabetized within each band so reviewers can
 * find a rule fast.
 */
const RULE_CONFIDENCE_BASELINE: Record<string, number> = {
  // ── high (≥ 90): unambiguous patterns / data-flow proven ──────────────
  'bearer-token-literal': 92,
  'command-injection': 95,
  'cookie-hardening': 90,
  'crypto-iv-reuse': 92,
  'crypto-weak-kdf': 90,
  'dead-export': 90,
  'error-leak': 90,
  'eval-use': 95,
  'hardcoded-secret': 95,
  'helmet-missing': 90,
  'jwt-weak-verification': 92,
  'no-eval': 95,
  'open-redirect': 90,
  'path-traversal': 90,
  'set-setter-collision': 95,
  'sync-handler-does-io': 90,
  'weak-password-hashing': 92,
  'xss-href-javascript': 92,
  'xss-unsafe-html': 90,
  // taint-* rules are all high — data-flow proof:
  'taint-eval': 95,
  'taint-exec': 95,
  'taint-redirect': 92,
  'taint-sql': 95,
  'taint-xss': 92,

  // ── medium (70–89): pattern-based, some FP risk ───────────────────────
  'cors-wildcard': 85,
  'cors-wildcard-credentials': 88,
  'csp-strength': 80,
  'csrf-detection': 78,
  'delimiter-injection': 75,
  'empty-catch': 80,
  'encoding-bypass': 75,
  'event-map-mismatch': 75,
  'exhaustive-deps': 80,
  'floating-promise': 85,
  'handler-size': 75,
  'indirect-prompt-injection': 72,
  'information-exposure': 80,
  'insecure-random': 88,
  'json-output-manipulation': 72,
  'llm-output-execution': 78,
  'machine-gap': 75,
  'missing-input-validation': 78,
  'missing-output-validation': 75,
  'non-exhaustive-switch': 80,
  'prompt-injection': 72,
  'prototype-pollution': 80,
  'rag-poisoning': 70,
  'regex-dos': 78,
  'state-mutation': 80,
  'sync-in-async': 78,
  'system-prompt-leakage': 75,
  'tool-calling-manipulation': 72,
  'unhandled-async': 75,
  'unsanitized-history': 75,

  // ── low (< 70): heuristic / pattern-shape only ───────────────────────
  'cognitive-complexity': 60,
  'config-default-mismatch': 65,
  'extra-code': 60,
  'inconsistent-pattern': 60,
  'missing-type': 60,
  'style-difference': 55,
  'template-available': 65,
};

/** Look up the baseline confidence for a rule. Always returns 0..100 integer. */
export function baselineConfidenceFor(ruleId: string): number {
  const explicit = RULE_CONFIDENCE_BASELINE[ruleId];
  return typeof explicit === 'number' ? explicit : DEFAULT_BASELINE;
}

/** Source-channel default for non-`kern` findings (eslint/tsc/llm) that don't carry a ruleId we own. */
export function baselineConfidenceForSource(source: 'kern' | 'kern-native' | 'eslint' | 'tsc' | 'llm'): number {
  switch (source) {
    case 'kern':
    case 'kern-native':
      return DEFAULT_BASELINE;
    case 'tsc':
      return 95; // type errors are deterministic
    case 'eslint':
      return 85;
    case 'llm':
      return 70;
  }
}

/** Clamp a raw confidence value to a valid integer in [0, 100]. */
export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BASELINE;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Resolve the confidence for a finding emission — per-match override clamped,
 * else the per-rule baseline. Used by every local `finding()` helper across
 * the rule files so the wire payload always carries an integer 0..100.
 */
export function resolveConfidence(ruleId: string, perMatch?: number): number {
  return typeof perMatch === 'number' ? clampConfidence(perMatch) : baselineConfidenceFor(ruleId);
}
