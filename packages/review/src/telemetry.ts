import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { inferReviewPolicy } from './policy.js';
import { getRuleQualityProfile } from './rule-quality.js';
import type { ReviewFinding, ReviewPolicy, ReviewReport } from './types.js';

export interface ReviewTelemetryRule {
  ruleId: string;
  findings: number;
  suppressed: number;
  errors: number;
  warnings: number;
  notes: number;
  rootCauses: number;
  precision?: string;
  lifecycle?: string;
  ciDefault?: string;
}

export interface ReviewTelemetryFinding {
  file: string;
  ruleId: string;
  severity: ReviewFinding['severity'];
  confidence?: number;
  rootCauseKey?: string;
}

export interface ReviewTelemetrySnapshot {
  schemaVersion: 1;
  generatedAt: string;
  policy: ReviewPolicy;
  files: number;
  findings: {
    total: number;
    errors: number;
    warnings: number;
    notes: number;
  };
  suppressed: {
    total: number;
  };
  rootCauses: number;
  health: {
    status: 'ok' | 'degraded' | 'partial';
    errors: number;
    fallbacks: number;
    skipped: number;
  };
  rules: ReviewTelemetryRule[];
  performance?: {
    durationMs?: number;
  };
  findingRows?: ReviewTelemetryFinding[];
}

export interface ReviewTelemetryOptions {
  policy?: ReviewPolicy;
  generatedAt?: string;
  durationMs?: number;
  includeFindings?: boolean;
}

export interface WriteReviewTelemetryOptions extends ReviewTelemetryOptions {
  outputPath?: string;
  append?: boolean;
}

export interface WriteReviewTelemetryResult {
  outputPath: string;
  snapshot: ReviewTelemetrySnapshot;
}

export interface ReviewTelemetryRuleSummary extends ReviewTelemetryRule {
  runs: number;
  suppressionRate: number;
  averageFindingsPerRun: number;
}

export interface ReviewTelemetrySummary {
  runs: number;
  firstRun?: string;
  lastRun?: string;
  files: number;
  findings: {
    total: number;
    errors: number;
    warnings: number;
    notes: number;
  };
  suppressed: {
    total: number;
  };
  rootCauses: number;
  health: {
    partial: number;
    degraded: number;
    ok: number;
    errors: number;
    fallbacks: number;
    skipped: number;
  };
  performance: {
    averageDurationMs?: number;
    maxDurationMs?: number;
  };
  rules: ReviewTelemetryRuleSummary[];
  noisyRules: ReviewTelemetryRuleSummary[];
  promotionCandidates: ReviewTelemetryRuleSummary[];
}

export function buildReviewTelemetry(
  reports: readonly ReviewReport[],
  options: ReviewTelemetryOptions = {},
): ReviewTelemetrySnapshot {
  const findings = reports.flatMap((report) => report.findings);
  const suppressed = reports.flatMap((report) => report.suppressedFindings ?? []);
  const allForRuleCounts = [...findings, ...suppressed];
  const rootCauseKeys = new Set(findings.map((finding) => finding.rootCause?.key).filter(Boolean) as string[]);
  const healthEntries = reports.flatMap((report) => report.health?.entries ?? []);
  const rules = buildRuleTelemetry(allForRuleCounts, suppressed);

  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    policy: options.policy ?? inferReviewPolicy(),
    files: reports.length,
    findings: {
      total: findings.length,
      errors: findings.filter((finding) => finding.severity === 'error').length,
      warnings: findings.filter((finding) => finding.severity === 'warning').length,
      notes: findings.filter((finding) => finding.severity === 'info').length,
    },
    suppressed: {
      total: suppressed.length,
    },
    rootCauses: rootCauseKeys.size,
    health: {
      status: healthEntries.some((entry) => entry.kind === 'error')
        ? 'partial'
        : healthEntries.length > 0
          ? 'degraded'
          : 'ok',
      errors: healthEntries.filter((entry) => entry.kind === 'error').length,
      fallbacks: healthEntries.filter((entry) => entry.kind === 'fallback').length,
      skipped: healthEntries.filter((entry) => entry.kind === 'skipped').length,
    },
    rules,
    ...(options.durationMs !== undefined ? { performance: { durationMs: options.durationMs } } : {}),
    ...(options.includeFindings ? { findingRows: findings.map(toFindingRow) } : {}),
  };
}

export function writeReviewTelemetrySnapshot(
  reports: readonly ReviewReport[],
  options: WriteReviewTelemetryOptions = {},
): WriteReviewTelemetryResult {
  const outputPath = resolve(options.outputPath ?? '.kern/cache/review-telemetry.jsonl');
  const snapshot = buildReviewTelemetry(reports, options);
  mkdirSync(dirname(outputPath), { recursive: true });
  const line = `${JSON.stringify(snapshot)}\n`;
  if (options.append === false) {
    writeFileSync(outputPath, line, 'utf-8');
  } else {
    appendFileSync(outputPath, line, 'utf-8');
  }
  return { outputPath, snapshot };
}

export function parseReviewTelemetryJsonl(source: string): ReviewTelemetrySnapshot[] {
  const snapshots: ReviewTelemetrySnapshot[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(`telemetry line ${i + 1} is not valid JSON: ${(err as Error).message}`);
    }
    if (!isTelemetrySnapshot(parsed)) {
      throw new Error(`telemetry line ${i + 1} is not a KERN review telemetry snapshot`);
    }
    snapshots.push(parsed);
  }
  return snapshots;
}

export function readReviewTelemetrySnapshots(path: string): ReviewTelemetrySnapshot[] {
  return parseReviewTelemetryJsonl(readFileSync(path, 'utf-8'));
}

export function summarizeReviewTelemetry(snapshots: readonly ReviewTelemetrySnapshot[]): ReviewTelemetrySummary {
  const ruleMap = new Map<string, ReviewTelemetryRuleSummary>();
  const durations = snapshots.map((snapshot) => snapshot.performance?.durationMs).filter(isNumber);
  const sortedDates = snapshots.map((snapshot) => snapshot.generatedAt).sort();

  for (const snapshot of snapshots) {
    for (const rule of snapshot.rules) {
      const existing =
        ruleMap.get(rule.ruleId) ??
        ({
          ruleId: rule.ruleId,
          findings: 0,
          suppressed: 0,
          errors: 0,
          warnings: 0,
          notes: 0,
          rootCauses: 0,
          runs: 0,
          suppressionRate: 0,
          averageFindingsPerRun: 0,
          ...(rule.precision ? { precision: rule.precision } : {}),
          ...(rule.lifecycle ? { lifecycle: rule.lifecycle } : {}),
          ...(rule.ciDefault ? { ciDefault: rule.ciDefault } : {}),
        } satisfies ReviewTelemetryRuleSummary);

      existing.findings += rule.findings;
      existing.suppressed += rule.suppressed;
      existing.errors += rule.errors;
      existing.warnings += rule.warnings;
      existing.notes += rule.notes;
      existing.rootCauses += rule.rootCauses;
      existing.runs++;
      ruleMap.set(rule.ruleId, existing);
    }
  }

  const rules = Array.from(ruleMap.values())
    .map((rule) => {
      const totalObserved = rule.findings + rule.suppressed;
      return {
        ...rule,
        suppressionRate: totalObserved > 0 ? rule.suppressed / totalObserved : 0,
        averageFindingsPerRun: snapshots.length > 0 ? rule.findings / snapshots.length : 0,
      };
    })
    .sort((a, b) => b.findings + b.suppressed - (a.findings + a.suppressed) || a.ruleId.localeCompare(b.ruleId));

  return {
    runs: snapshots.length,
    ...(sortedDates[0] ? { firstRun: sortedDates[0] } : {}),
    ...(sortedDates[sortedDates.length - 1] ? { lastRun: sortedDates[sortedDates.length - 1] } : {}),
    files: snapshots.reduce((sum, snapshot) => sum + snapshot.files, 0),
    findings: {
      total: snapshots.reduce((sum, snapshot) => sum + snapshot.findings.total, 0),
      errors: snapshots.reduce((sum, snapshot) => sum + snapshot.findings.errors, 0),
      warnings: snapshots.reduce((sum, snapshot) => sum + snapshot.findings.warnings, 0),
      notes: snapshots.reduce((sum, snapshot) => sum + snapshot.findings.notes, 0),
    },
    suppressed: {
      total: snapshots.reduce((sum, snapshot) => sum + snapshot.suppressed.total, 0),
    },
    rootCauses: snapshots.reduce((sum, snapshot) => sum + snapshot.rootCauses, 0),
    health: {
      partial: snapshots.filter((snapshot) => snapshot.health.status === 'partial').length,
      degraded: snapshots.filter((snapshot) => snapshot.health.status === 'degraded').length,
      ok: snapshots.filter((snapshot) => snapshot.health.status === 'ok').length,
      errors: snapshots.reduce((sum, snapshot) => sum + snapshot.health.errors, 0),
      fallbacks: snapshots.reduce((sum, snapshot) => sum + snapshot.health.fallbacks, 0),
      skipped: snapshots.reduce((sum, snapshot) => sum + snapshot.health.skipped, 0),
    },
    performance: {
      ...(durations.length > 0
        ? {
            averageDurationMs: Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length),
            maxDurationMs: Math.max(...durations),
          }
        : {}),
    },
    rules,
    noisyRules: rules.filter((rule) => rule.suppressed >= 3 && rule.suppressionRate >= 0.5),
    promotionCandidates: rules.filter(
      (rule) =>
        rule.precision === 'high' &&
        rule.lifecycle === 'stable' &&
        rule.ciDefault !== 'on' &&
        rule.findings > 0 &&
        rule.suppressionRate <= 0.1,
    ),
  };
}

export function formatReviewTelemetrySummary(summary: ReviewTelemetrySummary): string {
  const lines = [
    'KERN Review Telemetry',
    '',
    `Runs: ${summary.runs}`,
    `Files: ${summary.files}`,
    `Findings: ${summary.findings.total} (${summary.findings.errors} errors, ${summary.findings.warnings} warnings, ${summary.findings.notes} notes)`,
    `Suppressed: ${summary.suppressed.total}`,
    `Root causes: ${summary.rootCauses}`,
    `Health: ${summary.health.ok} ok, ${summary.health.degraded} degraded, ${summary.health.partial} partial`,
  ];

  if (summary.performance.averageDurationMs !== undefined) {
    lines.push(
      `Duration: avg ${summary.performance.averageDurationMs}ms, max ${summary.performance.maxDurationMs ?? 0}ms`,
    );
  }

  lines.push('', 'Top Rules:');
  for (const rule of summary.rules.slice(0, 10)) {
    const suppressionPct = `${Math.round(rule.suppressionRate * 100)}%`;
    lines.push(
      `  ${rule.ruleId}: ${rule.findings} findings, ${rule.suppressed} suppressed (${suppressionPct} suppressed)`,
    );
  }

  if (summary.noisyRules.length > 0) {
    lines.push('', 'Noisy Rules:');
    for (const rule of summary.noisyRules.slice(0, 10)) {
      lines.push(`  ${rule.ruleId}: ${Math.round(rule.suppressionRate * 100)}% suppression rate`);
    }
  }

  if (summary.promotionCandidates.length > 0) {
    lines.push('', 'Promotion Candidates:');
    for (const rule of summary.promotionCandidates.slice(0, 10)) {
      lines.push(`  ${rule.ruleId}: high/stable with low suppression`);
    }
  }

  return lines.join('\n');
}

function buildRuleTelemetry(
  findings: readonly ReviewFinding[],
  suppressedFindings: readonly ReviewFinding[],
): ReviewTelemetryRule[] {
  const suppressedKeys = new Set(suppressedFindings.map((finding) => `${finding.ruleId}:${finding.fingerprint}`));
  const byRule = new Map<string, ReviewTelemetryRule & { rootCauseKeys: Set<string> }>();

  for (const finding of findings) {
    const existing = byRule.get(finding.ruleId) ?? makeRuleTelemetry(finding.ruleId);
    const isSuppressed = suppressedKeys.has(`${finding.ruleId}:${finding.fingerprint}`);
    if (isSuppressed) {
      existing.suppressed++;
    } else {
      existing.findings++;
      if (finding.severity === 'error') existing.errors++;
      else if (finding.severity === 'warning') existing.warnings++;
      else existing.notes++;
      if (finding.rootCause?.key) existing.rootCauseKeys.add(finding.rootCause.key);
    }
    byRule.set(finding.ruleId, existing);
  }

  return Array.from(byRule.values())
    .map(({ rootCauseKeys, ...rule }) => ({ ...rule, rootCauses: rootCauseKeys.size }))
    .sort((a, b) => b.findings - a.findings || a.ruleId.localeCompare(b.ruleId));
}

function makeRuleTelemetry(ruleId: string): ReviewTelemetryRule & { rootCauseKeys: Set<string> } {
  const profile = getRuleQualityProfile(ruleId);
  return {
    ruleId,
    findings: 0,
    suppressed: 0,
    errors: 0,
    warnings: 0,
    notes: 0,
    rootCauses: 0,
    rootCauseKeys: new Set<string>(),
    ...(profile
      ? {
          precision: profile.precision,
          lifecycle: profile.lifecycle,
          ciDefault: profile.ciDefault,
        }
      : {}),
  };
}

function toFindingRow(finding: ReviewFinding): ReviewTelemetryFinding {
  return {
    file: finding.primarySpan.file,
    ruleId: finding.ruleId,
    severity: finding.severity,
    ...(finding.confidence !== undefined ? { confidence: finding.confidence } : {}),
    ...(finding.rootCause?.key ? { rootCauseKey: finding.rootCause.key } : {}),
  };
}

function isTelemetrySnapshot(value: unknown): value is ReviewTelemetrySnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ReviewTelemetrySnapshot>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.generatedAt === 'string' &&
    typeof candidate.policy === 'string' &&
    typeof candidate.files === 'number' &&
    Boolean(candidate.findings) &&
    Boolean(candidate.suppressed) &&
    Array.isArray(candidate.rules)
  );
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
