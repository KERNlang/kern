import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { calculateWorstGeometry } from './transport-contract.mjs';

const WORKER = fileURLToPath(new URL('./transport-worker.mjs', import.meta.url));

function run(shape, size, options = {}) {
  const completed = spawnSync(
    process.execPath,
    [WORKER, shape, String(size), options.forceLateFailure === true ? 'late-failure' : 'scan'],
    { encoding: 'utf8', timeout: options.timeoutMs ?? 180_000 },
  );
  assert.equal(completed.error, undefined, `${shape}:${size} exceeded the subprocess wall`);
  assert.equal(completed.status, 0, `${shape}:${size}\n${completed.stderr}`);
  return JSON.parse(completed.stdout);
}

test('analytical 16k/32k/65k geometry and reserve inputs are exact', () => {
  assert.deepEqual(
    [16_384, 32_768, 65_536].map((records) => calculateWorstGeometry(records, 256)),
    [
      {
        chunks: 64,
        jsonContentBytes: 738_089,
        maxChunkScalars: 10_775,
        maxInnerRetainedBytes: 797_458,
        records: 16_384,
        retainedBytes: 6_347_889,
        tapeScalars: 656_169,
        tapeUtf8Bytes: 705_321,
      },
      {
        chunks: 128,
        jsonContentBytes: 1_509_665,
        maxChunkScalars: 10_777,
        maxInnerRetainedBytes: 1_536_264,
        records: 32_768,
        retainedBytes: 12_997_161,
        tapeScalars: 1_345_825,
        tapeUtf8Bytes: 1_444_129,
      },
      {
        chunks: 256,
        jsonContentBytes: 3_052_961,
        maxChunkScalars: 10_777,
        maxInnerRetainedBytes: 3_014_024,
        records: 65_536,
        retainedBytes: 26_297_001,
        tapeScalars: 2_725_281,
        tapeUtf8Bytes: 2_921_889,
      },
    ],
  );
});

test('empty source succeeds and malformed Unicode fails before guest scanning', () => {
  const empty = run('token', 0);
  assert.deepEqual(
    {
      chunkCount: empty.chunkCount,
      code: empty.code,
      events: empty.events,
      invoked: empty.invoked,
      recordCount: empty.recordCount,
      sourceScalars: empty.sourceScalars,
      status: empty.status,
      tapeScalars: empty.tapeScalars,
    },
    { chunkCount: 0, code: '', events: 0, invoked: true, recordCount: 0, sourceScalars: 0, status: 'scanned', tapeScalars: 0 },
  );
  const malformed = run('ill-formed', 1);
  assert.deepEqual(
    { code: malformed.code, events: malformed.events, invoked: malformed.invoked, status: malformed.status },
    { code: 'ILL_FORMED_SOURCE', events: 0, invoked: false, status: 'failure' },
  );
});

test('bounded tape crosses runtime and direct encoder boundaries at 1x/2x/4x', () => {
  const measurements = [16_384, 32_768, 65_536].map((size) => run('alternating', size));
  for (const measurement of measurements) {
    assert.equal(measurement.status, 'scanned');
    assert.equal(measurement.recordCount, measurement.sourceScalars);
    assert.equal(measurement.chunkCount, Math.ceil(measurement.recordCount / 256));
    assert.ok(measurement.maxGuestListLength <= 256, JSON.stringify(measurement));
    assert.equal(measurement.events, 0);
    assert.equal(measurement.reconstructed, true);
    assert.equal(measurement.encodedOutcome, 'success');
    assert.equal(measurement.directEncoderRoundTrip, true);
    assert.equal(measurement.withinLogicalWalls, true);
  }
  assert.ok(measurements[1].elapsedMs <= measurements[0].elapsedMs * 12 + 1_000, JSON.stringify(measurements));
  assert.ok(measurements[2].elapsedMs <= measurements[1].elapsedMs * 12 + 1_000, JSON.stringify(measurements));
});

test('full-cap transport preserves all seven frozen raw corpus vectors', () => {
  for (const shape of ['token', 'trivia', 'alternating', 'astral', 'escape', 'comment', 'fence']) {
    const measurement = run(shape, 65_536);
    assert.equal(measurement.status, 'scanned', shape);
    assert.equal(measurement.recordCount, 65_536, shape);
    assert.equal(measurement.chunkCount, 256, shape);
    assert.equal(measurement.reconstructed, true, shape);
    assert.equal(measurement.maxGuestListLength, 256, shape);
    assert.equal(measurement.events, 0, shape);
    assert.equal(measurement.directEncoderRoundTrip, true, shape);
  }
});

test('exact worst tape and JSON cases pass the configured real encoder wall', () => {
  const measurement = run('encoder-wall', 65_536);
  assert.deepEqual(
    {
      astralEncodedBytes: measurement.astralEncodedBytes,
      astralTapeUtf8Bytes: measurement.astralTapeUtf8Bytes,
      controlEncodedBytes: measurement.controlEncodedBytes,
      controlJsonContentBytes: measurement.controlJsonContentBytes,
      status: measurement.status,
    },
    {
      astralEncodedBytes: 2_922_386,
      astralTapeUtf8Bytes: 2_921_889,
      controlEncodedBytes: 3_053_458,
      controlJsonContentBytes: 3_052_961,
      status: 'encoder-wall-passed',
    },
  );
});

test('cap-plus-one and forced late failure return no record transport', () => {
  const over = run('token', 65_537);
  assert.deepEqual(
    { chunkCount: over.chunkCount, code: over.code, events: over.events, recordCount: over.recordCount, status: over.status },
    { chunkCount: 0, code: 'SOURCE_LIMIT', events: 0, recordCount: 0, status: 'failure' },
  );
  const late = run('alternating', 65_536, { forceLateFailure: true });
  assert.deepEqual(
    { chunkCount: late.chunkCount, code: late.code, events: late.events, recordCount: late.recordCount, status: late.status },
    { chunkCount: 0, code: 'FORCED_LATE_FAILURE', events: 0, recordCount: 0, status: 'failure' },
  );
});

test('strict decoder rejects the complete transport mutation matrix', () => {
  const measurement = run('mutation-suite', 512);
  assert.equal(measurement.status, 'mutations-rejected');
  assert.deepEqual(measurement.rejected, [
    'chunk-length',
    'chunk-seal',
    'constant-output',
    'drop-record',
    'duplicate-record',
    'encoded-limit-substitution',
    'eof-record',
    'field-permutation',
    'frame-marker',
    'injected-raw',
    'noncanonical-digit',
    'record-length',
    'reorder-chunk',
    'reorder-record',
    'seal-count',
    'source-substitution',
    'span-shift',
    'truncated-raw',
    'zero-width',
  ]);
});
