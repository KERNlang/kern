import { getRuleRegistry, type RuleInfo } from './rules/index.js';
import type { CalibrationStage, FileRole, ReviewConfig, ReviewFinding } from './types.js';

export type RulePrecision = NonNullable<RuleInfo['precision']>;
export type RuleLifecycle = NonNullable<RuleInfo['lifecycle']>;
export type RuleCiDefault = NonNullable<RuleInfo['ciDefault']>;

export interface RuleQualityProfile extends RuleInfo {
  precision: RulePrecision;
  lifecycle: RuleLifecycle;
  ciDefault: RuleCiDefault;
}

const GUARD_ADVISORY_RULES = new Set([
  'dead-export',
  'sync-in-async',
  'cognitive-complexity',
  'handler-size',
  'unhandled-async',
]);

let ruleInfoById: Map<string, RuleInfo> | undefined;

function getRuleInfoMap(): Map<string, RuleInfo> {
  if (ruleInfoById) return ruleInfoById;
  ruleInfoById = new Map();
  for (const info of getRuleRegistry()) {
    if (!ruleInfoById.has(info.id)) {
      ruleInfoById.set(info.id, info);
    }
  }
  return ruleInfoById;
}

function inferredPrecision(info: RuleInfo): RulePrecision {
  return info.precision ?? 'medium';
}

function inferredLifecycle(info: RuleInfo, precision: RulePrecision): RuleLifecycle {
  if (info.lifecycle) return info.lifecycle;
  if (precision === 'experimental') return 'experimental';
  if ((info.rolloutPhase ?? 0) > 0) return 'candidate';
  return 'stable';
}

function inferredCiDefault(info: RuleInfo, precision: RulePrecision, lifecycle: RuleLifecycle): RuleCiDefault {
  if (info.ciDefault) return info.ciDefault;
  if (info.severity === 'info') return 'off';
  if (precision === 'experimental' || lifecycle === 'experimental') return 'off';
  if (precision === 'medium' || lifecycle === 'candidate') return 'guarded';
  return 'on';
}

export function getRuleQualityProfile(ruleId: string): RuleQualityProfile | undefined {
  const info = getRuleInfoMap().get(ruleId);
  if (!info) return undefined;
  const precision = inferredPrecision(info);
  const lifecycle = inferredLifecycle(info, precision);
  const ciDefault = inferredCiDefault(info, precision, lifecycle);
  return { ...info, precision, lifecycle, ciDefault };
}

export function isRulePromotedForCi(ruleId: string): boolean {
  const profile = getRuleQualityProfile(ruleId);
  return profile?.ciDefault === 'on' && profile.lifecycle === 'stable';
}

/**
 * Apply review-mode calibration after confidence assignment and before suppression.
 *
 * Guard mode is the default for PR/CI review. It keeps high-signal errors visible,
 * but softens advisory and experimental findings to info so they do not compete
 * with correctness/security findings. Audit mode preserves original severities for
 * local investigations.
 *
 * Idempotent: each finding is calibrated at most once per process lifetime. The
 * `calibrated` flag prevents compounding multipliers when graph-mode rerun unions
 * already-calibrated per-file findings with newly-injected cross-file findings.
 *
 * Records each acting stage on `finding.calibrationTrail` so audit policy can
 * surface the calibration chain without recomputing it.
 */
export function applyRuleQualityCalibration(
  findings: ReviewFinding[],
  config?: Pick<ReviewConfig, 'crossStackMode'>,
): void {
  if (config?.crossStackMode === 'audit') return;

  for (const finding of findings) {
    if (finding.calibrated) continue;

    const profile = getRuleQualityProfile(finding.ruleId);
    const shouldDemote =
      GUARD_ADVISORY_RULES.has(finding.ruleId) ||
      profile?.ciDefault === 'off' ||
      profile?.precision === 'experimental' ||
      profile?.lifecycle === 'experimental';

    if (shouldDemote && finding.severity !== 'error') {
      const before = finding.severity;
      finding.severity = 'info';
      recordCalibration(finding, {
        stage: 'rule-quality:demote-advisory',
        factor: 1,
        reason: GUARD_ADVISORY_RULES.has(finding.ruleId)
          ? 'rule on guard-advisory list'
          : `rule lifecycle=${profile?.lifecycle ?? 'unknown'} precision=${profile?.precision ?? 'unknown'}`,
        beforeSeverity: before,
        afterSeverity: 'info',
      });
    }

    if (
      (profile?.precision === 'experimental' || profile?.lifecycle === 'experimental') &&
      finding.confidence !== undefined &&
      finding.confidence > 0.6
    ) {
      const before = finding.confidence;
      finding.confidence = 0.6;
      recordCalibration(finding, {
        stage: 'rule-quality:experimental-cap',
        factor: 0.6 / before,
        reason: 'experimental rule capped at 0.6',
        beforeConfidence: before,
        afterConfidence: 0.6,
      });
    }

    finding.calibrated = true;
  }
}

/** Append a calibration stage to a finding's trail. */
export function recordCalibration(finding: ReviewFinding, stage: CalibrationStage): void {
  if (!finding.calibrationTrail) finding.calibrationTrail = [];
  finding.calibrationTrail.push(stage);
}

/**
 * Per-rule confidence multipliers per file role. Default factor is 1.0 (no change).
 *
 * Design constraints driven by the Phase 1 red-team:
 *  - **No wildcards.** Every (role, ruleId) pair must be explicit. A `'*':0`
 *    entry would silently nuke security findings on any file misclassified as
 *    codegen — every entry is enumerated to avoid that.
 *  - **Security-layer rules are excluded by construction** at lookup time
 *    (see `roleMultiplierFor`). Even if a future edit accidentally lists a
 *    security rule here, it is ignored.
 *  - **NaN-safe.** Lookup returns 1 for any unmapped pair; we never let
 *    `undefined * confidence` propagate.
 */
const ROLE_MULTIPLIER: Record<FileRole, Partial<Record<string, number>>> = {
  barrel: {
    'dead-export': 0,
    'cognitive-complexity': 0,
    'handler-size': 0,
    'unhandled-async': 0.5,
  },
  codegen: {
    'dead-export': 0,
    'cognitive-complexity': 0,
    'handler-size': 0,
    'sync-in-async': 0,
    'unhandled-async': 0,
    'extra-code': 0,
    'inconsistent-pattern': 0,
    'style-difference': 0,
    'missing-type': 0,
  },
  example: {
    'dead-export': 0,
    'public-api': 0,
    'unhandled-async': 0.5,
    'cognitive-complexity': 0.5,
  },
  test: {
    'handler-size': 0.3,
    'sync-in-async': 0,
    'cognitive-complexity': 0.5,
    'dead-export': 0,
  },
  'rule-definition': {
    'cognitive-complexity': 0,
  },
  runtime: {},
};

/** Layer prefixes that are protected from any role multiplier. */
const PROTECTED_LAYER_PREFIXES = ['security'];

function isProtectedRule(ruleId: string): boolean {
  const info = getRuleInfoMap().get(ruleId);
  if (!info) return false;
  return PROTECTED_LAYER_PREFIXES.some((prefix) => info.layer.startsWith(prefix));
}

/** Look up the role-aware multiplier for a finding. Always returns a finite number in [0, 1]. */
export function roleMultiplierFor(role: FileRole, ruleId: string): number {
  if (isProtectedRule(ruleId)) return 1;
  const fromTable = ROLE_MULTIPLIER[role]?.[ruleId];
  if (typeof fromTable !== 'number' || !Number.isFinite(fromTable)) return 1;
  return Math.max(0, Math.min(1, fromTable));
}

/**
 * Apply role-aware confidence multipliers. Runs alongside applyRuleQualityCalibration
 * in guard/ci policies; skipped in audit policy.
 *
 * Idempotent via the same `calibrated` flag: once a finding has been through any
 * calibration stage it will not be touched again, so graph-mode rerun on a union
 * does not compound multipliers.
 */
export function applyRoleAwareConfidence(
  findings: ReviewFinding[],
  fileRole: FileRole,
  config?: Pick<ReviewConfig, 'crossStackMode'>,
): void {
  if (config?.crossStackMode === 'audit') return;

  for (const finding of findings) {
    if (finding.calibrated) continue;

    const factor = roleMultiplierFor(fileRole, finding.ruleId);
    if (factor === 1) continue;

    if (finding.confidence !== undefined) {
      const before = finding.confidence;
      const after = before * factor;
      finding.confidence = after;
      recordCalibration(finding, {
        stage: 'role-aware:confidence-multiplier',
        factor,
        reason: `role=${fileRole} reduces confidence on rule '${finding.ruleId}'`,
        beforeConfidence: before,
        afterConfidence: after,
      });
    } else {
      recordCalibration(finding, {
        stage: 'role-aware:confidence-multiplier',
        factor,
        reason: `role=${fileRole} reduces confidence on rule '${finding.ruleId}' (no native confidence set)`,
      });
    }
  }
}

export function applyRuleSupersession(
  findings: readonly ReviewFinding[],
  config?: Pick<ReviewConfig, 'crossStackMode'>,
): ReviewFinding[] {
  if (config?.crossStackMode === 'audit') return [...findings];

  const suppressedByRoot = new Map<string, Set<string>>();
  for (const finding of findings) {
    const supersedes = getRuleQualityProfile(finding.ruleId)?.supersedes;
    if (!supersedes || supersedes.length === 0) continue;

    const rootKey = findingRootKey(finding);
    const existing = suppressedByRoot.get(rootKey) ?? new Set<string>();
    for (const ruleId of supersedes) {
      existing.add(ruleId);
    }
    suppressedByRoot.set(rootKey, existing);
  }

  return findings.filter((finding) => {
    const suppressed = suppressedByRoot.get(findingRootKey(finding));
    return !suppressed?.has(finding.ruleId);
  });
}

function findingRootKey(finding: ReviewFinding): string {
  if (finding.rootCause?.key) return finding.rootCause.key;
  const span = finding.primarySpan;
  return `${span.file}:${span.startLine}:${span.startCol}`;
}

export interface RuleQualityIssue {
  ruleId: string;
  message: string;
}

/**
 * Lightweight self-check for registry hygiene. It is intentionally non-throwing so
 * tests and tooling can decide whether to warn or fail.
 */
export function validateRuleQualityRegistry(): RuleQualityIssue[] {
  const issues: RuleQualityIssue[] = [];
  const seen = new Set<string>();
  for (const info of getRuleRegistry()) {
    if (seen.has(info.id)) {
      issues.push({ ruleId: info.id, message: 'duplicate rule registry entry' });
      continue;
    }
    seen.add(info.id);

    const profile = getRuleQualityProfile(info.id);
    if (!profile) continue;
    if (profile.ciDefault === 'on' && !info.precision) {
      issues.push({ ruleId: info.id, message: 'CI-on rule must declare precision explicitly' });
    }
    if (profile.ciDefault === 'on' && profile.lifecycle !== 'stable') {
      issues.push({ ruleId: info.id, message: 'CI-on rule must be stable' });
    }
    if (profile.lifecycle === 'experimental' && profile.ciDefault === 'on') {
      issues.push({ ruleId: info.id, message: 'experimental rule cannot default to CI-on' });
    }
    if (profile.precision === 'experimental' && profile.severity === 'error') {
      issues.push({ ruleId: info.id, message: 'experimental rule should not default to error severity' });
    }
  }
  return issues;
}
