/**
 * ESM smoke test — imports the built dist/ output in a Node subprocess and runs
 * reviewFile/reviewSource end-to-end. Catches the class of bug where the source
 * tree tests pass (ts-jest transpiles from src/) but the published artifact is
 * broken: missing .js extensions, accidental CJS-only API usage, bad
 * moduleResolution fallout, or a transitive dep that only loads under one module
 * system. The original review assessment flagged one such bug that lived
 * undetected for weeks; this test closes that gap.
 *
 * Requirements: dist/ must exist. CI runs `pnpm build` before `pnpm test`, and
 * local developers using tsc project references have the same workflow. If dist/
 * is missing, the test fails loudly with a helpful message rather than skipping
 * silently — a silent skip here would re-create exactly the gap we're closing.
 */

import { execFileSync } from 'child_process';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

// Jest runs this test under ESM (see jest.config.js — extensionsToTreatAsEsm, useESM).
// __dirname is not defined in ESM scope, so derive it from import.meta.url the same way
// obligations-e2e.test.ts does.
const __dirname = dirname(fileURLToPath(import.meta.url));

describe('ESM smoke test (built dist)', () => {
  const distEntry = resolve(__dirname, '..', 'dist', 'index.js');

  // Guard: dist/ must exist. If not, fail loudly — silently skipping would defeat
  // the purpose of this test (catching ESM-only regressions in the published artifact).
  const distReady = existsSync(distEntry);

  it('has a built dist/index.js to test against', () => {
    if (!distReady) {
      throw new Error(
        `dist/index.js not found at ${distEntry}. Run \`pnpm --filter @kernlang/review build\` ` +
          `before running this test. CI runs Build before Test, so this should only fail locally.`,
      );
    }
    expect(distReady).toBe(true);
  });

  // Guarded so downstream tests don't cascade-fail on the same underlying issue.
  (distReady ? it : it.skip)('imports the built ESM entry and runs reviewSource', () => {
    const scriptPath = join(tmpdir(), `kernlang-review-esm-smoke-${process.pid}-${Date.now()}.mjs`);
    // Use a real temp file rather than -e "..." — inline scripts via -e get their working
    // directory from the caller, but more importantly a file makes failure easier to debug
    // because stack traces reference real source positions.
    const script = `
import { reviewSource, reviewFile, ReviewHealthBuilder, createFingerprint } from ${JSON.stringify(distEntry)};

const source = "export const x: number = 1;\\nexport function add(a: number, b: number): number { return a + b; }\\n";
const report = reviewSource(source, 'smoke.ts');

if (!report || typeof report.filePath !== 'string') {
  console.error('FAIL: reviewSource did not return a report with filePath');
  process.exit(1);
}
if (!Array.isArray(report.findings)) {
  console.error('FAIL: report.findings is not an array');
  process.exit(1);
}
if (!Array.isArray(report.inferred)) {
  console.error('FAIL: report.inferred is not an array');
  process.exit(1);
}

// Exercise the new ReviewHealthBuilder export too — catches the case where a newly added
// symbol was added to src/ but the build config silently excluded it.
const builder = new ReviewHealthBuilder();
builder.noteKind('eslint', 'skipped', 'test');
const health = builder.build();
if (!health || health.entries.length !== 1) {
  console.error('FAIL: ReviewHealthBuilder did not produce expected health');
  process.exit(1);
}

// Exercise a plain helper to confirm non-class exports work too.
const fp = createFingerprint('smoke', 1, 1);
if (typeof fp !== 'string') {
  console.error('FAIL: createFingerprint did not return a string');
  process.exit(1);
}

console.log('OK: filePath=' + report.filePath + ' inferred=' + report.inferred.length + ' findings=' + report.findings.length);
`;
    writeFileSync(scriptPath, script, 'utf8');
    try {
      const out = execFileSync(process.execPath, [scriptPath], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(out).toContain('OK:');
    } finally {
      try {
        unlinkSync(scriptPath);
      } catch {
        // Best-effort cleanup; a leftover temp file is not worth failing the test over.
      }
    }
  });
});
