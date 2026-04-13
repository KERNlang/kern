/**
 * Performance budget tests.
 *
 * Uses a warmup pass to eliminate JIT/cache variance, then measures
 * the second run. This makes the test stable across machines and
 * under parallel test contention.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { reviewFile, reviewSource } from '../src/index.js';

const SRC_DIR = join(import.meta.dirname, '..', 'src');

// Budget = 20s per file — extremely generous, catches only catastrophic regressions.
// Real perf tracking should use a dedicated benchmark, not CI tests.
const SINGLE_FILE_BUDGET = 20_000;
const BATCH_BUDGET = 60_000;

describe('Performance Budget', () => {
  // Warmup: load ts-morph, JIT compile review rules — first run is always slow
  beforeAll(() => {
    const source = readFileSync(join(SRC_DIR, 'cache.ts'), 'utf-8');
    reviewSource(source, 'warmup.ts');
  });

  it('single file review (in-memory) completes within budget', () => {
    const source = readFileSync(join(SRC_DIR, 'differ.ts'), 'utf-8');
    const start = Date.now();
    reviewSource(source, 'differ.ts');
    const elapsed = Date.now() - start;
    console.log(`  Single file (in-memory): ${elapsed}ms`);
    expect(elapsed).toBeLessThan(SINGLE_FILE_BUDGET);
  });

  it('single file review (from disk) completes within budget', () => {
    const start = Date.now();
    reviewFile(join(SRC_DIR, 'differ.ts'), { noCache: true });
    const elapsed = Date.now() - start;
    console.log(`  Single file (from disk): ${elapsed}ms`);
    expect(elapsed).toBeLessThan(SINGLE_FILE_BUDGET);
  });

  it('5-file batch review completes within budget', () => {
    const files = ['differ.ts', 'reporter.ts', 'file-role.ts', 'cache.ts', 'kern-lint.ts'];
    const start = Date.now();
    for (const f of files) {
      reviewFile(join(SRC_DIR, f), { noCache: true });
    }
    const elapsed = Date.now() - start;
    console.log(`  5-file batch: ${elapsed}ms (${(elapsed / files.length).toFixed(0)}ms/file)`);
    expect(elapsed).toBeLessThan(BATCH_BUDGET);
  });
});
