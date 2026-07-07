#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIXTURES } from './selfhost-validator/fixtures.mjs';
import { generateMainKern } from './selfhost-validator/gen-fixtures-kern.mjs';
import {
  expectedLines,
  expectedLinesForFixture,
  productionFirstError,
  productionHelperSnapshot,
} from './selfhost-validator/reference.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = resolve(ROOT, 'packages/cli/dist/cli.js');
const MAIN_KERN = resolve(ROOT, 'examples/selfhost-validator/main.kern');

if (!existsSync(CLI)) {
  console.error(`missing built CLI at ${CLI}; run pnpm --filter @kernlang/cli build first`);
  process.exit(2);
}

const generated = generateMainKern();
let onDisk;
try {
  onDisk = readFileSync(MAIN_KERN, 'utf-8');
} catch {
  console.error(`missing ${MAIN_KERN} — run: node scripts/selfhost-validator/gen-fixtures-kern.mjs`);
  process.exit(1);
}
if (onDisk !== generated) {
  console.error(
    `${MAIN_KERN} is stale (does not match scripts/selfhost-validator/fixtures.mjs) — run: node scripts/selfhost-validator/gen-fixtures-kern.mjs`,
  );
  process.exit(1);
}

let productionDisagreements = 0;
for (const fixture of FIXTURES) {
  const expectsPass = expectedLinesForFixture(fixture).every((line) => line === `${fixture.id}|PASS`);
  const productionError = productionFirstError(fixture);
  productionHelperSnapshot(fixture);
  if (expectsPass && productionError !== null) {
    console.error(`fixture "${fixture.id}": TS production runner failed a PASS fixture: ${productionError}`);
    productionDisagreements += 1;
  }
  if (!expectsPass && productionError === null) {
    console.error(`fixture "${fixture.id}": TS production runner passed a FAIL fixture`);
    productionDisagreements += 1;
  }
}
if (productionDisagreements > 0) {
  console.error(`selfhost validator: ${productionDisagreements} production pass/fail sanity disagreement(s)`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [CLI, 'run', MAIN_KERN], {
  encoding: 'utf-8',
  cwd: ROOT,
  env: { ...process.env, NODE_NO_WARNINGS: '1' },
  timeout: 30000,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(2);
}

if (result.signal) {
  console.error(`selfhost validator was killed by signal ${result.signal}`);
  if (result.stderr) console.error(result.stderr);
  process.exit(2);
}

if (result.status !== 0) {
  console.error(`selfhost validator (kern run) exited ${result.status}`);
  if (result.stderr) console.error(result.stderr);
  if (result.stdout) console.error(result.stdout);
  process.exit(1);
}

if (result.stderr) {
  console.error(`selfhost validator emitted unexpected stderr:\n${result.stderr}`);
  process.exit(1);
}

const actual = (result.stdout ?? '').split('\n').filter((line) => line.length > 0);
const expected = expectedLines(FIXTURES);

let failures = 0;
if (actual.length !== expected.length) {
  console.error(`selfhost validator printed ${actual.length} line(s), expected ${expected.length}`);
  failures += 1;
}

const count = Math.max(actual.length, expected.length);
for (let i = 0; i < count; i += 1) {
  if (actual[i] !== expected[i]) {
    console.error(`line ${i + 1}: expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(actual[i])}`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\nselfhost validator: ${failures} byte-compare failure(s)`);
  process.exit(1);
}

console.log(`selfhost validator: ${expected.length}/${expected.length} verdict lines byte-match TS reference`);
