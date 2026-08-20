import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { loadPolicy, runBatch } from './worker.mjs';

function densitySource(count) {
  return '{{1}}\n'.repeat(count);
}

function measure(count) {
  const source = densitySource(count);
  const started = performance.now();
  const result = runBatch(source);
  const elapsedMs = performance.now() - started;
  assert.equal(result.receipt.status, 'batched');
  assert.equal(result.receipt.segments.length, count);
  assert.equal(result.receipt.absoluteSpans.length, count);
  assert.equal(result.runtimeInvocations, 1);
  return {
    bytes: Buffer.byteLength(JSON.stringify(result.fields), 'utf8'),
    elapsedMs,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
  };
}

test('1x/2x/4x/8x expression density scales inside authenticated adjacent walls', () => {
  const policy = loadPolicy().policy;
  const measurements = policy.scalingWalls.densityCounts.map(measure);
  for (let index = 1; index < measurements.length; index += 1) {
    const previous = measurements[index - 1];
    const current = measurements[index];
    assert.ok(current.bytes <= previous.bytes * policy.scalingWalls.maxAdjacentByteRatio);
    assert.ok(current.elapsedMs <=
      previous.elapsedMs * policy.scalingWalls.maxAdjacentTimeRatio + policy.scalingWalls.timeSlackMs);
  }
});

test('1x/2x/4x/8x body growth remains bounded through the batch seam', () => {
  const policy = loadPolicy().policy;
  const termCounts = [16, 32, 64, 128];
  const measurements = termCounts.map((count) => measureBody(count));
  for (let index = 1; index < measurements.length; index += 1) {
    const previous = measurements[index - 1];
    const current = measurements[index];
    assert.ok(current.bytes <= previous.bytes * policy.scalingWalls.maxAdjacentByteRatio);
    assert.ok(current.elapsedMs <=
      previous.elapsedMs * policy.scalingWalls.maxAdjacentTimeRatio + policy.scalingWalls.timeSlackMs);
  }
});

test('10,000 individually valid expressions complete in one bounded KERN invocation', () => {
  const policy = loadPolicy().policy;
  const measurement = measure(policy.scalingWalls.fullDensitySegments);
  assert.ok(measurement.elapsedMs <= policy.scalingWalls.maxElapsedMs,
    `elapsed ${measurement.elapsedMs} exceeds ${policy.scalingWalls.maxElapsedMs}`);
  assert.ok(measurement.peakRssBytes <= policy.scalingWalls.maxPeakRssBytes,
    `peak RSS ${measurement.peakRssBytes} exceeds ${policy.scalingWalls.maxPeakRssBytes}`);
  assert.ok(measurement.bytes <= policy.profileLimits.maxEncodedBytes,
    `bytes ${measurement.bytes} exceeds ${policy.profileLimits.maxEncodedBytes}`);
});

function measureBody(terms) {
  const source = `value={{${Array.from({ length: terms }, () => '1').join(' + ')}}}\n`;
  const started = performance.now();
  const result = runBatch(source);
  const elapsedMs = performance.now() - started;
  assert.equal(result.receipt.status, 'batched');
  assert.equal(result.receipt.segments.length, 1);
  assert.equal(result.runtimeInvocations, 1);
  return { bytes: Buffer.byteLength(JSON.stringify(result.fields), 'utf8'), elapsedMs };
}
