import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM454 } from './coverage-residual-analysis-m4-54.mjs';
import {
  loadCanonicalizerDualRowHeadroomM455,
  measureCanonicalizerDualRowHeadroomM455,
  validateCanonicalizerDualRowHeadroomM455,
} from './dual-row-headroom-m4-55.mjs';

const summaryUrl = new URL('./dual-row-headroom-m4-55.json', import.meta.url);
const RECEIPT_DIGEST = '10e36abdda5e7de48c65689f9d2a318a6095497bdd3cff81aa64e3ab4e6e535b';
const WITNESS_BOUNDARIES = [
  ['examples/capstone-assertion-engine/compare.kern#4:compareNode', 13, 26_356, 24, 39, 373],
  ['examples/capstone-checker-subset/checker-while.kern#14:literalTrue', 7, 15_094, 23, 33, 244],
  ['examples/capstone-checker-subset/checker-while.kern#17:checkerWhileRejectDetail', 22, 19_763, 25, 49, 189],
  ['examples/capstone-checker-subset/checker.kern#14:termProvenanced', 11, 17_423, 24, 36, 237],
  ['examples/capstone-checker-subset/checker.kern#6:whileRejectDetail', 22, 19_622, 25, 48, 188],
  ['examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#3:emitstatementlist', 15, 21_985, 25, 50, 235],
  ['examples/selfhost-validator/validator.kern#11:owncallable', 12, 17_931, 24, 42, 212],
];

test('M4.55 authenticates the exact dual-row structural headroom receipt', () => {
  const source = readFileSync(summaryUrl);
  const receipt = loadCanonicalizerDualRowHeadroomM455();
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  assert.deepEqual(receipt, measureCanonicalizerDualRowHeadroomM455());
  assert.equal(receipt.format, 'kern.kir-canonicalizer.dual-row-headroom.1');
  assert.equal(receipt.artifactScope, 'structural-kir-function');
  assert.deepEqual(receipt.limits, {
    candidateProfile: { maxNodeRows: 25, maxPropertyRows: 50, maxValueRows: 388 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 26_356,
    minimumProductionHeadroom: 39_180,
    minimumPromotionHeadroom: 22_796,
    witnessCount: 7,
  });
  assert.deepEqual(
    receipt.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => [
      id,
      parameterRows,
      exactFloor,
      profileRows.nodes,
      profileRows.properties,
      profileRows.values,
    ]),
    WITNESS_BOUNDARIES,
  );
  assert.ok(receipt.witnesses.every(({ belowFloorOutcome }) => belowFloorOutcome === 'failure'));
  assert.ok(receipt.witnesses.every(({ floorOutcome }) => floorOutcome === 'success'));
  assert.ok(receipt.witnesses.every(({ roundTrip }) => roundTrip));
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.equal(receipt.source.residualAnalysisSha256, '9c8507a4fe5bacf1048bfc1f6946c3e493ee35cd7fb63ce3a2a7ced474ad1423');
  assert.equal(receipt.source.residualAnalysisInputCommit, '87431a527dfb8d0f3a707b74ce33907392670a51');
});

test('M4.55 receipt rejects evidence drift and decorated data', () => {
  const actual = loadCanonicalizerDualRowHeadroomM455();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.dual-row-headroom.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.candidateProfile.maxNodeRows += 1; },
    (copy) => { copy.witnesses.reverse(); },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.witnesses[0].roundTrip = false; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerDualRowHeadroomM455(copy),
      /coverage M4\.55 dual-row headroom rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), actual);
  assert.throws(
    () => validateCanonicalizerDualRowHeadroomM455(decorated),
    /coverage M4\.55 dual-row headroom rejection/u,
  );
});

test('M4.55 preserves M4.54 and reproduces in a fresh locale-independent process', () => {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM454();
  assert.equal(analysis.digest, '9c8507a4fe5bacf1048bfc1f6946c3e493ee35cd7fb63ce3a2a7ced474ad1423');
  assert.equal(analysis.inputCommit, '87431a527dfb8d0f3a707b74ce33907392670a51');
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadCanonicalizerDualRowHeadroomM455 as load} from './scripts/kern-canonicalizer/dual-row-headroom-m4-55.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadCanonicalizerDualRowHeadroomM455());
});
