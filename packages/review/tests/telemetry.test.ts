import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildReviewTelemetry,
  formatReviewTelemetrySummary,
  parseReviewTelemetryJsonl,
  summarizeReviewTelemetry,
  writeReviewTelemetrySnapshot,
} from '../src/telemetry.js';
import type { ReviewFinding, ReviewReport } from '../src/types.js';

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    source: 'kern',
    ruleId: 'auth-drift',
    severity: 'warning',
    category: 'bug',
    message: 'Auth drift',
    primarySpan: { file: 'client.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 10 },
    fingerprint: 'auth-drift:1:1',
    confidence: 0.85,
    rootCause: {
      kind: 'api-call',
      key: 'api-call client=c1 method=GET path=/api/me',
      facets: { method: 'GET', path: '/api/me' },
    },
    ...overrides,
  };
}

function report(findings: ReviewFinding[], suppressedFindings: ReviewFinding[] = []): ReviewReport {
  return {
    filePath: 'client.ts',
    inferred: [],
    templateMatches: [],
    findings,
    ...(suppressedFindings.length > 0 ? { suppressedFindings } : {}),
    stats: {
      totalLines: 1,
      coveredLines: 0,
      coveragePct: 0,
      totalTsTokens: 0,
      totalKernTokens: 0,
      reductionPct: 0,
      constructCount: 0,
    },
  };
}

describe('review telemetry', () => {
  it('summarizes findings, root causes, suppression, and rule quality metadata', () => {
    const snapshot = buildReviewTelemetry(
      [
        report(
          [finding(), finding({ ruleId: 'contract-drift', severity: 'error', fingerprint: 'contract-drift:2:1' })],
          [finding({ fingerprint: 'suppressed-auth' })],
        ),
      ],
      { generatedAt: '2026-04-27T00:00:00.000Z', policy: 'ci', includeFindings: true },
    );

    expect(snapshot.policy).toBe('ci');
    expect(snapshot.findings).toEqual({ total: 2, errors: 1, warnings: 1, notes: 0 });
    expect(snapshot.suppressed.total).toBe(1);
    expect(snapshot.rootCauses).toBe(1);
    expect(snapshot.rules.find((rule) => rule.ruleId === 'auth-drift')).toMatchObject({
      findings: 1,
      suppressed: 1,
      precision: 'high',
      ciDefault: 'on',
    });
    expect(snapshot.findingRows).toHaveLength(2);
  });

  it('writes JSONL snapshots for persistent calibration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-review-telemetry-'));
    try {
      const outputPath = join(dir, 'telemetry.jsonl');
      writeReviewTelemetrySnapshot([report([finding()])], {
        outputPath,
        append: false,
        generatedAt: '2026-04-27T00:00:00.000Z',
      });
      writeReviewTelemetrySnapshot([report([finding({ fingerprint: 'auth-drift:2:1' })])], {
        outputPath,
        generatedAt: '2026-04-27T00:00:01.000Z',
      });

      const lines = readFileSync(outputPath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).schemaVersion).toBe(1);
      expect(JSON.parse(lines[1]).generatedAt).toBe('2026-04-27T00:00:01.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('aggregates telemetry snapshots into dashboard-ready rule stats', () => {
    const snapshots = parseReviewTelemetryJsonl(
      [
        JSON.stringify(
          buildReviewTelemetry([report([finding()], [finding({ fingerprint: 'suppressed-auth-1' })])], {
            generatedAt: '2026-04-27T00:00:00.000Z',
            durationMs: 100,
          }),
        ),
        JSON.stringify(
          buildReviewTelemetry(
            [
              report(
                [finding({ fingerprint: 'auth-drift:2:1' })],
                [finding({ fingerprint: 'suppressed-auth-2' }), finding({ fingerprint: 'suppressed-auth-3' })],
              ),
            ],
            { generatedAt: '2026-04-27T00:00:01.000Z', durationMs: 200 },
          ),
        ),
      ].join('\n'),
    );

    const summary = summarizeReviewTelemetry(snapshots);
    expect(summary.runs).toBe(2);
    expect(summary.performance.averageDurationMs).toBe(150);
    expect(summary.rules.find((rule) => rule.ruleId === 'auth-drift')).toMatchObject({
      findings: 2,
      suppressed: 3,
      suppressionRate: 0.6,
    });
    expect(summary.noisyRules.map((rule) => rule.ruleId)).toContain('auth-drift');
    expect(formatReviewTelemetrySummary(summary)).toContain('Noisy Rules');
  });
});
