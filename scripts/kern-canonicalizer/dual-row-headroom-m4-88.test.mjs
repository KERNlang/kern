import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM487 } from './coverage-residual-analysis-m4-87.mjs';
import {
  loadCanonicalizerDualRowHeadroomM488,
  measureCanonicalizerDualRowHeadroomM488,
  validateCanonicalizerDualRowHeadroomM488,
} from './dual-row-headroom-m4-88.mjs';

const summaryUrl = new URL('./dual-row-headroom-m4-88.json', import.meta.url);
const RECEIPT_DIGEST = '285b42785be8f651d323444ddd3464381b337b74557bbd07e8c3f4bad02a89bb';

test('M4.88 freezes the exact three-witness production-ceiling NO-GO receipt', () => {
  const source = readFileSync(summaryUrl);
  const receipt = loadCanonicalizerDualRowHeadroomM488();
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  assert.deepEqual(measureCanonicalizerDualRowHeadroomM488(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.dual-row-headroom.4');
  assert.equal(receipt.artifactScope, 'structural-kir-function');
  assert.deepEqual(receipt.limits, {
    activeProfile: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 580 },
    candidateProfile: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 },
    diagnosticMaxCollectionLength: 107_594,
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.measurement, {
    disposition: 'diagnostic-only',
    runtimePolicyChanged: false,
  });
  assert.deepEqual(receipt.promotion, {
    disposition: 'rejected-over-production-ceiling',
    nextMilestone: 'M4.89',
    productionCeilingDeficit: 42_058,
    promotionBudgetDeficit: 58_442,
    requiredFloorReduction: 58_442,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 107_594,
    productionCeilingDeficit: 42_058,
    promotionBudgetDeficit: 58_442,
    totalParameterRows: 40,
    witnessCount: 3,
  });
  assert.deepEqual(receipt.witnesses.map(({
    exactFloor, id, parameterRows, productionDelta, productionOutcome, profileRows, promotionDelta,
  }) => ({
    exactFloor, id, parameterRows, productionDelta, productionOutcome, profileRows, promotionDelta,
  })), [
    {
      exactFloor: 36_229,
      id: 'examples/capstone-checker-subset/checker.kern#18:indexRejectDetail',
      parameterRows: 24,
      productionDelta: 29_307,
      productionOutcome: 'success',
      profileRows: { nodes: 41, properties: 67, values: 404 },
      promotionDelta: 12_923,
    },
    {
      exactFloor: 51_321,
      id: 'examples/capstone-checker-subset/checker.kern#23:callRejectCode',
      parameterRows: 15,
      productionDelta: 14_215,
      productionOutcome: 'success',
      profileRows: { nodes: 47, properties: 64, values: 478 },
      promotionDelta: -2_169,
    },
    {
      exactFloor: 107_594,
      id: 'examples/selfhost-validator/validator.kern#2:isreserved',
      parameterRows: 1,
      productionDelta: -42_058,
      productionOutcome: 'failure',
      profileRows: { nodes: 74, properties: 77, values: 572 },
      promotionDelta: -58_442,
    },
  ]);
  assert.ok(receipt.witnesses.every(({ belowFloorOutcome }) => belowFloorOutcome === 'failure'));
  assert.ok(receipt.witnesses.every(({ floorOutcome, roundTrip }) =>
    floorOutcome === 'success' && roundTrip));
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
});

test('M4.88 rejects receipt drift, decorated data, cycles, and shared references', () => {
  const actual = loadCanonicalizerDualRowHeadroomM488();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.dual-row-headroom.5'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.activeProfile.maxNodeRows += 1; },
    (copy) => { copy.limits.diagnosticMaxCollectionLength -= 1; },
    (copy) => { copy.witnesses[2].exactFloor -= 1; },
    (copy) => { copy.witnesses[2].productionOutcome = 'success'; },
    (copy) => { copy.promotion.disposition = 'approved'; },
    (copy) => { copy.promotion.requiredFloorReduction -= 1; },
    (copy) => { copy.measurement.runtimePolicyChanged = true; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerDualRowHeadroomM488(copy),
      /coverage M4\.88 dual-row headroom rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), actual);
  assert.throws(
    () => validateCanonicalizerDualRowHeadroomM488(decorated),
    /coverage M4\.88 dual-row headroom rejection/u,
  );
  const shared = structuredClone(actual);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerDualRowHeadroomM488(shared),
    /cycles or shared references/u,
  );
  const cyclic = structuredClone(actual);
  cyclic.future = cyclic;
  assert.throws(
    () => validateCanonicalizerDualRowHeadroomM488(cyclic),
    /cycles or shared references/u,
  );
});

test('M4.88 preserves M4.87 and reproduces in a fresh locale-independent process', () => {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM487();
  assert.equal(analysis.digest, '9046716d876c336140b567a8a40a9b52750106b2ac5db66f38f7621e935c203a');
  assert.equal(analysis.inputCommit, '46337a6549390087ef095c18d0e178cf9ef28392');
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadCanonicalizerDualRowHeadroomM488 as load} from './scripts/kern-canonicalizer/dual-row-headroom-m4-88.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadCanonicalizerDualRowHeadroomM488());
});
