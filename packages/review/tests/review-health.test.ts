import { runESLint, runTSCDiagnosticsFromPaths } from '../src/external-tools.js';
import { formatReport, formatSARIF } from '../src/reporter.js';
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

describe('formatSARIF health export', () => {
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

  it('emits an empty toolExecutionNotifications array when no health entries exist', () => {
    const sarif = JSON.parse(formatSARIF([baseReport()]));
    const notifications = sarif.runs[0].invocations[0].toolExecutionNotifications;
    expect(Array.isArray(notifications)).toBe(true);
    expect(notifications.length).toBe(0);
    // Clean run — executionSuccessful stays true so CI doesn't see a false-positive tool failure.
    expect(sarif.runs[0].invocations[0].executionSuccessful).toBe(true);
  });

  it('maps health kinds to SARIF notification levels', () => {
    const builder = new ReviewHealthBuilder();
    builder.noteKind('eslint', 'skipped', 'eslint not installed');
    builder.noteKind('fs-project', 'fallback', 'fell back to in-memory');
    builder.noteKind('call-graph', 'error', 'call graph failed');
    const sarif = JSON.parse(formatSARIF([baseReport({ health: builder.build() })]));
    const notifications = sarif.runs[0].invocations[0].toolExecutionNotifications;
    const byLevel = new Map(
      notifications.map((n: { level: string; descriptor: { id: string } }) => [n.level, n.descriptor.id]),
    );
    expect(byLevel.get('note')).toBe('kern/health/eslint');
    expect(byLevel.get('warning')).toBe('kern/health/fs-project');
    expect(byLevel.get('error')).toBe('kern/health/call-graph');
  });

  it('flips executionSuccessful to false when any notification is error-level', () => {
    const builder = new ReviewHealthBuilder();
    builder.noteKind('call-graph', 'error', 'failed');
    const sarif = JSON.parse(formatSARIF([baseReport({ health: builder.build() })]));
    expect(sarif.runs[0].invocations[0].executionSuccessful).toBe(false);
  });

  it('dedupes health entries across multiple reports', () => {
    // Two reports both carrying the same (subsystem, kind) health entry must collapse to one
    // SARIF notification — otherwise CI sees N copies of "ESLint skipped" for N reviewed files.
    const builder1 = new ReviewHealthBuilder();
    builder1.noteKind('eslint', 'skipped', 'eslint not installed');
    const builder2 = new ReviewHealthBuilder();
    builder2.noteKind('eslint', 'skipped', 'eslint not installed');
    const sarif = JSON.parse(
      formatSARIF([
        baseReport({ filePath: '/tmp/a.ts', health: builder1.build() }),
        baseReport({ filePath: '/tmp/b.ts', health: builder2.build() }),
      ]),
    );
    const notifications = sarif.runs[0].invocations[0].toolExecutionNotifications;
    expect(notifications.length).toBe(1);
  });

  it('preserves debug detail in notification properties when set', () => {
    const builder = new ReviewHealthBuilder();
    builder.noteKind('eslint', 'error', 'failed', 'underlying stack trace here');
    const sarif = JSON.parse(formatSARIF([baseReport({ health: builder.build() })]));
    const notif = sarif.runs[0].invocations[0].toolExecutionNotifications[0];
    expect(notif.properties['kern/detail']).toBe('underlying stack trace here');
    expect(notif.properties['kern/subsystem']).toBe('eslint');
    expect(notif.properties['kern/kind']).toBe('error');
  });
});
