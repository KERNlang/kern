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
  'browser-storage-json-parse-unguarded': 90,
  'class-timer-missing-unmount-cleanup': 90,
  'client-open-redirect-from-query': 90,
  'clone-element-children-without-valid-guard': 90,
  'command-injection': 95,
  'component-did-update-setstate-unguarded': 90,
  'cookie-hardening': 90,
  'crypto-iv-reuse': 92,
  'crypto-weak-kdf': 90,
  'dead-export': 90,
  'effect-cleanup-called-immediately': 92,
  'error-leak': 90,
  'event-listener-cleanup-mismatch': 92,
  'eval-use': 95,
  'focused-test-only': 92,
  'hardcoded-secret': 95,
  'helmet-missing': 90,
  'hook-length-dependency': 90,
  'iframe-dynamic-src-missing-sandbox': 90,
  'jwt-weak-verification': 92,
  'next-image-remote-wildcard': 90,
  'no-eval': 95,
  'open-redirect': 90,
  'path-traversal': 90,
  'playwright-wait-for-timeout': 90,
  'postmessage-wildcard-target': 90,
  'props-array-mutated-in-render': 90,
  'react-legacy-unsafe-lifecycle': 90,
  'route-handler-json-type-assertion': 90,
  'set-setter-collision': 95,
  'sync-handler-does-io': 90,
  'weak-password-hashing': 92,
  'window-open-blank-missing-noopener': 90,
  'xss-href-javascript': 92,
  'xss-unsafe-html': 90,
  // taint-* rules are all high — data-flow proof:
  'taint-eval': 95,
  'taint-exec': 95,
  'taint-redirect': 92,
  'taint-sql': 95,
  'taint-xss': 92,

  // ── medium (70–89): pattern-based, some FP risk ───────────────────────
  'async-setstate-after-unmount': 82,
  'cors-wildcard': 85,
  'cors-wildcard-credentials': 88,
  'csp-strength': 80,
  'csrf-detection': 78,
  'delimiter-injection': 75,
  'empty-catch': 80,
  'encoding-bypass': 75,
  'event-map-mismatch': 75,
  'exhaustive-deps': 80,
  'file-too-monolithic': 70,
  'floating-promise': 85,
  'forwarded-client-header': 82,
  'handler-size': 75,
  'indirect-prompt-injection': 72,
  'information-exposure': 80,
  'insecure-random': 88,
  'json-output-manipulation': 72,
  'llm-output-execution': 78,
  'machine-gap': 75,
  'middleware-cloned-request-headers': 82,
  'missing-input-validation': 78,
  'missing-output-validation': 75,
  'mock-route-missing-env-guard': 82,
  'module-scoped-timer-in-component': 82,
  'non-public-env-jsx-prop': 82,
  'non-exhaustive-switch': 80,
  'playwright-networkidle': 82,
  'prompt-injection': 72,
  'proxy-rewrite-env-path': 82,
  'prototype-pollution': 80,
  'rag-poisoning': 70,
  'regex-dos': 78,
  'route-handler-catch-status-undefined': 82,
  'route-handler-json-content-type-missing': 82,
  'route-handler-json-unguarded': 82,
  'session-local-storage-outside-helper': 82,
  'sensitive-route-public-cache': 82,
  'state-mutation': 80,
  'storybook-network-call-without-mock': 82,
  'storybook-play-without-assertion': 82,
  'storybook-random-story-data': 82,
  'storybook-secret-arg': 82,
  'swr-cache-key-shape-drift': 82,
  'swr-mutation-missing-invalidation': 82,
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
