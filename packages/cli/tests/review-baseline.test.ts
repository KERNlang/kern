import type { ReviewReport } from '@kernlang/review';
import {
  compareReportsToBaseline,
  createReviewBaseline,
  filterReportsToNewFindings,
  parseReviewBaseline,
  type ReviewBaselineFile,
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
          confidence: 0.9,
        },
      ]),
    ]);

    expect(baseline.version).toBe(2);
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
          confidence: 0.9,
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
            confidence: 0.9,
          },
          {
            source: 'kern',
            ruleId: 'rule-b',
            severity: 'warning',
            category: 'pattern',
            message: 'B',
            primarySpan: { file: 'a.ts', startLine: 2, startCol: 1, endLine: 2, endCol: 1 },
            fingerprint: 'fp-b',
            confidence: 0.8,
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
          confidence: 0.9,
        },
        {
          source: 'kern',
          ruleId: 'rule-b',
          severity: 'warning',
          category: 'pattern',
          message: 'B',
          primarySpan: { file: 'a.ts', startLine: 2, startCol: 1, endLine: 2, endCol: 1 },
          fingerprint: 'fp-b',
          confidence: 0.8,
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
          confidence: 0.9,
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
      confidence: 0.9,
    };

    const reports = [{ ...report('a.ts', [finding]), suppressedFindings: [finding] }];
    const baseline = createReviewBaseline([report('a.ts', [finding])]);
    const comparison = compareReportsToBaseline(reports, baseline);
    const filtered = filterReportsToNewFindings(reports, comparison);
    const filteredReport = filtered[0] as ReviewReport & {
      suppressedFindings?: (typeof reports)[0]['suppressedFindings'];
    };

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
      confidence: 0.9,
    };

    const reports = [report('a.ts', [finding])];
    const baseline = createReviewBaseline(reports);
    const comparison = compareReportsToBaseline(reports, baseline);

    const key = comparison.findingKeys.get(finding);
    expect(key).toBeDefined();
    expect(comparison.knownKeys.has(key!)).toBe(true);
    expect(comparison.newKeys.size).toBe(0);
  });

  // ── content-anchored identity (v2): line-shift resistance ──────────────────
  const SINK = 'el.innerHTML = row;';
  function xss(line: number, message = 'innerHTML risk'): ReviewReport['findings'][number] {
    return {
      source: 'kern',
      ruleId: 'xss-unsafe-html',
      severity: 'error',
      category: 'bug',
      message,
      primarySpan: { file: 'app.js', startLine: line, startCol: 3, endLine: line, endCol: 3 },
      fingerprint: `xss-unsafe-html:${line}:3`,
      confidence: 0.9,
    };
  }

  it('does not flag a pre-existing finding as new after lines shift above it', () => {
    const lineAt = (target: number) => (_f: string, line: number) => (line === target ? SINK : '');
    const baseline = createReviewBaseline([report('app.js', [xss(5)])], lineAt(5));
    expect(baseline.version).toBe(2);

    // 3 lines inserted above -> same finding now at line 8, identical content.
    const comparison = compareReportsToBaseline([report('app.js', [xss(8)])], baseline, lineAt(8));
    expect(comparison.knownCount).toBe(1);
    expect(comparison.newCount).toBe(0);
  });

  it('keeps identical-text findings distinct (occurrence index) and stable across shifts', () => {
    const allSink = () => SINK;
    const rows = (offset: number) => report('app.js', Array.from({ length: 18 }, (_v, i) => xss(1 + offset + i)));

    const baseline = createReviewBaseline([rows(0)], allSink);
    // Unrelated insertion of 5 lines above all 18 — same order/content.
    const shifted = compareReportsToBaseline([rows(5)], baseline, allSink);
    expect(shifted.knownCount).toBe(18);
    expect(shifted.newCount).toBe(0);

    // A genuinely-new 19th identical line IS flagged new.
    const withExtra = compareReportsToBaseline(
      [report('app.js', [...rows(5).findings, xss(24)])],
      baseline,
      allSink,
    );
    expect(withExtra.newCount).toBe(1);
    expect(withExtra.knownCount).toBe(18);
  });

  it('falls back to legacy line-based comparison for a v1 baseline', () => {
    const v1: ReviewBaselineFile = {
      version: 1,
      createdAt: '',
      entries: [
        {
          filePath: 'app.js',
          ruleId: 'xss-unsafe-html',
          severity: 'error',
          fingerprint: 'xss-unsafe-html:5:3',
          message: 'innerHTML risk',
        },
      ],
    };
    const sink = () => SINK;

    const same = compareReportsToBaseline([report('app.js', [xss(5)])], v1, sink);
    expect(same.baselineWasLegacy).toBe(true);
    expect(same.knownCount).toBe(1);

    // v1 is NOT shift-resistant: a moved finding reads as new until regenerated.
    const shifted = compareReportsToBaseline([report('app.js', [xss(8)])], v1, sink);
    expect(shifted.newCount).toBe(1);
  });
});
