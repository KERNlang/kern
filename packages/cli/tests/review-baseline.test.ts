import type { ReviewReport } from '@kernlang/review';
import {
  compareReportsToBaseline,
  createReviewBaseline,
  filterReportsToNewFindings,
  getReviewBaselineKeyForFinding,
  parseReviewBaseline,
} from '../src/review-baseline.js';

function report(filePath: string, findings: ReviewReport['findings']): ReviewReport {
  return {
    filePath,
    inferred: [],
    templateMatches: [],
    findings,
    stats: {
      totalLines: 1,
      coveredLines: 1,
      coveragePct: 100,
      totalTsTokens: 1,
      totalKernTokens: 1,
      reductionPct: 0,
      constructCount: 0,
    },
  };
}

describe('review baseline helpers', () => {
  it('creates a stable baseline file from reports', () => {
    const baseline = createReviewBaseline([
      report('a.ts', [
        {
          source: 'kern',
          ruleId: 'rule-a',
          severity: 'error',
          category: 'bug',
          message: 'A',
          primarySpan: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          fingerprint: 'fp-a',
        },
      ]),
    ]);

    expect(baseline.version).toBe(1);
    expect(baseline.entries).toHaveLength(1);
    expect(baseline.entries[0].filePath).toBe('a.ts');
    expect(baseline.entries[0].ruleId).toBe('rule-a');
  });

  it('parses baseline JSON and compares reports', () => {
    const baseline = createReviewBaseline([
      report('a.ts', [
        {
          source: 'kern',
          ruleId: 'rule-a',
          severity: 'error',
          category: 'bug',
          message: 'A',
          primarySpan: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          fingerprint: 'fp-a',
        },
      ]),
    ]);

    const parsed = parseReviewBaseline(JSON.stringify(baseline));
    const comparison = compareReportsToBaseline(
      [
        report('a.ts', [
          {
            source: 'kern',
            ruleId: 'rule-a',
            severity: 'error',
            category: 'bug',
            message: 'A',
            primarySpan: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
            fingerprint: 'fp-a',
          },
          {
            source: 'kern',
            ruleId: 'rule-b',
            severity: 'warning',
            category: 'pattern',
            message: 'B',
            primarySpan: { file: 'a.ts', startLine: 2, startCol: 1, endLine: 2, endCol: 1 },
            fingerprint: 'fp-b',
          },
        ]),
      ],
      parsed,
    );

    expect(comparison.knownCount).toBe(1);
    expect(comparison.newCount).toBe(1);
    expect(comparison.resolvedCount).toBe(0);
  });

  it('filters reports down to new findings only', () => {
    const reports = [
      report('a.ts', [
        {
          source: 'kern',
          ruleId: 'rule-a',
          severity: 'error',
          category: 'bug',
          message: 'A',
          primarySpan: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          fingerprint: 'fp-a',
        },
        {
          source: 'kern',
          ruleId: 'rule-b',
          severity: 'warning',
          category: 'pattern',
          message: 'B',
          primarySpan: { file: 'a.ts', startLine: 2, startCol: 1, endLine: 2, endCol: 1 },
          fingerprint: 'fp-b',
        },
      ]),
    ];
    const baseline = createReviewBaseline([
      report('a.ts', [
        {
          source: 'kern',
          ruleId: 'rule-a',
          severity: 'error',
          category: 'bug',
          message: 'A',
          primarySpan: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          fingerprint: 'fp-a',
        },
      ]),
    ]);

    const comparison = compareReportsToBaseline(reports, baseline);
    const filtered = filterReportsToNewFindings(reports, comparison);

    expect(filtered[0].findings).toHaveLength(1);
    expect(filtered[0].findings[0].ruleId).toBe('rule-b');
  });

  it('drops suppressed findings when filtering to new findings', () => {
    const finding = {
      source: 'kern' as const,
      ruleId: 'rule-a',
      severity: 'error' as const,
      category: 'bug' as const,
      message: 'A',
      primarySpan: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      fingerprint: 'fp-a',
    };

    const reports = [{ ...report('a.ts', [finding]), suppressedFindings: [finding] }];
    const baseline = createReviewBaseline([report('a.ts', [finding])]);
    const comparison = compareReportsToBaseline(reports, baseline);
    const filtered = filterReportsToNewFindings(reports, comparison);
    const filteredReport = filtered[0] as ReviewReport & { suppressedFindings?: typeof reports[0]['suppressedFindings'] };

    expect(filteredReport.findings).toEqual([]);
    expect(filteredReport.suppressedFindings).toEqual([]);
  });

  it('tracks known keys for baseline-aware SARIF output', () => {
    const finding = {
      source: 'kern' as const,
      ruleId: 'rule-a',
      severity: 'error' as const,
      category: 'bug' as const,
      message: 'A',
      primarySpan: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      fingerprint: 'fp-a',
    };

    const reports = [report('a.ts', [finding])];
    const baseline = createReviewBaseline(reports);
    const comparison = compareReportsToBaseline(reports, baseline);

    expect(comparison.knownKeys.has(getReviewBaselineKeyForFinding('a.ts', finding))).toBe(true);
    expect(comparison.newKeys.size).toBe(0);
  });
});
