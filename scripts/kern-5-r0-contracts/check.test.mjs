import assert from 'node:assert/strict';
import test from 'node:test';

import { parseChildPeakRssBytes, verifyTimedChildMeasurement } from './check.mjs';

test('R0 child RSS parser normalizes positive macOS bytes and Linux KiB', () => {
  assert.equal(parseChildPeakRssBytes('darwin', '123 maximum resident set size'), 123);
  assert.equal(parseChildPeakRssBytes('linux', 'Maximum resident set size (kbytes): 123'), 123 * 1024);
  assert.equal(parseChildPeakRssBytes('linux', Buffer.from('Maximum resident set size (kbytes): 123', 'utf8')), 123 * 1024);
  assert.throws(() => parseChildPeakRssBytes('darwin', '0 maximum resident set size'), /positive/u);
  assert.throws(() => parseChildPeakRssBytes('linux', 'Maximum resident set size (kbytes): 0'), /positive/u);
  assert.throws(() => parseChildPeakRssBytes('darwin', 'garbage'), /did not report/u);
  assert.throws(() => parseChildPeakRssBytes('linux', ''), /did not report/u);
  assert.throws(() => parseChildPeakRssBytes('win32', ''), /unsupported/u);
});

test('R0 timed-child measurement allows a wrapper failure only after exact child success', () => {
  const expected = Buffer.from('{"ok":true}\n', 'utf8');
  assert.equal(verifyTimedChildMeasurement({
    expected,
    platform: 'darwin',
    result: { signal: null, status: 0, stderr: '123 maximum resident set size', stdout: expected },
    target: 'javascript-esm',
  }), 123);
  assert.equal(verifyTimedChildMeasurement({
    expected,
    platform: 'linux',
    result: { signal: null, status: 1, stderr: 'Maximum resident set size (kbytes): 123', stdout: expected },
    target: 'python',
  }), 123 * 1024);
  assert.throws(() => verifyTimedChildMeasurement({
    expected,
    platform: 'darwin',
    result: { signal: null, status: 1, stderr: '123 maximum resident set size', stdout: Buffer.from('{"ok":false}\n', 'utf8') },
    target: 'javascript-esm',
  }), /canonical envelope/u);
  assert.throws(() => verifyTimedChildMeasurement({
    expected,
    platform: 'darwin',
    result: { error: new Error('time unavailable'), signal: null, status: null, stderr: '', stdout: expected },
    target: 'javascript-esm',
  }), /measurement tool failed/u);
  const timeout = Object.assign(new Error('spawnSync /usr/bin/time ETIMEDOUT'), { code: 'ETIMEDOUT' });
  assert.throws(() => verifyTimedChildMeasurement({
    expected,
    platform: 'darwin',
    result: { error: timeout, signal: 'SIGTERM', status: null, stderr: '', stdout: expected },
    target: 'javascript-esm',
  }), /timed out after 5000ms/u);
});
