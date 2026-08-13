import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadKernCheckerAssets } from '../../packages/cli/dist/kern-checker-assets.js';
import { flattenKernSource } from '../capstone-checker-subset/flatten-kern.mjs';
import { FIXTURES } from '../capstone-checker-subset/fixtures.mjs';
import { checkerFactsFromFlatModule } from './contract.mjs';

const RUNNER = fileURLToPath(new URL('../../packages/cli/dist/kern-checker-cli.js', import.meta.url));

function run(input) {
  return spawnSync(process.execPath, [RUNNER], {
    encoding: null,
    input,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function result(runResult) {
  assert.equal(runResult.signal, null);
  assert.equal(runResult.stderr.toString('utf8'), '');
  return JSON.parse(runResult.stdout.toString('utf8'));
}

function fixtureFacts(expected) {
  const fixture = FIXTURES.find((item) => item.expected === expected);
  return checkerFactsFromFlatModule(flattenKernSource(fixture.path, fixture.source()));
}

test('private runner owns subprocess exits 0 accept, 1 reject, and 2 failure', () => {
  const accepted = run(JSON.stringify(fixtureFacts('accept')));
  assert.equal(accepted.status, 0);
  assert.equal(result(accepted).outcome, 'accept');

  const rejected = run(JSON.stringify(fixtureFacts('reject')));
  assert.equal(rejected.status, 1);
  assert.equal(result(rejected).outcome, 'reject');

  const legacy = fixtureFacts('accept');
  legacy.format = 'kern.checker.facts.1';
  const failed = run(JSON.stringify(legacy));
  assert.equal(failed.status, 2);
  assert.equal(result(failed).outcome, 'failure');
});

test('raw oversized and malformed UTF-8 transports fail before JSON decoding', () => {
  const limit = loadKernCheckerAssets().policy.profileLimits.maxInputBytes;
  const oversized = run(Buffer.alloc(limit + 1, 0x20));
  assert.equal(oversized.status, 2);
  assert.match(result(oversized).diagnostics[0].message, /stdin exceeds maxInputBytes/);

  const malformed = run(Buffer.from([0xff]));
  assert.equal(malformed.status, 2);
  assert.equal(result(malformed).outcome, 'failure');
});

test('Unicode line separators stay inside one escaped NDJSON record', () => {
  for (const [expected, status] of [['accept', 0], ['reject', 1]]) {
    const facts = fixtureFacts(expected);
    facts.path = `${expected}\u2028line\u2029paragraph.kern`;
    const completed = run(JSON.stringify(facts));
    assert.equal(completed.status, status);
    const stdout = completed.stdout.toString('utf8');
    assert.equal(stdout.includes('\u2028'), false);
    assert.equal(stdout.includes('\u2029'), false);
    assert.equal(stdout.split('\n').length, 2);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.path, facts.path);
  }
});
