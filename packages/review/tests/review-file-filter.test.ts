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

  it('isReviewableFile matches supported extensions and rejects docs/config/binary files', () => {
    for (const ext of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.kern', '.py']) {
      expect(isReviewableFile(`a${ext}`)).toBe(true);
    }
    for (const path of [
      'AGON.md',
      'package.json',
      'tsconfig.json',
      'patches/ink+5.2.1.patch',
      'config.yaml',
      'README',
      'image.png',
    ]) {
      expect(isReviewableFile(path)).toBe(false);
    }
  });

  it('reviewFile returns an empty report for .md files (no extra-code noise on docs)', () => {
    const md = join(tmp, 'README.md');
    writeFileSync(md, '# Project\n\nSome prose with many lines.\n\n## Section\n\nMore text.\n');
    const report = reviewFile(md);
    expect(report.findings).toEqual([]);
    expect(report.inferred).toEqual([]);
    expect(report.stats.totalLines).toBe(0);
  });

  it('reviewFile returns an empty report for package.json', () => {
    const pkg = join(tmp, 'package.json');
    writeFileSync(pkg, JSON.stringify({ name: 'x', version: '1.0.0', scripts: { test: 'echo' } }, null, 2));
    const report = reviewFile(pkg);
    expect(report.findings).toEqual([]);
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
