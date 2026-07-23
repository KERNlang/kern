import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM462 } from './coverage-residual-analysis-m4-62.mjs';
import {
  loadCanonicalizerNodeRowHeadroomM463,
  measureCanonicalizerNodeRowHeadroomM463,
  validateCanonicalizerNodeRowHeadroomM463,
} from './node-row-headroom-m4-63.mjs';

const summaryUrl = new URL('./node-row-headroom-m4-63.json', import.meta.url);
const RECEIPT_DIGEST = '110260eb3a2c9ed942e309d5b6e1331f2752bc486bfe99840c887e2a6ef7e7c3';
const WITNESS_BOUNDARIES = [
  ['examples/capstone-checker-subset/checker-while.kern#1:isSafeMagnitude', 2, 21_736, 27, 39, 288],
  ['examples/capstone-checker-subset/checker.kern#22:mapCallRejectDetail', 13, 27_076, 28, 42, 309],
  ['examples/selfhost-validator/validator.kern#10:fnokat', 8, 21_825, 28, 38, 270],
  ['examples/selfhost-validator/validator.kern#12:ownexportkind', 14, 24_993, 28, 48, 260],
];

test('M4.63 authenticates the exact node-row structural headroom receipt', () => {
  const source = readFileSync(summaryUrl);
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  const receipt = loadCanonicalizerNodeRowHeadroomM463();
  assert.deepEqual(receipt, measureCanonicalizerNodeRowHeadroomM463());
  assert.equal(receipt.format, 'kern.kir-canonicalizer.node-row-headroom.2');
  assert.equal(receipt.artifactScope, 'structural-kir-function');
  assert.deepEqual(receipt.limits, {
    candidateProfile: { maxNodeRows: 28, maxPropertyRows: 50, maxValueRows: 388 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 27_076,
    minimumProductionHeadroom: 38_460,
    minimumPromotionHeadroom: 22_076,
    witnessCount: 4,
  });
  assert.deepEqual(
    receipt.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => [
      id, parameterRows, exactFloor,
      profileRows.nodes, profileRows.properties, profileRows.values,
    ]),
    WITNESS_BOUNDARIES,
  );
  assert.equal(receipt.witnesses.reduce((total, row) => total + row.parameterRows, 0), 37);
  assert.ok(receipt.witnesses.every(({ exactFloor }) =>
    Number.isSafeInteger(exactFloor) && exactFloor > 0 && exactFloor <= 49_152));
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.equal(receipt.source.residualAnalysisSha256,
    '5339ffa5c128efbe857b53e64a67092d72b8b6b6cbe6cc3ea16c96f4939e79cc');
  assert.equal(receipt.source.residualAnalysisInputCommit,
    'f36a870843ccdd222e8cf2e7595c0e205ed545bf');
});

test('M4.63 rejects receipt drift and decorated data', () => {
  const actual = loadCanonicalizerNodeRowHeadroomM463();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.node-row-headroom.3'; },
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
      () => validateCanonicalizerNodeRowHeadroomM463(copy),
      /coverage M4\.63 node-row headroom rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), actual);
  assert.throws(
    () => validateCanonicalizerNodeRowHeadroomM463(decorated),
    /coverage M4\.63 node-row headroom rejection/u,
  );
});

test('M4.63 preserves M4.62 and reproduces in a fresh locale-independent process', () => {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM462();
  assert.equal(analysis.digest,
    '5339ffa5c128efbe857b53e64a67092d72b8b6b6cbe6cc3ea16c96f4939e79cc');
  assert.equal(analysis.inputCommit, 'f36a870843ccdd222e8cf2e7595c0e205ed545bf');
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadCanonicalizerNodeRowHeadroomM463 as load} from './scripts/kern-canonicalizer/node-row-headroom-m4-63.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadCanonicalizerNodeRowHeadroomM463());
});
