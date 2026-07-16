import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { astWitnessMatches } from './semantic-ownership/ast-witness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_PATH = resolve(ROOT, 'scripts/selfhost-smoke-policy.json');
const CHECKER_PATH = resolve(ROOT, 'scripts/check-capstone-checker-subset.mjs');

async function loader() {
  return import('./selfhost-smoke-policy.mjs');
}

function withPolicy(value, run) {
  const directory = mkdtempSync(join(tmpdir(), 'kern-selfhost-smoke-policy-'));
  const path = join(directory, 'policy.json');
  writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
  try {
    return run(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('checked-in self-host smoke policy owns the checker timeout', async () => {
  const { loadSelfhostSmokePolicy } = await loader();
  const policy = loadSelfhostSmokePolicy(POLICY_PATH);
  assert.deepEqual(policy, {
    schemaVersion: 1,
    timeouts: { capstoneCheckerSubsetMs: 60_000 },
  });
});

test('self-host smoke policy rejects malformed or widened contracts', async () => {
  const { loadSelfhostSmokePolicy } = await loader();
  const valid = {
    schemaVersion: 1,
    timeouts: { capstoneCheckerSubsetMs: 60_000 },
  };
  const mutations = [
    { ...valid, schemaVersion: 2 },
    { ...valid, extra: true },
    { ...valid, timeouts: {} },
    { ...valid, timeouts: { ...valid.timeouts, extra: 1 } },
    { ...valid, timeouts: { capstoneCheckerSubsetMs: 0 } },
    { ...valid, timeouts: { capstoneCheckerSubsetMs: 1.5 } },
  ];
  for (const mutation of mutations) {
    assert.throws(() => withPolicy(mutation, loadSelfhostSmokePolicy), /self-host smoke policy/u);
  }
});

test('checker subset routes every child through the policy-bound process owner', () => {
  const source = readFileSync(CHECKER_PATH, 'utf8');
  assert.match(source, /loadSelfhostSmokePolicy/u);
  assert.match(source, /SELFHOST_SMOKE_POLICY\.timeouts\.capstoneCheckerSubsetMs/u);
  assert.ok(
    astWitnessMatches(
      source,
      CHECKER_PATH,
      'call-array:spawnSync:1:CLI,run,target:process.execPath',
    ),
  );
  assert.match(source, /timeout: CAPSTONE_CHECKER_SUBSET_TIMEOUT_MS/u);
  assert.match(source, /const result = runChecker\(MAIN_KERN\)/u);
  assert.match(source, /const run = runChecker\(target\)/u);
  assert.match(source, /const run = runChecker\(NUMERIC_MAIN_KERN\)/u);
  assert.doesNotMatch(source, /timeout:\s*\d/gu);
});
