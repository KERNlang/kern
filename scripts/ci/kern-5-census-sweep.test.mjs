import assert from 'node:assert/strict';
import test from 'node:test';

import { fullSweepOptions, validateReport } from './kern-5-census-sweep.mjs';

const ratchet = { admitted: [{ file: 'admitted.kern' }] };
const files = ['admitted.kern', 'rejected.kern'];
const result = (file, admitted = false, code = 'no-exported-entry', stage = admitted ? 'runtime' : 'entry-selection') => ({
  file,
  admitted,
  code,
  stage,
});

function report(overrides = {}) {
  return { completed: 2, total: 2, admittedCount: 1, results: [result('admitted.kern', true, 'ok'), result('rejected.kern')], ...overrides };
}

test('accepts a complete report that preserves the ratchet and count', () => {
  assert.equal(validateReport(report(), ratchet, files).admittedCount, 1);
});

test('passes explicit concurrency and timeout policy to the full sweep', () => {
  assert.deepEqual(fullSweepOptions(files, '/tmp/admission.json', { jobs: 8, timeoutMs: 300_000 }), {
    files,
    jobs: 8,
    out: '/tmp/admission.json',
    timeoutMs: 300_000,
    update: false,
  });
  assert.throws(() => fullSweepOptions(files, '/tmp/admission.json', { jobs: 0, timeoutMs: 300_000 }), /jobs/u);
  assert.throws(() => fullSweepOptions(files, '/tmp/admission.json', { jobs: 8, timeoutMs: undefined }), /timeout/u);
});

test('fails closed on incomplete reports', () => {
  assert.throws(() => validateReport(report({ completed: 1 }), ratchet, files), /incomplete/u);
  assert.throws(() => validateReport(report({ results: [result('admitted.kern', true, 'ok')] }), ratchet, files), /incomplete/u);
});

test('fails closed on probe and timeout infrastructure failures', () => {
  for (const [code, stage] of [
    ['probe-timeout', 'timeout'],
    ['probe-overflow', 'probe'],
    ['probe-exit', 'probe'],
    ['probe-unparsable', 'probe'],
    ['probe-crashed', 'probe'],
  ]) {
    assert.throws(
      () =>
        validateReport(
          report({ results: [result('admitted.kern', true, 'ok'), result('rejected.kern', false, code, stage)] }),
          ratchet,
          files,
        ),
      /infrastructure failure/u,
    );
  }
});

test('fails closed when a ratcheted path is missing or no longer admitted', () => {
  assert.throws(
    () => validateReport(report({ results: [result('admitted.kern'), result('rejected.kern', true, 'ok')] }), ratchet, files),
    /ratchet regression/u,
  );
});

test('fails closed when admitted count regresses', () => {
  assert.throws(
    () => validateReport(report({ admittedCount: 0, results: [result('admitted.kern'), result('rejected.kern')] }), ratchet, files),
    /count regressed/u,
  );
});

test('fails closed when the reported count disagrees with the result rows', () => {
  assert.throws(
    () =>
      validateReport(
        report({ results: [result('admitted.kern', true, 'ok'), result('rejected.kern', true, 'ok')] }),
        ratchet,
        files,
      ),
    /count mismatch/u,
  );
});
