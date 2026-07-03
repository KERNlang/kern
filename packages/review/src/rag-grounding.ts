/**
 * RAG grounding gate — cite-or-drop enforcement for LLM-sourced review
 * findings against a repo's mined-rule corpus.
 *
 * Host-agnostic and pure: this module never touches a database or the
 * network itself. A host (kern-guard's worker) supplies a `RuleCorpus`
 * implementation over its own storage and, optionally, an LLM-backed
 * `evaluateEntailment` judge. `groundFindings` is a plain async function —
 * fully testable without Postgres.
 *
 * ## Tier A — ruleId membership (enforced from day 1)
 * A finding eligible for grounding (see `isGroundingEligible`) must carry
 * a `citation.ruleId` that exists in `corpus.listRuleIds()`. Generalizes
 * the existing cite-or-drop precedent in kern-guard's
 * `review-pr-custom-rules.ts` (`toScoredFindings`, ruleId membership drop)
 * to the general LLM review pass.
 *
 * ## Tier B — violation-entailment judge (SHADOW until a host flips it)
 * History: an earlier semantic-coverage design (finding text embedding-
 * matched against rule text) and a structural-consistency redesign
 * (filePattern / severity / span-in-diff checks) were BOTH adversarially
 * killed in design review — coverage proves the finding *discusses* the
 * rule, not that the code *violates* it (parroting passes); the
 * structural checks were no-ops against wildcard rule metadata and
 * inverted safety on legitimate severity escalations. Neither ships here.
 *
 * Tier B v3 is a violation-entailment LLM judge: given the cited rule's
 * name+description, the finding's message+category+severity, and the
 * diff hunk containing the finding's span, the judge answers one
 * question — does this code actually violate this rule? Fail-closed:
 * judge says no, or the judge errors, drops the finding (reasons
 * `'entailment-failed'` / `'entailment-error'`).
 *
 * Tier B ships behind shadow machinery: `policy.tierB` defaults to
 * `'shadow'`, meaning would-drops are recorded in `GroundResult.shadowDrops`
 * but the finding stays in `grounded`. A host flips `policy.tierB` to
 * `'enforcing'` once shadow data shows a sane drop rate (host-side
 * `shadowUntil` expiry is a kern-guard concern, not tracked here).
 */

import type { ReviewFinding, RuleCitation } from './types.js';

// ── Corpus contract ─────────────────────────────────────────────────────

/** Citable text for one mined rule — Tier B judge input. */
export interface RuleText {
  name: string;
  description: string;
}

/** Tier B violation-entailment judge input. */
export interface EntailmentJudgeInput {
  rule: RuleText;
  finding: { message: string; category: string; severity: string };
  /** The diff hunk containing the finding's span — real code context so
   *  the judge isn't reasoning from the finding's own (possibly wrong)
   *  self-report alone. */
  diffHunk: string;
}

/** Tier B violation-entailment judge output. */
export interface EntailmentJudgeResult {
  violates: boolean;
  reason: string;
}

/**
 * Host-supplied view over the repo's mined-rule corpus. kern-guard's
 * adapter wraps the `repoRules` table; other hosts can implement this
 * over any storage.
 */
export interface RuleCorpus {
  /** All ruleIds currently mined/active for this repo. */
  listRuleIds(): string[];
  /**
   * False when the corpus itself failed to load (DB unreachable, or the
   * miner has never run for this repo at all). Distinct from a corpus
   * that loaded successfully with zero rules — see `'no-rules-in-repo'`
   * vs `'corpus-unavailable'` below.
   */
  readonly available: boolean;
  /**
   * Sync lookup of a mined rule's citable name+description, keyed by
   * ruleId. Returns `undefined` when the row is missing OR duplicated
   * (ambiguous) — callers fail closed on `undefined` (reason
   * `'rule-meta-invalid'`). Optional: a corpus that doesn't implement this
   * runs Tier-A-only grounding (Tier B is skipped, never a hard failure).
   */
  getRuleText?(ruleId: string): RuleText | undefined;
  /**
   * Tier B v3 judge. Optional: a corpus that doesn't implement this runs
   * Tier-A-only grounding.
   */
  evaluateEntailment?(input: EntailmentJudgeInput): Promise<EntailmentJudgeResult>;
}

// ── Policy ───────────────────────────────────────────────────────────────

export type GroundingDropReason =
  | 'no-citation'
  | 'unknown-rule-id'
  | 'rule-meta-invalid'
  | 'entailment-failed'
  | 'entailment-error'
  | 'corpus-unavailable'
  | 'no-rules-in-repo';

export interface DroppedFinding {
  finding: ReviewFinding;
  reason: GroundingDropReason;
  /** Present only for entailment-tier drops/would-drops — the judge's
   *  stated reason (or the caught error message), surfaced for shadow-mode
   *  log review and telemetry. */
  detail?: string;
}

export interface GroundingPolicy {
  /**
   * Governs BOTH empty-corpus paths — `corpus.available === false`
   * ('corpus-unavailable') and a corpus that loaded with zero rules
   * ('no-rules-in-repo'). The distinction between the two reasons is
   * telemetry-only (miner regression vs steady no-signal state); the
   * drop-vs-pass-through *behavior* is identical for both.
   *
   * 'drop-all' (default) — every grounding-eligible finding drops.
   * 'pass-through-labeled' — findings pass through with whatever citation
   * emission produced, for hosts that prefer fail-open over fail-closed.
   */
  onCorpusUnavailable: 'drop-all' | 'pass-through-labeled';
  /**
   * Tier B rollout mode. 'shadow' (default) — evaluate the judge and
   * record would-drops in `GroundResult.shadowDrops`, never remove the
   * finding from `grounded`. 'enforcing' — actual drops move to
   * `GroundResult.dropped`. A host flips this once its `shadowUntil`
   * expires; this module does not track dates itself.
   */
  tierB?: 'shadow' | 'enforcing';
  /**
   * Resolve the diff hunk text containing a finding's span, for the Tier B
   * judge. Returning `undefined` for a given finding (or omitting this
   * hook entirely) skips Tier B for that finding — additive scrutiny only,
   * never a way to introduce a new hard requirement without diff context.
   */
  getDiffHunk?: (finding: ReviewFinding) => string | undefined;
}

const DEFAULT_POLICY: GroundingPolicy = { onCorpusUnavailable: 'drop-all', tierB: 'shadow' };

export interface GroundResult {
  grounded: ReviewFinding[];
  dropped: DroppedFinding[];
  /**
   * Tier B shadow would-drops. Findings here ALSO appear in `grounded`
   * (shadow mode never removes a finding) — this list is purely for the
   * host to log/telemetry so shadow calibration data can be inspected.
   * Empty when `policy.tierB === 'enforcing'` (would-drops there are real
   * drops, reported in `dropped` instead) or when Tier B isn't wired.
   */
  shadowDrops: DroppedFinding[];
}

// ── Gate scope ───────────────────────────────────────────────────────────

/**
 * Only `source === 'llm'` findings are grounding-eligible — the existing
 * discriminant on `ReviewFinding` (types.ts), not a new provenance kind.
 *
 * Custom-rule findings (kern-guard's `review-pr-custom-rules.ts`) also
 * carry `source: 'llm'` but are EXEMPT: they already passed a membership
 * check against a DIFFERENT corpus (the installation's `CustomRule` table,
 * not the mined `repoRules` table) at construction time
 * (`toScoredFindings`, ruleId membership drop). Their `ruleId` always has
 * the stable `custom/` prefix (see kern-guard's `CustomRulesPanel.tsx`,
 * which renders the same prefix back to users) — running Tier A against
 * the mined-rule corpus for these would drop 100% of them as
 * `'unknown-rule-id'` since their ruleId namespace never overlaps with the
 * mined corpus.
 */
export function isGroundingEligible(finding: ReviewFinding): boolean {
  if (finding.source !== 'llm') return false;
  if (finding.ruleId.startsWith('custom/')) return false;
  return true;
}

// ── Gate ─────────────────────────────────────────────────────────────────

export async function groundFindings(
  findings: ReviewFinding[],
  corpus: RuleCorpus,
  policy: GroundingPolicy = DEFAULT_POLICY,
): Promise<GroundResult> {
  const grounded: ReviewFinding[] = [];
  const dropped: DroppedFinding[] = [];
  const shadowDrops: DroppedFinding[] = [];
  const tierBMode = policy.tierB ?? 'shadow';

  // Empty-corpus short-circuit — see GroundingPolicy.onCorpusUnavailable.
  const emptyReason: GroundingDropReason | null = !corpus.available
    ? 'corpus-unavailable'
    : corpus.listRuleIds().length === 0
      ? 'no-rules-in-repo'
      : null;
  if (emptyReason !== null) {
    for (const finding of findings) {
      if (!isGroundingEligible(finding)) {
        grounded.push(finding);
        continue;
      }
      if (policy.onCorpusUnavailable === 'pass-through-labeled') {
        grounded.push(finding);
      } else {
        dropped.push({ finding, reason: emptyReason });
      }
    }
    return { grounded, dropped, shadowDrops };
  }

  const ruleIds = new Set(corpus.listRuleIds());
  const tierBWired = typeof corpus.getRuleText === 'function' && typeof corpus.evaluateEntailment === 'function';

  for (const finding of findings) {
    if (!isGroundingEligible(finding)) {
      grounded.push(finding);
      continue;
    }

    const citation = finding.citation;
    if (!citation?.ruleId) {
      dropped.push({ finding, reason: 'no-citation' });
      continue;
    }
    if (!ruleIds.has(citation.ruleId)) {
      dropped.push({ finding, reason: 'unknown-rule-id' });
      continue;
    }

    // Tier A passed. Normalize groundedBy to 'membership' (emission already
    // sets this, but a defensive rebuild costs nothing and keeps the
    // invariant local to this module rather than trusting every caller).
    const tierAGrounded: ReviewFinding =
      citation.groundedBy === 'membership'
        ? finding
        : { ...finding, citation: { ...citation, groundedBy: 'membership' } };

    if (!tierBWired) {
      grounded.push(tierAGrounded);
      continue;
    }

    // Tier B — metadata validation runs unconditionally once the corpus
    // wires getRuleText, independent of whether a diff hunk is resolvable
    // for THIS finding: a missing/duplicated rule-text row is a corpus
    // integrity fault, not a calibration question, so it is never a
    // shadow-only concern.
    const ruleText = corpus.getRuleText!(citation.ruleId);
    if (!ruleText) {
      dropped.push({ finding: tierAGrounded, reason: 'rule-meta-invalid' });
      continue;
    }

    const diffHunk = policy.getDiffHunk?.(finding);
    if (diffHunk === undefined) {
      // No diff context available for this finding — Tier B skipped,
      // Tier-A grounding stands.
      grounded.push(tierAGrounded);
      continue;
    }

    let judgeResult: EntailmentJudgeResult | undefined;
    let judgeErrorDetail: string | undefined;
    try {
      judgeResult = await corpus.evaluateEntailment!({
        rule: ruleText,
        finding: { message: finding.message, category: finding.category, severity: finding.severity },
        diffHunk,
      });
    } catch (err) {
      judgeErrorDetail = err instanceof Error ? err.message : String(err);
    }

    if (judgeErrorDetail !== undefined) {
      const drop: DroppedFinding = { finding: tierAGrounded, reason: 'entailment-error', detail: judgeErrorDetail };
      if (tierBMode === 'enforcing') {
        dropped.push(drop);
      } else {
        shadowDrops.push(drop);
        grounded.push(tierAGrounded);
      }
      continue;
    }

    if (judgeResult && !judgeResult.violates) {
      const drop: DroppedFinding = { finding: tierAGrounded, reason: 'entailment-failed', detail: judgeResult.reason };
      if (tierBMode === 'enforcing') {
        dropped.push(drop);
      } else {
        shadowDrops.push(drop);
        grounded.push(tierAGrounded);
      }
      continue;
    }

    // judgeResult.violates === true — entailment confirmed. Upgrade the
    // citation so downstream consumers can see the stronger grounding tier.
    grounded.push({
      ...tierAGrounded,
      citation: { ...tierAGrounded.citation!, groundedBy: 'entailment', entailment: judgeResult! },
    });
  }

  return { grounded, dropped, shadowDrops };
}

export type { RuleCitation };
