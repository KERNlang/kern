#!/usr/bin/env node
/**
 * Native-eligibility GOLDEN SNAPSHOT generator — grammar-sovereignty phase 1,
 * step 0/1 (the regression wall).
 *
 * Drives the REAL classifiers (`classifyHandlerBodyAst` from
 * native-eligibility-ast.ts and `classifyClosureBlock` from
 * closure-eligibility.ts) over the curated corpus in
 * `scripts/eligibility-corpus.mjs`, then writes the sorted, stable snapshot to
 *
 *   packages/core/tests/__snapshots__/eligibility-golden.json
 *
 * Each row is `{ snippet, classifier, eligible, reason }`. The companion test
 * `packages/core/tests/eligibility-golden.test.ts` regenerates this in-memory
 * and asserts deep-equality — so the snapshot is a DRIFT WALL: any change to a
 * classifier verdict (intended or not) fails the test until this file is
 * regenerated and the diff reviewed.
 *
 * ── REGENERATION ────────────────────────────────────────────────────────────
 * The script reads the COMPILED classifiers from `packages/core/dist`, so build
 * core first:
 *
 *   pnpm --filter @kernlang/core build
 *   node scripts/eligibility-snapshot.mjs            # regenerate the golden JSON
 *   node scripts/eligibility-snapshot.mjs --check    # CI-style: fail if stale
 *
 * SHADOW-ONLY: this script and the snapshot it writes touch no production path.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSnapshot } from './eligibility-corpus.mjs';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SNAPSHOT_PATH = join(REPO, 'packages/core/tests/__snapshots__/eligibility-golden.json');

const { classifyHandlerBodyAst, classifyClosureBlock } = await import(
  join(REPO, 'packages/core/dist/index.js')
);

const rows = buildSnapshot({ classifyHandlerBodyAst, classifyClosureBlock });
// Trailing newline so the file is POSIX-clean and git-diff friendly.
const serialized = `${JSON.stringify(rows, null, 2)}\n`;

const checkMode = process.argv.includes('--check');
if (checkMode) {
  let onDisk;
  try {
    onDisk = readFileSync(SNAPSHOT_PATH, 'utf-8');
  } catch {
    console.error(`Missing snapshot: ${SNAPSHOT_PATH}\nRun: node scripts/eligibility-snapshot.mjs`);
    process.exit(1);
  }
  if (onDisk !== serialized) {
    console.error(
      'eligibility-golden.json is out of date.\n' +
        'Run: pnpm --filter @kernlang/core build && node scripts/eligibility-snapshot.mjs',
    );
    process.exit(1);
  }
  console.log(`eligibility-golden.json is current (${rows.length} rows).`);
  process.exit(0);
}

writeFileSync(SNAPSHOT_PATH, serialized);
console.log(`Wrote ${rows.length} rows → ${SNAPSHOT_PATH}`);
