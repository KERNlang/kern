import assert from 'node:assert/strict';
import test from 'node:test';

import { makeEnv } from '../../packages/core/dist/index.js';
import { executeInternalRuntimeSourceHandlerSync } from '../../packages/core/dist/runtime-envelope/source-handler.js';
import { materialize } from '../kern-frontend-f1/transport-contract.mjs';
import { decodeExpression, loadPolicy } from './decoder.mjs';
import { loadComposition, runExpression } from './worker.mjs';

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

function minimumWorkSteps(source, upper = 256) {
  let low = 1;
  let high = upper;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (runExpression(source, { profileLimits: { maxWorkSteps: middle } }).decoded.status === 'parsed') high = middle;
    else low = middle + 1;
  }
  return low;
}

function helperDiagnostics(source) {
  const policy = loadPolicy();
  const limits = policy.profileLimits;
  const stats = new Map();
  const envelope = executeInternalRuntimeSourceHandlerSync(
    loadComposition(policy).composition,
    { handlerName: 'parsef2expression', sourcePath: 'examples/kern-frontend/f2-expression-main.kern' },
    [
      source,
      limits.maxSourceScalars,
      limits.maxTokens,
      limits.maxNodes,
      limits.nodesPerChunk,
      limits.maxChunks,
      limits.maxTapeScalars,
      limits.maxNestingDepth,
      limits.maxWorkSteps,
      false,
    ],
    makeEnv(),
    {
      enabled: true,
      limits: policy.runtimeLimits,
      observer(event) {
        if (event.kind !== 'helper-cache' && event.kind !== 'helper-execute' && event.kind !== 'helper-prepare') return;
        const current = stats.get(event.name) ?? { executes: 0, keyCharacters: 0, lookups: 0, prepares: 0 };
        if (event.kind === 'helper-execute') current.executes += 1;
        else if (event.kind === 'helper-prepare') {
          current.keyCharacters += event.cacheKeyLength ?? 0;
          current.prepares += 1;
        } else current.lookups += 1;
        stats.set(event.name, current);
      },
      scheduler: policy.scheduler,
    },
  );
  assert.equal(envelope.outcome, 'success', JSON.stringify(envelope));
  assert.equal(envelope.result.presence, 'value');
  assert.equal(envelope.result.value.tag, 'list');
  const fields = materialize(envelope.result.value);
  return { decoded: decodeExpression(fields, source, policy), stats };
}

test('1x/2x/4x/8x flat and nested families satisfy deterministic scaling walls', () => {
  const walls = loadPolicy().scalingWalls;
  const flatMeasurements = walls.flatTerms.map((terms) => measure(flat(terms)));
  const nestedMeasurements = walls.nestedDepths.map((depth) => measure(nested(depth)));
  assertScalingWall(flatMeasurements, walls);
  assertScalingWall(nestedMeasurements, walls);
  assert.ok(process.resourceUsage().maxRSS <= walls.maxPeakRssKiB, JSON.stringify(process.resourceUsage()));
});

test('hostile deep unary chains, member access, and nested records satisfy scaling limits', () => {
  const unaryChain = `${'!'.repeat(32)}value`;
  const unaryMeasured = measure(unaryChain);
  assert.equal(unaryMeasured.nodes, 33);

  const memberChain = `root${'.child'.repeat(32)}`;
  const memberMeasured = measure(memberChain);
  assert.equal(memberMeasured.nodes, 33);

  const nestedRecords = `{a: {b: {c: {d: {e: 42}}}}}`;
  const recordResult = runExpression(nestedRecords);
  assert.equal(recordResult.decoded.status, 'parsed');
});

test('record identities do not collide when stack depths are reused', () => {
  const result = runExpression('[{a: 1}, {a: 2}]');
  assert.equal(result.decoded.status, 'parsed');
  assert.deepEqual(result.decoded.nodes.filter((node) => node.kindId === 7).map((node) => node.payload), [['a'], ['a']]);
});

test('work budget charges parser reductions with an exact equality boundary', () => {
  const source = `${'!'.repeat(8)}value`;
  const exact = minimumWorkSteps(source);
  assert.ok(exact > 9, `work meter counted only the ${9} lexical tokens`);
  assert.equal(runExpression(source, { profileLimits: { maxWorkSteps: exact } }).decoded.status, 'parsed');
  assert.equal(
    runExpression(source, { profileLimits: { maxWorkSteps: exact - 1 } }).decoded.diagnostic.code,
    'EXPRESSION_LIMIT',
  );
});

test('grouped expressions retain resumable f2readitem cache hits', () => {
  const grouped = helperDiagnostics('(1 + 2) * 3');
  const read = grouped.stats.get('f2readitem');
  assert.equal(grouped.decoded.status, 'parsed');
  assert.ok(read, JSON.stringify(Object.fromEntries(grouped.stats)));
  assert.deepEqual(
    { executes: read.executes, lookups: read.lookups, prepares: read.prepares },
    { executes: 30, lookups: 72, prepares: 42 },
  );
});

test('hostile unary helper cache keys scale linearly', () => {
  const shallowDepth = 512;
  const deepDepth = 1024;
  const deeperDepth = 2048;
  const shallow = helperDiagnostics(`${'!'.repeat(shallowDepth)}value`);
  const deep = helperDiagnostics(`${'!'.repeat(deepDepth)}value`);
  const deeper = helperDiagnostics(`${'!'.repeat(deeperDepth)}value`);

  assert.equal(shallow.decoded.status, 'parsed');
  assert.equal(deep.decoded.status, 'parsed');
  assert.equal(deeper.decoded.status, 'parsed');
  assert.equal(shallow.decoded.nodes.length, shallowDepth + 1);
  assert.equal(deep.decoded.nodes.length, deepDepth + 1);
  assert.equal(deeper.decoded.nodes.length, deeperDepth + 1);
  const shallowRead = shallow.stats.get('f2readitem');
  const deepRead = deep.stats.get('f2readitem');
  const deeperRead = deeper.stats.get('f2readitem');
  assert.ok(shallowRead && deepRead && deeperRead, JSON.stringify(Object.fromEntries(deeper.stats)));
  assert.ok(deepRead.executes <= shallowRead.executes * 2.1 + 32, `${shallowRead.executes} -> ${deepRead.executes}`);
  assert.ok(deeperRead.executes <= deepRead.executes * 2.1 + 32, `${deepRead.executes} -> ${deeperRead.executes}`);
  const superlinearCacheKeys = (smaller, larger) => {
    const violations = [];
    for (const [name, largerStat] of larger.stats) {
      const smallerStat = smaller.stats.get(name) ?? { keyCharacters: 0 };
      if (largerStat.keyCharacters > smallerStat.keyCharacters * 2.5 + 4096) {
        violations.push(`${name}: ${smallerStat.keyCharacters} -> ${largerStat.keyCharacters}`);
      }
    }
    return violations;
  };
  assert.deepEqual(superlinearCacheKeys(shallow, deep), []);
  assert.deepEqual(superlinearCacheKeys(deep, deeper), []);
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
