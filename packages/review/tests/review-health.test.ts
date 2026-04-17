import { runESLint, runTSCDiagnosticsFromPaths } from '../src/external-tools.js';
import { formatReport } from '../src/reporter.js';
import { ReviewHealthBuilder } from '../src/review-health.js';
import type { ReviewReport } from '../src/types.js';

describe('ReviewHealthBuilder', () => {
  it('returns undefined when nothing was noted', () => {
    const b = new ReviewHealthBuilder();
    expect(b.build()).toBeUndefined();
  });

  it('dedupes entries by (subsystem, kind)', () => {
    const b = new ReviewHealthBuilder();
    b.noteKind('eslint', 'error', 'first');
    b.noteKind('eslint', 'error', 'second');
    b.noteKind('eslint', 'error', 'third');
    const h = b.build();
    expect(h).toBeDefined();
    expect(h?.entries.length).toBe(1);
    // First note wins — later duplicates are ignored so one failing subsystem can't flood the report.
    expect(h?.entries[0].message).toBe('first');
  });

  it('keeps distinct (subsystem, kind) pairs as separate entries', () => {
    const b = new ReviewHealthBuilder();
    b.noteKind('eslint', 'error', 'a');
    b.noteKind('eslint', 'skipped', 'b');
    b.noteKind('tsc', 'error', 'c');
    const h = b.build();
    expect(h?.entries.length).toBe(3);
  });

  it('reports status=partial when any entry is error-kind', () => {
    const b = new ReviewHealthBuilder();
    b.noteKind('eslint', 'skipped', 'optional');
    b.noteKind('call-graph', 'error', 'broken');
    expect(b.build()?.status).toBe('partial');
  });

  it('reports status=degraded when only skipped/fallback entries exist', () => {
    const b = new ReviewHealthBuilder();
    b.noteKind('eslint', 'skipped', 'not installed');
    b.noteKind('fs-project', 'fallback', 'in-memory');
    expect(b.build()?.status).toBe('degraded');
  });
});

describe('runESLint health reporting', () => {
  it('records a skipped entry when ESLint is not installed', async () => {
    const health = new ReviewHealthBuilder();
    // Real ESLint may or may not be present in test env — either way the function must not throw
    // and must leave health empty on success or populated on skip/error. We only assert the shape.
    const findings = await runESLint([], process.cwd(), health);
    expect(Array.isArray(findings)).toBe(true);
    // If ESLint is absent, there should be a health entry recording the skip.
    const h = health.build();
    if (h) {
      expect(['skipped', 'error']).toContain(h.entries[0].kind);
      expect(h.entries[0].subsystem).toBe('eslint');
    }
  });
});

describe('runTSCDiagnosticsFromPaths health reporting', () => {
  it('returns empty findings without health notes on empty input', () => {
    const health = new ReviewHealthBuilder();
    const findings = runTSCDiagnosticsFromPaths([], health);
    expect(findings).toEqual([]);
    expect(health.build()).toBeUndefined();
  });
});

describe('formatReport health banner', () => {
  const baseReport = (overrides: Partial<ReviewReport> = {}): ReviewReport => ({
    filePath: '/tmp/example.ts',
    inferred: [],
    templateMatches: [],
    findings: [],
    stats: {
      totalLines: 0,
      coveredLines: 0,
      coveragePct: 0,
      totalTsTokens: 0,
      totalKernTokens: 0,
      reductionPct: 0,
      constructCount: 0,
    },
    ...overrides,
  });

  it('does not render a banner when health is undefined', () => {
    const out = formatReport(baseReport());
    expect(out).not.toContain('DEGRADED');
    expect(out).not.toContain('PARTIAL');
  });

  it('renders DEGRADED banner for status=degraded', () => {
    const builder = new ReviewHealthBuilder();
    builder.noteKind('eslint', 'skipped', 'ESLint not installed — skipped');
    const out = formatReport(baseReport({ health: builder.build() }));
    expect(out).toContain('[DEGRADED]');
    expect(out).toContain('eslint (skipped)');
    expect(out).toContain('ESLint not installed — skipped');
  });

  it('renders PARTIAL banner for status=partial', () => {
    const builder = new ReviewHealthBuilder();
    builder.noteKind('call-graph', 'error', 'build failed');
    const out = formatReport(baseReport({ health: builder.build() }));
    expect(out).toContain('[PARTIAL]');
    expect(out).toContain('call-graph (error)');
  });
});
