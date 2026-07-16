#!/usr/bin/env node
/**
 * T10 self-hosted checker subset gate.
 *
 * Byte-compares the KERN checker in examples/capstone-checker-subset/checker.kern
 * against the TS reference over the same frozen t10.v2 structural rows. The TS
 * reference cites production print/fmt contracts; the flattener is deliberately
 * structural and carries no verdict/provenance fields.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { checkFlatModule } from './capstone-checker-subset/reference.mjs';
import { flattenKernSource } from './capstone-checker-subset/flatten-kern.mjs';
import { FIXTURES, RED_TEAM_ATTEMPTS, SAFE_INTEGER_TEXT_CASES } from './capstone-checker-subset/fixtures.mjs';
import {
  generateCheckerMainKern,
  generateNumericMainKern,
} from './capstone-checker-subset/gen-fixtures-kern.mjs';
import { loadSelfhostSmokePolicy } from './selfhost-smoke-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = resolve(ROOT, 'packages/cli/dist/cli.js');
const MAIN_KERN = resolve(ROOT, 'examples/capstone-checker-subset/main.kern');
const NUMERIC_MAIN_KERN = resolve(ROOT, 'examples/capstone-checker-subset/numeric-main.kern');
const SELFHOST_SMOKE_POLICY = loadSelfhostSmokePolicy(resolve(ROOT, 'scripts/selfhost-smoke-policy.json'));
const CAPSTONE_CHECKER_SUBSET_TIMEOUT_MS = SELFHOST_SMOKE_POLICY.timeouts.capstoneCheckerSubsetMs;

function runChecker(target) {
  return spawnSync(process.execPath, [CLI, 'run', target], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    timeout: CAPSTONE_CHECKER_SUBSET_TIMEOUT_MS,
  });
}

if (!existsSync(CLI)) {
  console.error(`missing built CLI at ${CLI}; run pnpm --filter @kernlang/cli build first`);
  process.exit(2);
}

const generated = generateCheckerMainKern();
let onDisk = '';
try {
  onDisk = readFileSync(MAIN_KERN, 'utf8');
} catch {
  console.error(`missing ${MAIN_KERN} - run: node scripts/capstone-checker-subset/gen-fixtures-kern.mjs`);
  process.exit(1);
}
if (onDisk !== generated) {
  console.error(`${MAIN_KERN} is stale - run: node scripts/capstone-checker-subset/gen-fixtures-kern.mjs`);
  process.exit(1);
}
const numericGenerated = generateNumericMainKern();
let numericOnDisk = '';
try {
  numericOnDisk = readFileSync(NUMERIC_MAIN_KERN, 'utf8');
} catch {
  console.error(`missing ${NUMERIC_MAIN_KERN} - run: node scripts/capstone-checker-subset/gen-fixtures-kern.mjs`);
  process.exit(1);
}
if (numericOnDisk !== numericGenerated) {
  console.error(`${NUMERIC_MAIN_KERN} is stale - run: node scripts/capstone-checker-subset/gen-fixtures-kern.mjs`);
  process.exit(1);
}

const expectedLines = [];
let polarityFailures = 0;
for (const fixture of FIXTURES) {
  const flat = flattenKernSource(fixture.path, fixture.source());
  const lines = checkFlatModule(flat);
  expectedLines.push(...lines);
  const rejected = lines.some((line) => line.includes('|reject|'));
  if (fixture.expected === 'accept' && rejected) {
    console.error(`fixture ${fixture.id}: TS reference rejected an accept fixture:\n${lines.join('\n')}`);
    polarityFailures += 1;
  }
  if (fixture.expected === 'reject' && !rejected) {
    console.error(`fixture ${fixture.id}: TS reference accepted a red-team fixture`);
    polarityFailures += 1;
  }
  for (const expectedReject of fixture.expectedRejects ?? []) {
    if (!lines.some((line) => line.includes(`|${expectedReject}`))) {
      console.error(`fixture ${fixture.id}: missing required reject ${expectedReject}`);
      polarityFailures += 1;
    }
  }
}
if (polarityFailures > 0) process.exit(1);

const result = runChecker(MAIN_KERN);

if (result.error) {
  console.error(result.error.message);
  process.exit(2);
}
if (result.signal) {
  console.error(`capstone checker subset was killed by signal ${result.signal}`);
  if (result.stderr) console.error(result.stderr);
  process.exit(2);
}
if (result.status !== 0) {
  console.error(`capstone checker subset (kern run) exited ${result.status}`);
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}
if (result.stderr) {
  console.error(`capstone checker subset emitted unexpected stderr:\n${result.stderr}`);
  process.exit(1);
}

const actualLines = (result.stdout ?? '').split('\n');
if (actualLines.at(-1) === '') actualLines.pop();
if (!sameLines(actualLines, expectedLines)) {
  console.error('capstone checker subset byte-compare failed');
  printDiff(actualLines, expectedLines);
  process.exit(1);
}

verifyAcceptedRunnableFixtures();
verifyKernSafeIntegerPredicate();

console.log(
  `capstone checker subset: ${FIXTURES.length}/${FIXTURES.length} fixtures byte-match TS reference; ` +
    `${RED_TEAM_ATTEMPTS.length} accept-but-abstain attempts rejected`,
);

function verifyAcceptedRunnableFixtures() {
  const temp = mkdtempSync(join(tmpdir(), 'kern-checker-subset-'));
  for (const fixture of FIXTURES) {
    if (fixture.expected !== 'accept' || !fixture.runnable) continue;
    let target = resolve(ROOT, fixture.path);
    if (!existsSync(target)) {
      target = join(temp, fixture.id.replace(/[^a-z0-9_-]/gi, '_') + '.kern');
      writeFileSync(target, fixture.source());
    }
    const run = runChecker(target);
    if (run.status !== 0 || run.signal || run.error || run.stderr) {
      console.error(`accepted runnable fixture ${fixture.id} did not run cleanly`);
      if (run.error) console.error(run.error.message);
      if (run.signal) console.error(`signal: ${run.signal}`);
      if (run.stderr) console.error(run.stderr);
      process.exit(1);
    }
  }
}

function verifyKernSafeIntegerPredicate() {
  const run = runChecker(NUMERIC_MAIN_KERN);
  if (run.status !== 0 || run.signal || run.error || run.stderr) {
    console.error('direct KERN safe-integer predicate probe failed to execute cleanly');
    if (run.error) console.error(run.error.message);
    if (run.signal) console.error(`signal: ${run.signal}`);
    if (run.stderr) console.error(run.stderr);
    process.exit(1);
  }
  const actual = (run.stdout ?? '').trimEnd().split('\n');
  const expected = SAFE_INTEGER_TEXT_CASES.map(([, accepted], index) => `${index}:${String(accepted)}`);
  if (!sameLines(actual, expected)) {
    console.error('direct KERN safe-integer predicate byte-compare failed');
    printDiff(actual, expected);
    process.exit(1);
  }
}

function sameLines(actual, expected) {
  if (actual.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (actual[i] !== expected[i]) return false;
  }
  return true;
}

function printDiff(actual, expected) {
  const max = Math.max(actual.length, expected.length);
  for (let i = 0; i < max; i += 1) {
    if (actual[i] === expected[i]) continue;
    console.error(`line ${i + 1}`);
    console.error(`  expected: ${expected[i] ?? '<missing>'}`);
    console.error(`  actual:   ${actual[i] ?? '<missing>'}`);
    break;
  }
  console.error(`expected ${expected.length} lines, actual ${actual.length} lines`);
}
