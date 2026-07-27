import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM4101 } from './coverage-residual-analysis-m4-101.mjs';
import {
  buildCanonicalizerTripleRowHeadroomM4102,
  loadCanonicalizerTripleRowHeadroomM4102,
  measureCanonicalizerTripleRowHeadroomM4102,
  validateCanonicalizerTripleRowHeadroomM4102,
} from './triple-row-headroom-m4-102.mjs';

const receiptUrl = new URL('./triple-row-headroom-m4-102.json', import.meta.url);
const RECEIPT_DIGEST = '8bed0a4709de4ba79dfffba68e4f9304bdf599e04d771520637bb935865b5e58';

test('M4.102 authenticates the exact validstatement structural runtime floor', () => {
  assert.equal(createHash('sha256').update(readFileSync(receiptUrl)).digest('hex'), RECEIPT_DIGEST);
  const receipt = loadCanonicalizerTripleRowHeadroomM4102();
  assert.deepEqual(validateCanonicalizerTripleRowHeadroomM4102(receipt), receipt);
  assert.deepEqual(buildCanonicalizerTripleRowHeadroomM4102(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.triple-row-headroom.1');
  assert.deepEqual(receipt.limits.activeProfile, {
    maxNodeRows: 74,
    maxPropertyRows: 95,
    maxValueRows: 832,
  });
  assert.deepEqual(receipt.limits.candidateProfile, {
    maxNodeRows: 89,
    maxPropertyRows: 125,
    maxValueRows: 2100,
  });
  assert.deepEqual(receipt.limits, {
    activeProfile: { maxNodeRows: 74, maxPropertyRows: 95, maxValueRows: 832 },
    candidateProfile: { maxNodeRows: 89, maxPropertyRows: 125, maxValueRows: 2100 },
    diagnosticMaxCollectionLength: 72_195,
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.promotion, {
    disposition: 'rejected-over-production-ceiling',
    nextMilestone: 'M4.103',
    productionCeilingDeficit: 6_659,
    promotionBudgetDeficit: 23_043,
    profilePromotionApproved: false,
    requiredFloorReduction: 23_043,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 72_195,
    productionCeilingDeficit: 6_659,
    promotionBudgetDeficit: 23_043,
    totalParameterRows: 14,
    witnessCount: 1,
  });
  assert.equal(receipt.witnesses.length, 1);
  assert.equal(
    receipt.witnesses[0].id,
    'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement',
  );
  assert.deepEqual(receipt.witnesses[0].profileRows, {
    nodes: 89,
    properties: 125,
    values: 2100,
  });
  assert.equal(receipt.witnesses[0].belowFloor, 72_194);
  assert.equal(receipt.witnesses[0].belowFloorOutcome, 'failure');
  assert.equal(receipt.witnesses[0].exactFloor, 72_195);
  assert.equal(receipt.witnesses[0].floorOutcome, 'success');
  assert.equal(receipt.witnesses[0].publicParityVerified, true);
  assert.equal(receipt.witnesses[0].roundTrip, true);
  assert.deepEqual(receipt.measurement, {
    disposition: 'diagnostic-only',
    runtimePolicyChanged: false,
  });
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
});

test('M4.102 live measurement rejects non-positive budgets', () => {
  assert.throws(
    () => measureCanonicalizerTripleRowHeadroomM4102(0),
    /positive safe integer/u,
  );
});

test('M4.102 exact floor fails below and succeeds with public parity', () => {
  const receipt = loadCanonicalizerTripleRowHeadroomM4102();
  const witness = receipt.witnesses[0];
  const promotionBudget = measureCanonicalizerTripleRowHeadroomM4102(
    receipt.limits.promotionBudget,
  );
  assert.equal(promotionBudget.envelope.outcome, 'failure');
  assert.equal(promotionBudget.roundTrip, false);
  const productionCeiling = measureCanonicalizerTripleRowHeadroomM4102(
    receipt.limits.productionMaxCollectionLength,
  );
  assert.equal(productionCeiling.envelope.outcome, 'failure');
  assert.equal(productionCeiling.roundTrip, false);
  const below = measureCanonicalizerTripleRowHeadroomM4102(witness.belowFloor);
  assert.equal(below.envelope.outcome, 'failure');
  assert.equal(below.roundTrip, false);
  const floor = measureCanonicalizerTripleRowHeadroomM4102(
    witness.exactFloor,
    { verifyPublicParity: true },
  );
  assert.equal(floor.envelope.outcome, 'success');
  assert.equal(floor.roundTrip, true);
  assert.equal(floor.publicParityVerified, true);
});

test('M4.102 measurement owner is side-effect free when imported with numeric argv', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await import('./scripts/kern-canonicalizer/triple-row-headroom-m4-102-measure.mjs'); process.stdout.write('quiet')",
      'scripts/check-kern-canonicalizer-coverage.mjs',
      '72195',
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(output, 'quiet');
});

test('M4.102 rejects receipt drift, decoration, and shared references', () => {
  const actual = loadCanonicalizerTripleRowHeadroomM4102();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.triple-row-headroom.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.candidateProfile.maxValueRows += 1; },
    (copy) => { copy.witnesses[0].exactFloor -= 1; },
    (copy) => { copy.promotion.profilePromotionApproved = true; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerTripleRowHeadroomM4102(copy),
      /coverage M4\.102 triple-row headroom rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), actual);
  assert.throws(
    () => validateCanonicalizerTripleRowHeadroomM4102(decorated),
    /coverage M4\.102 triple-row headroom rejection/u,
  );
  const shared = structuredClone(actual);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerTripleRowHeadroomM4102(shared),
    /cycles or shared references/u,
  );
});

test('M4.102 preserves M4.101 and loads canonically in a fresh process', () => {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM4101();
  assert.equal(
    analysis.digest,
    '9b389d0b2536cf2cd11d49bc47f1f234c46924c14c2ef160faf633069a3c94f0',
  );
  assert.equal(analysis.inputCommit, 'f95952200aec3a13ff71d42f63b7a7ed47010e48');
  const receipt = loadCanonicalizerTripleRowHeadroomM4102();
  assert.equal(readFileSync(receiptUrl, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
  const fresh = JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {loadCanonicalizerTripleRowHeadroomM4102 as load} from './scripts/kern-canonicalizer/triple-row-headroom-m4-102.mjs'; process.stdout.write(JSON.stringify(load()))",
    ],
    {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    },
  ));
  assert.deepEqual(fresh, receipt);
});
