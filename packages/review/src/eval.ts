import type { ReviewConfig, ReviewFinding, ReviewReport } from './types.js';

export interface ReviewEvalFindingExpectation {
  ruleId: string;
  file?: string;
  severity?: ReviewFinding['severity'];
  messageIncludes?: string;
  rootCauseKind?: NonNullable<ReviewFinding['rootCause']>['kind'];
  minCount?: number;
}

export interface ReviewEvalExpectations {
  present?: ReviewEvalFindingExpectation[];
  absent?: ReviewEvalFindingExpectation[];
  maxFindings?: number;
  maxErrors?: number;
  maxWarnings?: number;
  maxDurationMs?: number;
}

export interface ReviewEvalCaseConfig {
  target?: string;
  policy?: ReviewConfig['policy'];
  crossStackMode?: ReviewConfig['crossStackMode'];
  minConfidence?: number;
  maxErrors?: number;
  maxWarnings?: number;
  disabledRules?: string[];
  strict?: ReviewConfig['strict'];
  strictParse?: boolean;
  requireConfidenceAnnotations?: boolean;
}

export interface ReviewEvalCase {
  name: string;
  files: string[];
  graph?: boolean;
  maxDepth?: number;
  config?: ReviewEvalCaseConfig;
  expect: ReviewEvalExpectations;
}

export interface ReviewEvalManifest {
  schemaVersion?: 1;
  cases: ReviewEvalCase[];
}

export interface ReviewEvalCaseResult {
  name: string;
  passed: boolean;
  files: string[];
  findings: number;
  errors: number;
  warnings: number;
  notes: number;
  durationMs?: number;
  failures: string[];
}

export interface ReviewEvalSummary {
  passed: boolean;
  cases: number;
  passedCases: number;
  failedCases: number;
  failures: number;
  results: ReviewEvalCaseResult[];
}

export interface ReviewEvalRunMetadata {
  durationMs?: number;
}

export function normalizeReviewEvalManifest(value: unknown): ReviewEvalManifest {
  if (!isRecord(value)) throw new Error('eval manifest must be an object');
  const rawCases = value.cases;
  if (!Array.isArray(rawCases) || rawCases.length === 0) {
    throw new Error('eval manifest must contain a non-empty cases array');
  }

  return {
    schemaVersion: value.schemaVersion === undefined ? undefined : 1,
    cases: rawCases.map((entry, index) => normalizeReviewEvalCase(entry, index)),
  };
}

export function evaluateReviewReports(
  testCase: ReviewEvalCase,
  reports: readonly ReviewReport[],
  metadata: ReviewEvalRunMetadata = {},
): ReviewEvalCaseResult {
  const findings = reports.flatMap((report) => report.findings);
  const failures: string[] = [];
  const expected = testCase.expect ?? {};

  for (const expectation of expected.present ?? []) {
    const count = countMatches(findings, expectation);
    const minCount = expectation.minCount ?? 1;
    if (count < minCount) {
      failures.push(`expected ${describeExpectation(expectation)} at least ${minCount} time(s), found ${count}`);
    }
  }

  for (const expectation of expected.absent ?? []) {
    const count = countMatches(findings, expectation);
    if (count > 0) {
      failures.push(`expected no ${describeExpectation(expectation)}, found ${count}`);
    }
  }

  if (expected.maxFindings !== undefined && findings.length > expected.maxFindings) {
    failures.push(`expected at most ${expected.maxFindings} finding(s), found ${findings.length}`);
  }

  const errors = findings.filter((finding) => finding.severity === 'error').length;
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;
  const notes = findings.filter((finding) => finding.severity === 'info').length;

  if (expected.maxErrors !== undefined && errors > expected.maxErrors) {
    failures.push(`expected at most ${expected.maxErrors} error(s), found ${errors}`);
  }
  if (expected.maxWarnings !== undefined && warnings > expected.maxWarnings) {
    failures.push(`expected at most ${expected.maxWarnings} warning(s), found ${warnings}`);
  }
  if (
    expected.maxDurationMs !== undefined &&
    metadata.durationMs !== undefined &&
    metadata.durationMs > expected.maxDurationMs
  ) {
    failures.push(`expected duration <= ${expected.maxDurationMs}ms, observed ${metadata.durationMs}ms`);
  }

  return {
    name: testCase.name,
    passed: failures.length === 0,
    files: testCase.files,
    findings: findings.length,
    errors,
    warnings,
    notes,
    ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
    failures,
  };
}

export function summarizeReviewEvalResults(results: readonly ReviewEvalCaseResult[]): ReviewEvalSummary {
  const failedCases = results.filter((result) => !result.passed).length;
  return {
    passed: failedCases === 0,
    cases: results.length,
    passedCases: results.length - failedCases,
    failedCases,
    failures: results.reduce((sum, result) => sum + result.failures.length, 0),
    results: [...results],
  };
}

export function formatReviewEvalSummary(summary: ReviewEvalSummary): string {
  const lines = [
    'KERN Review Eval',
    '',
    `Cases: ${summary.passedCases}/${summary.cases} passed`,
    `Failures: ${summary.failures}`,
  ];

  for (const result of summary.results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    const duration = result.durationMs !== undefined ? `, ${result.durationMs}ms` : '';
    lines.push('', `${status} ${result.name} (${result.findings} findings${duration})`);
    for (const failure of result.failures) {
      lines.push(`  - ${failure}`);
    }
  }

  return lines.join('\n');
}

function normalizeReviewEvalCase(value: unknown, index: number): ReviewEvalCase {
  if (!isRecord(value)) throw new Error(`eval case ${index + 1} must be an object`);
  if (typeof value.name !== 'string' || value.name.length === 0) {
    throw new Error(`eval case ${index + 1} must declare a non-empty name`);
  }
  if (!Array.isArray(value.files) || value.files.some((file) => typeof file !== 'string')) {
    throw new Error(`eval case '${value.name}' must declare a files string array`);
  }
  if (!isRecord(value.expect)) {
    throw new Error(`eval case '${value.name}' must declare expect`);
  }

  return {
    name: value.name,
    files: value.files as string[],
    ...(value.graph !== undefined ? { graph: Boolean(value.graph) } : {}),
    ...(typeof value.maxDepth === 'number' ? { maxDepth: value.maxDepth } : {}),
    ...(isRecord(value.config) ? { config: value.config as ReviewEvalCaseConfig } : {}),
    expect: normalizeExpectations(value.expect),
  };
}

function normalizeExpectations(value: Record<string, unknown>): ReviewEvalExpectations {
  return {
    ...(Array.isArray(value.present)
      ? { present: value.present.map((entry) => normalizeFindingExpectation(entry)) }
      : {}),
    ...(Array.isArray(value.absent) ? { absent: value.absent.map((entry) => normalizeFindingExpectation(entry)) } : {}),
    ...(typeof value.maxFindings === 'number' ? { maxFindings: value.maxFindings } : {}),
    ...(typeof value.maxErrors === 'number' ? { maxErrors: value.maxErrors } : {}),
    ...(typeof value.maxWarnings === 'number' ? { maxWarnings: value.maxWarnings } : {}),
    ...(typeof value.maxDurationMs === 'number' ? { maxDurationMs: value.maxDurationMs } : {}),
  };
}

function normalizeFindingExpectation(value: unknown): ReviewEvalFindingExpectation {
  if (typeof value === 'string') return { ruleId: value };
  if (!isRecord(value) || typeof value.ruleId !== 'string') {
    throw new Error('finding expectation must be a rule id string or object with ruleId');
  }
  return {
    ruleId: value.ruleId,
    ...(typeof value.file === 'string' ? { file: value.file } : {}),
    ...(isSeverity(value.severity) ? { severity: value.severity } : {}),
    ...(typeof value.messageIncludes === 'string' ? { messageIncludes: value.messageIncludes } : {}),
    ...(typeof value.rootCauseKind === 'string'
      ? { rootCauseKind: value.rootCauseKind as ReviewEvalFindingExpectation['rootCauseKind'] }
      : {}),
    ...(typeof value.minCount === 'number' ? { minCount: value.minCount } : {}),
  };
}

function countMatches(findings: readonly ReviewFinding[], expectation: ReviewEvalFindingExpectation): number {
  return findings.filter((finding) => findingMatches(finding, expectation)).length;
}

function findingMatches(finding: ReviewFinding, expectation: ReviewEvalFindingExpectation): boolean {
  if (finding.ruleId !== expectation.ruleId) return false;
  if (expectation.severity && finding.severity !== expectation.severity) return false;
  if (expectation.messageIncludes && !finding.message.includes(expectation.messageIncludes)) return false;
  if (expectation.rootCauseKind && finding.rootCause?.kind !== expectation.rootCauseKind) return false;
  if (expectation.file && !pathMatches(finding.primarySpan.file, expectation.file)) return false;
  return true;
}

function pathMatches(actual: string, expected: string): boolean {
  const normalizedActual = normalizePath(actual);
  const normalizedExpected = normalizePath(expected);
  return normalizedActual === normalizedExpected || normalizedActual.endsWith(`/${normalizedExpected}`);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function describeExpectation(expectation: ReviewEvalFindingExpectation): string {
  const parts = [expectation.ruleId];
  if (expectation.file) parts.push(`in ${expectation.file}`);
  if (expectation.severity) parts.push(`severity=${expectation.severity}`);
  if (expectation.rootCauseKind) parts.push(`rootCause=${expectation.rootCauseKind}`);
  return parts.join(' ');
}

function isSeverity(value: unknown): value is ReviewFinding['severity'] {
  return value === 'error' || value === 'warning' || value === 'info';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
