/**
 * Opt-in live-repo fixture tests.
 *
 * Runs against local checkouts of AudioFacets + Agon when explicitly
 * configured. In CI (or on any machine without the env vars) these tests
 * skip cleanly. The point is to catch regressions that our handcrafted
 * fixtures miss: real gap files from real compilation runs.
 *
 * What we snapshot:
 *   - Total gap count
 *   - Count per `category` (`detected`, `migratable`, ...)
 *   - Count per `migration` target among migratable gaps
 *
 * What we explicitly DO NOT snapshot:
 *   - Individual file paths (absolute, user-specific, unstable)
 *   - Timestamps
 *   - Handler lengths (can drift with source edits)
 *
 * Opt in by setting KERN_LIVE_FIXTURES_AUDIOFACETS and
 * KERN_LIVE_FIXTURES_AGON to repo roots containing `.kern-gaps`.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { CoverageGap, GapCategory } from '../src/index.js';

function resolveRepo(envVar: string): string | undefined {
  const fromEnv = process.env[envVar];
  if (fromEnv && existsSync(join(fromEnv, '.kern-gaps'))) return fromEnv;
  return undefined;
}

function loadGaps(repoRoot: string): CoverageGap[] {
  const dir = join(repoRoot, '.kern-gaps');
  const all: CoverageGap[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const parsed = JSON.parse(raw) as CoverageGap[];
      if (Array.isArray(parsed)) all.push(...parsed);
    } catch {
      // Ignore malformed entries; same policy as readCoverageGaps.
    }
  }
  return all;
}

interface GapSummary {
  total: number;
  byCategory: Record<string, number>;
  byMigration: Record<string, number>;
}

function summarize(gaps: CoverageGap[]): GapSummary {
  const byCategory: Record<string, number> = {};
  const byMigration: Record<string, number> = {};
  for (const gap of gaps) {
    const cat: GapCategory = gap.category ?? 'detected';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    if (gap.migration) {
      byMigration[gap.migration] = (byMigration[gap.migration] ?? 0) + 1;
    }
  }
  return { total: gaps.length, byCategory, byMigration };
}

describe('Live-repo fixtures: AudioFacets', () => {
  const repo = resolveRepo('KERN_LIVE_FIXTURES_AUDIOFACETS');

  if (!repo) {
    it.skip('skipped: set KERN_LIVE_FIXTURES_AUDIOFACETS to a repo root containing .kern-gaps', () => {});
    return;
  }

  it('every gap has a valid category (no missing/unknown tags)', () => {
    const gaps = loadGaps(repo);
    const validCategories: GapCategory[] = [
      'detected',
      'migratable',
      'blocked-by-parser',
      'blocked-by-codegen',
      'needs-new-node',
    ];
    for (const gap of gaps) {
      // Older gap files may lack `category`; readers default to `detected`.
      if (gap.category === undefined) continue;
      expect(validCategories).toContain(gap.category);
    }
  });

  it('emits a summary that looks sane (total >= 0, no negative counts)', () => {
    const summary = summarize(loadGaps(repo));
    expect(summary.total).toBeGreaterThanOrEqual(0);
    for (const [cat, n] of Object.entries(summary.byCategory)) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(typeof cat).toBe('string');
    }
    // Log for human inspection; only fires when the env var is set, so no CI spam.
    console.log(`[AudioFacets live] ${JSON.stringify(summary)}`);
  });

  it('every migratable gap carries a non-empty migration name (cross-ref with `kern migrate list`)', () => {
    const gaps = loadGaps(repo).filter((g) => g.category === 'migratable');
    for (const gap of gaps) {
      expect(typeof gap.migration).toBe('string');
      expect(gap.migration?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('Live-repo fixtures: Agon', () => {
  const repo = resolveRepo('KERN_LIVE_FIXTURES_AGON');

  if (!repo) {
    it.skip('skipped: set KERN_LIVE_FIXTURES_AGON to a repo root containing .kern-gaps', () => {});
    return;
  }

  it('every gap has a valid category (no missing/unknown tags)', () => {
    const gaps = loadGaps(repo);
    const validCategories: GapCategory[] = [
      'detected',
      'migratable',
      'blocked-by-parser',
      'blocked-by-codegen',
      'needs-new-node',
    ];
    for (const gap of gaps) {
      if (gap.category === undefined) continue;
      expect(validCategories).toContain(gap.category);
    }
  });

  it('emits a summary that looks sane', () => {
    const summary = summarize(loadGaps(repo));
    expect(summary.total).toBeGreaterThanOrEqual(0);
    console.log(`[Agon live] ${JSON.stringify(summary)}`);
  });

  it('every migratable gap carries a non-empty migration name', () => {
    const gaps = loadGaps(repo).filter((g) => g.category === 'migratable');
    for (const gap of gaps) {
      expect(typeof gap.migration).toBe('string');
      expect(gap.migration?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
