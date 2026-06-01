import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isReviewableFile, reviewFile, reviewSource } from '../src/index.js';

describe('Review engine file-type filter', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'kern-review-filter-'));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('isReviewableFile matches code, kern, and config-file extensions; rejects binary/unsupported', () => {
    // Code + script + kern + python all reviewable as before.
    for (const ext of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.kern', '.py']) {
      expect(isReviewableFile(`a${ext}`)).toBe(true);
    }
    // Config-file analyzers in 3.6.0 — JSON/JSONC/Markdown now flow through
    // the same review pipeline (parallel non-ts-morph path under
    // src/config-files/). They emit focused structural findings only.
    for (const path of ['AGON.md', 'README.md', 'package.json', 'tsconfig.json', 'settings.jsonc']) {
      expect(isReviewableFile(path)).toBe(true);
    }
    // Still unreviewable — no analyzer for these.
    for (const path of ['patches/ink+5.2.1.patch', 'config.yaml', 'config.toml', 'README', 'image.png']) {
      expect(isReviewableFile(path)).toBe(false);
    }
  });

  it('reviewFile yields zero findings on a clean .md (well-structured headings, no images)', () => {
    const md = join(tmp, 'README.md');
    const source = '# Project\n\nSome prose with many lines.\n\n## Section\n\nMore text.\n';
    writeFileSync(md, source);
    const report = reviewFile(md);
    // Clean markdown — no skipped heading levels (h1 → h2 is fine), no images.
    expect(report.findings).toEqual([]);
    expect(report.inferred).toEqual([]);
    // Stats reflect the real file size now that .md is analyzed.
    expect(report.stats.totalLines).toBe(source.split('\n').length);
  });

  it('reviewFile yields zero findings on a clean package.json (no duplicate keys, parses cleanly)', () => {
    const pkg = join(tmp, 'package.json');
    writeFileSync(pkg, JSON.stringify({ name: 'x', version: '1.0.0', scripts: { test: 'echo' } }, null, 2));
    const report = reviewFile(pkg);
    expect(report.findings).toEqual([]);
  });

  it('reviewFile surfaces a parse error on malformed JSON (proves the config path actually runs)', () => {
    const pkg = join(tmp, 'broken.json');
    writeFileSync(pkg, '{"name": "x"');
    const report = reviewFile(pkg);
    const parseErrs = report.findings.filter((f) => f.ruleId.startsWith('json/parse/'));
    expect(parseErrs.length).toBeGreaterThan(0);
    expect(parseErrs[0]?.severity).toBe('error');
  });

  it('reviewFile returns an empty report for .patch files', () => {
    const patch = join(tmp, 'ink+5.2.1.patch');
    writeFileSync(patch, 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-old\n+new\n');
    const report = reviewFile(patch);
    expect(report.findings).toEqual([]);
  });

  it('reviewSource also respects the filter (guards in-memory callers)', () => {
    const report = reviewSource('# some markdown', 'fake.md');
    expect(report.findings).toEqual([]);
    expect(report.inferred).toEqual([]);
  });
});
