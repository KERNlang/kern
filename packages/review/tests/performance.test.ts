/**
 * Performance budget tests.
 *
 * Uses a warmup pass to eliminate JIT/cache variance, then measures
 * the second run. This makes the test stable across machines and
 * under parallel test contention.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reviewFile, reviewGraph, reviewSource } from '../src/index.js';

const SRC_DIR = join(import.meta.dirname, '..', 'src');

// Budget = 20s per file — extremely generous, catches only catastrophic regressions.
// Real perf tracking should use a dedicated benchmark, not CI tests.
const SINGLE_FILE_BUDGET = 20_000;
const BATCH_BUDGET = 60_000;
const GRAPH_BUDGET = 60_000;

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

  it('small graph review completes within budget', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-review-graph-budget-'));
    try {
      const client = join(dir, 'client.ts');
      const server = join(dir, 'server.ts');
      writeFileSync(
        client,
        `
export async function loadMe() {
  return fetch('/api/me').then((response) => response.json());
}
`,
      );
      writeFileSync(
        server,
        `
const app = {
  get(_path: string, _handler: unknown) {}
};

app.get('/api/me', (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  res.json({ id: req.user.id });
});
`,
      );

      const start = Date.now();
      reviewGraph([client, server], { noCache: true }, { maxDepth: 0 });
      const elapsed = Date.now() - start;
      console.log(`  2-file graph: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(GRAPH_BUDGET);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
