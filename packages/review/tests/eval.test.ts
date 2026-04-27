import {
  evaluateReviewReports,
  formatReviewEvalSummary,
  normalizeReviewEvalManifest,
  summarizeReviewEvalResults,
} from '../src/eval.js';
import type { ReviewFinding, ReviewReport } from '../src/types.js';

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    source: 'kern',
    ruleId: 'floating-promise',
    severity: 'error',
    category: 'bug',
    message: 'Promise returned from async function is not awaited',
    primarySpan: { file: '/repo/src/bug.ts', startLine: 3, startCol: 3, endLine: 3, endCol: 14 },
    fingerprint: 'floating-promise:3:3',
    ...overrides,
  };
}

function report(findings: ReviewFinding[]): ReviewReport {
  return {
    filePath: '/repo/src/bug.ts',
    inferred: [],
    templateMatches: [],
    findings,
    stats: {
      totalLines: 3,
      coveredLines: 0,
      coveragePct: 0,
      totalTsTokens: 0,
      totalKernTokens: 0,
      reductionPct: 0,
      constructCount: 0,
    },
  };
}

describe('review eval harness', () => {
  it('passes when present and absent expectations match reports', () => {
    const result = evaluateReviewReports(
      {
        name: 'floating promise',
        files: ['src/bug.ts'],
        expect: {
          present: [{ ruleId: 'floating-promise', file: 'src/bug.ts', severity: 'error' }],
          absent: [{ ruleId: 'hardcoded-secret' }],
          maxWarnings: 0,
        },
      },
      [report([finding()])],
      { durationMs: 20 },
    );

    expect(result.passed).toBe(true);
    expect(result.durationMs).toBe(20);
  });

  it('reports useful failures for missing findings and noisy extras', () => {
    const result = evaluateReviewReports(
      {
        name: 'clean case',
        files: ['src/clean.ts'],
        expect: {
          present: [{ ruleId: 'floating-promise' }],
          absent: [{ ruleId: 'empty-catch' }],
          maxFindings: 0,
        },
      },
      [report([finding({ ruleId: 'empty-catch', severity: 'warning', fingerprint: 'empty-catch:1:1' })])],
    );

    expect(result.passed).toBe(false);
    expect(result.failures.join('\n')).toContain('expected floating-promise');
    expect(result.failures.join('\n')).toContain('expected no empty-catch');
    expect(result.failures.join('\n')).toContain('at most 0 finding');
  });

  it('normalizes JSON manifest shape and formats summaries', () => {
    const manifest = normalizeReviewEvalManifest({
      schemaVersion: 1,
      cases: [{ name: 'case', files: ['a.ts'], graph: true, expect: { present: ['floating-promise'] } }],
    });
    expect(manifest.cases[0].graph).toBe(true);

    const summary = summarizeReviewEvalResults([
      {
        name: 'case',
        passed: false,
        files: ['a.ts'],
        findings: 0,
        errors: 0,
        warnings: 0,
        notes: 0,
        failures: ['expected floating-promise'],
      },
    ]);
    expect(summary.passed).toBe(false);
    expect(formatReviewEvalSummary(summary)).toContain('FAIL case');
  });
});
