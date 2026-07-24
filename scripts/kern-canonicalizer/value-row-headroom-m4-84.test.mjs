import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM483 } from './coverage-residual-analysis-m4-83.mjs';
import {
  loadCanonicalizerValueRowHeadroomM484,
  measureCanonicalizerValueRowHeadroomM484,
  validateCanonicalizerValueRowHeadroomM484,
} from './value-row-headroom-m4-84.mjs';

const summaryUrl = new URL('./value-row-headroom-m4-84.json', import.meta.url);
const RECEIPT_DIGEST = '4b92ced7a43f4aa938a9fe303edcd5fb17b423a61d99b9a8c476ccdc653b8065';

test('M4.84 freezes the exact value-row structural runtime headroom receipt', () => {
  const source = readFileSync(summaryUrl);
  const receipt = loadCanonicalizerValueRowHeadroomM484();
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  assert.deepEqual(measureCanonicalizerValueRowHeadroomM484(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.value-row-headroom.1');
  assert.equal(receipt.artifactScope, 'structural-kir-function');
  assert.deepEqual(receipt.limits, {
    candidateProfile: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 580 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.promotion, { disposition: 'approved', nextMilestone: 'M4.85' });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 38_773,
    minimumProductionHeadroom: 26_763,
    minimumPromotionHeadroom: 10_379,
    witnessCount: 1,
  });
  assert.deepEqual(receipt.witnesses, [{
    belowFloorOutcome: 'failure',
    exactFloor: 38_773,
    floorOutcome: 'success',
    id: 'examples/capstone-checker-subset/checker.kern#16:argProvenanced',
    parameterRows: 19,
    productionHeadroom: 26_763,
    profileRows: { nodes: 35, properties: 55, values: 580 },
    promotionHeadroom: 10_379,
    roundTrip: true,
  }]);
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.equal(
    receipt.source.residualAnalysisSha256,
    '42815f7d4bd02daa625718deb8b8ae04590efb605dccc69ffc90b3a4bdcbf546',
  );
  assert.equal(
    receipt.source.publishedInputCommit,
    '6a5dea4687b54600778d62cf21855443567959e6',
  );
  assert.equal(
    receipt.source.publishedCoverageImplementationDigest,
    'e02d1e500c4ddfd668b11854bed8d69c04d0fc79d0adb9484f6d9838ab76c301',
  );
});

test('M4.84 rejects receipt drift, decorated data, cycles, and shared references', () => {
  const actual = loadCanonicalizerValueRowHeadroomM484();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.value-row-headroom.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.candidateProfile.maxValueRows += 1; },
    (copy) => { copy.witnesses[0].exactFloor -= 1; },
    (copy) => { copy.witnesses[0].roundTrip = false; },
    (copy) => { copy.promotion.disposition = 'rejected-over-budget'; },
    (copy) => { copy.summary.minimumPromotionHeadroom -= 1; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerValueRowHeadroomM484(copy),
      /coverage M4\.84 value-row headroom rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), actual);
  assert.throws(
    () => validateCanonicalizerValueRowHeadroomM484(decorated),
    /coverage M4\.84 value-row headroom rejection/u,
  );
  const shared = structuredClone(actual);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerValueRowHeadroomM484(shared),
    /cycles or shared references/u,
  );
  const cyclic = structuredClone(actual);
  cyclic.future = cyclic;
  assert.throws(
    () => validateCanonicalizerValueRowHeadroomM484(cyclic),
    /cycles or shared references/u,
  );
});

test('M4.84 preserves M4.83 and reproduces in a fresh locale-independent process', () => {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM483();
  assert.equal(analysis.digest, '42815f7d4bd02daa625718deb8b8ae04590efb605dccc69ffc90b3a4bdcbf546');
  assert.equal(analysis.inputCommit, '89083ba126201067c918ea7e130382ca171f4097');
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadCanonicalizerValueRowHeadroomM484 as load} from './scripts/kern-canonicalizer/value-row-headroom-m4-84.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadCanonicalizerValueRowHeadroomM484());
});
