import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPolicy } from './decoder.mjs';
import { runExpression } from './worker.mjs';

function flat(terms) {
  return Array.from({ length: terms }, (_, index) => `v${index}`).join('+');
}

function nested(depth) {
  return `${'['.repeat(depth)}value${']'.repeat(depth)}`;
}

function measure(source) {
  const result = runExpression(source);
  assert.equal(result.decoded.status, 'parsed');
  return {
    chunks: Number(result.fields[5]),
    guestList: Number(result.fields[6]),
    nodes: result.decoded.nodes.length,
    sourceScalars: result.decoded.sourceScalars,
    tapeScalars: Array.from(result.fields[7]).length,
  };
}

function assertScalingWall(measurements, walls) {
  for (const current of measurements) {
    assert.ok(current.tapeScalars <= current.nodes * walls.maxTapeScalarsPerNode, JSON.stringify(current));
    assert.ok(current.guestList <= walls.maxGuestList, JSON.stringify(current));
  }
  for (let index = 1; index < measurements.length; index += 1) {
    assert.ok(
      measurements[index].tapeScalars <= measurements[index - 1].tapeScalars * walls.maxAdjacentTapeRatio,
      JSON.stringify(measurements),
    );
  }
}

test('1x/2x/4x/8x flat and nested families satisfy deterministic scaling walls', () => {
  const walls = loadPolicy().scalingWalls;
  const flatMeasurements = walls.flatTerms.map((terms) => measure(flat(terms)));
  const nestedMeasurements = walls.nestedDepths.map((depth) => measure(nested(depth)));
  assertScalingWall(flatMeasurements, walls);
  assertScalingWall(nestedMeasurements, walls);
  assert.ok(process.resourceUsage().maxRSS <= walls.maxPeakRssKiB, JSON.stringify(process.resourceUsage()));
});

test('measured expression geometry derives exact-cap and cap-minus-one failures', () => {
  const policy = loadPolicy();
  const source = flat(policy.scalingWalls.flatTerms.at(-1));
  const measured = runExpression(source);
  const tokens = policy.scalingWalls.flatTerms.at(-1) * 2 - 1;
  const nodes = measured.decoded.nodes.length;
  const tapeScalars = Array.from(measured.fields[7]).length;
  for (const [key, exact, failureCode] of [
    ['maxTokens', tokens, 'EXPRESSION_LIMIT'],
    ['maxNodes', nodes, 'EXPRESSION_LIMIT'],
    ['maxWorkSteps', tokens, 'EXPRESSION_LIMIT'],
    ['maxTapeScalars', tapeScalars, 'TRANSPORT_LIMIT'],
  ]) {
    assert.equal(runExpression(source, { profileLimits: { [key]: exact } }).decoded.status, 'parsed', key);
    assert.equal(
      runExpression(source, { profileLimits: { [key]: exact - 1 } }).decoded.diagnostic.code,
      failureCode,
      key,
    );
  }
  const nodesPerChunk = 32;
  const chunked = runExpression(source, { profileLimits: { nodesPerChunk } });
  const chunks = Number(chunked.fields[5]);
  assert.equal(
    runExpression(source, { profileLimits: { maxChunks: chunks, nodesPerChunk } }).decoded.status,
    'parsed',
  );
  assert.equal(
    runExpression(source, { profileLimits: { maxChunks: chunks - 1, nodesPerChunk } }).decoded.diagnostic.code,
    'TRANSPORT_LIMIT',
  );
  const depth = policy.scalingWalls.nestedDepths.at(-1);
  assert.equal(runExpression(nested(depth), { profileLimits: { maxNestingDepth: depth } }).decoded.status, 'parsed');
  assert.equal(
    runExpression(nested(depth), { profileLimits: { maxNestingDepth: depth - 1 } }).decoded.diagnostic.code,
    'EXPRESSION_LIMIT',
  );
});
