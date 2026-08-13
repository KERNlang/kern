import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('./performance-worker.mjs', import.meta.url));

function timed(kind, size) {
  const completed = spawnSync(process.execPath, [WORKER, kind, String(size)], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.equal(completed.error, undefined, `${kind}:${size} exceeded the 5s wall`);
  assert.equal(completed.status, 0, `${kind}:${size}\n${completed.stderr}`);
  return JSON.parse(completed.stdout).milliseconds;
}

test('many-record and wide-record 1x/2x/4x probes stay inside hard walls', () => {
  for (const [kind, sizes] of [
    ['many', [256, 512, 1024]],
    ['wide', [256, 512, 1024]],
  ]) {
    const times = sizes.map((size) => timed(kind, size));
    assert.ok(times.every((value) => value < 4_500), `${kind}: ${times.join(',')}`);
    assert.ok(times[2] <= times[0] * 12 + 250, `${kind} scaling: ${times.join(',')}`);
  }
  assert.ok(timed('wide', 2048) < 4_500, 'exact maxRecordCodePoints must fit the wall');
});
