#!/usr/bin/env node
/**
 * Item-2 self-hosting capstone CI gate: byte-compares the .kern assertion
 * engine's verdicts (examples/capstone-assertion-engine/{sort,compare,diag,
 * main}.kern, executed by `kern run`) against the TS assertion core's
 * verdicts (scripts/capstone/canon.mjs's `tsVerdict`, a cited verbatim copy
 * of scripts/conformance.mjs:1662's canon/sortValue/shapeOf) over the SAME
 * shared fixture corpus (scripts/capstone/fixtures.mjs).
 *
 * See .agon-goals/item2-capstone-spec.md for the full design. Release
 * blocker: wired into `pnpm test:runner-smoke` (package.json), which CI
 * already runs as its own step (.github/workflows/ci.yml) — this script
 * does not touch workflow YAML.
 *
 * Conventions follow scripts/check-kern-run-smoke.mjs: explicit exit codes,
 * no piped exit codes, build-then-run, drift check before executing.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tsVerdict } from './capstone/canon.mjs';
import { FIXTURES } from './capstone/fixtures.mjs';
import { generateMainKern } from './capstone/gen-fixtures-kern.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = resolve(ROOT, 'packages/cli/dist/cli.js');
const MAIN_KERN = resolve(ROOT, 'examples/capstone-assertion-engine/main.kern');

if (!existsSync(CLI)) {
  console.error(`missing built CLI at ${CLI}; run pnpm --filter @kernlang/cli build first`);
  process.exit(2);
}

// Regenerate main.kern from the shared fixture corpus so the .kern engine
// leg can never silently drift from scripts/capstone/fixtures.mjs (the
// single source of truth also used for the TS-verdict leg below).
const generated = generateMainKern();
writeFileSync(MAIN_KERN, generated);

const result = spawnSync(process.execPath, [CLI, 'run', MAIN_KERN], {
  encoding: 'utf-8',
  cwd: ROOT,
  env: { ...process.env, NODE_NO_WARNINGS: '1' },
  timeout: 20000,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(2);
}

if (result.signal) {
  console.error(`capstone assertion engine was killed by signal ${result.signal}`);
  if (result.stderr) console.error(result.stderr);
  process.exit(2);
}

if (result.status !== 0) {
  console.error(`capstone assertion engine (kern run) exited ${result.status}`);
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}

if (result.stderr) {
  console.error(`capstone assertion engine emitted unexpected stderr:\n${result.stderr}`);
  process.exit(1);
}

const stdout = result.stdout ?? '';
const lines = stdout.split('\n').filter((line) => line.length > 0);

if (lines.length !== FIXTURES.length) {
  console.error(
    `capstone assertion engine printed ${lines.length} result line(s), expected ${FIXTURES.length} (one per fixture) — count mismatch is a failure`,
  );
  console.error(`stdout:\n${stdout}`);
  process.exit(1);
}

let failures = 0;
for (let i = 0; i < FIXTURES.length; i += 1) {
  const fixture = FIXTURES[i];
  const line = lines[i];
  const parts = line.split('|');
  const [id, verdict, path, reason] = parts;

  if (parts.length !== 4) {
    console.error(`fixture "${fixture.id}": malformed result line (expected 4 "|"-separated fields): ${line}`);
    failures += 1;
    continue;
  }

  if (id !== fixture.id) {
    console.error(`fixture index ${i}: id mismatch — line says "${id}", fixture corpus says "${fixture.id}"`);
    failures += 1;
    continue;
  }

  const expected = tsVerdict(fixture.a, fixture.b);
  if (verdict !== expected) {
    console.error(
      `fixture "${fixture.id}": PASS/FAIL VERDICT DRIFT — .kern engine said ${verdict}, TS assertion core said ${expected} (${fixture.why})`,
    );
    failures += 1;
    continue;
  }

  // Structural sanity on the .kern engine's OWN diagnostics (not a TS-parity
  // requirement — the TS assertion core has no path/reason concept): PASS
  // must carry the "-"/"-" placeholders, FAIL must carry real path/reason
  // text.
  if (verdict === 'PASS' && (path !== '-' || reason !== '-')) {
    console.error(`fixture "${fixture.id}": PASS verdict must carry "-|-", got "${path}|${reason}"`);
    failures += 1;
    continue;
  }
  if (verdict === 'FAIL' && (path === '-' || reason === '-' || path === '' || reason === '')) {
    console.error(`fixture "${fixture.id}": FAIL verdict must carry a real path and reason, got "${path}|${reason}"`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\ncapstone assertion engine: ${failures}/${FIXTURES.length} fixture(s) failed`);
  process.exit(1);
}

console.log(`capstone assertion engine: ${FIXTURES.length}/${FIXTURES.length} fixtures byte-match the TS assertion core`);
