/**
 * Performance budget tests.
 *
 * Measures review time against this codebase (packages/review/src/).
 * Uses generous budgets to tolerate parallel test runner contention.
 * For accurate measurements, run in isolation: jest tests/performance.test.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { reviewFile, reviewSource } from '../src/index.js';

const SRC_DIR = join(import.meta.dirname, '..', 'src');

// Generous budgets — 10x typical to handle CI/parallel contention
const SINGLE_FILE_BUDGET = 10_000;
const BATCH_BUDGET = 30_000;

describe('Performance Budget', () => {
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
