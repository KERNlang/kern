import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM4114 } from './coverage-residual-analysis-m4-114.mjs';
import {
  buildCanonicalizerTripleRowHeadroomM4115,
  loadCanonicalizerTripleRowHeadroomM4115,
  validateCanonicalizerTripleRowHeadroomM4115,
} from './triple-row-headroom-m4-115.mjs';
import {
  measureCanonicalizerTripleRowHeadroomM4115,
} from './triple-row-headroom-m4-115-measure.mjs';

const receiptUrl = new URL('./triple-row-headroom-m4-115.json', import.meta.url);
const RECEIPT_DIGEST = '0142e5d39fc94ec76e2cf793a62a922fa9087a12fb4cd83b9499cfc58f922b9d';

test('M4.115 authenticates the exact checkModule structural runtime floor NO-GO', () => {
  const source = readFileSync(receiptUrl);
  const receipt = loadCanonicalizerTripleRowHeadroomM4115();
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  assert.deepEqual(validateCanonicalizerTripleRowHeadroomM4115(receipt), receipt);
  assert.deepEqual(buildCanonicalizerTripleRowHeadroomM4115(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.triple-row-headroom.1');
  assert.deepEqual(receipt.limits, {
    activeProfile: { maxNodeRows: 89, maxPropertyRows: 125, maxValueRows: 2100 },
    candidateProfile: { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2411 },
    diagnosticMaxCollectionLength: 176_119,
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.promotion, {
    disposition: 'rejected-over-production-ceiling',
    nextMilestone: 'M4.116',
    productionCeilingDeficit: 110_583,
    promotionBudgetDeficit: 126_967,
    profilePromotionApproved: false,
    requiredFloorReduction: 126_967,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 176_119,
    productionCeilingDeficit: 110_583,
    promotionBudgetDeficit: 126_967,
    totalArtifactBytes: 149_053,
    totalParameterRows: 58,
    witnessCount: 1,
  });
  assert.deepEqual(receipt.witnesses, [{
    artifactBytes: 149_053,
    belowFloor: 176_118,
    belowFloorOutcome: 'failure',
    exactFloor: 176_119,
    floorOutcome: 'success',
    id: 'examples/capstone-checker-subset/checker.kern#24:checkModule',
    parameterRows: 58,
    productionDelta: -110_583,
    productionOutcome: 'failure',
    profileRows: { nodes: 122, properties: 193, values: 2411 },
    promotionDelta: -126_967,
    publicParityVerified: true,
    roundTrip: true,
  }]);
  assert.deepEqual(receipt.measurement, {
    disposition: 'diagnostic-only',
    runtimePolicyChanged: false,
  });
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 76 });
});

test('M4.115 exact floor remains immutable archival evidence after M4.117', () => {
  const receipt = loadCanonicalizerTripleRowHeadroomM4115();
  assert.equal(receipt.witnesses[0].belowFloorOutcome, 'failure');
  assert.equal(receipt.witnesses[0].floorOutcome, 'success');
  const successor = measureCanonicalizerTripleRowHeadroomM4115(176_118, {
    verifyPublicParity: true,
  });
  assert.equal(successor.envelope.outcome, 'success');
  assert.equal(successor.roundTrip, true);
  assert.equal(successor.publicParityVerified, true);
  assert.equal(successor.artifactBytes, 149_053);
});

test('M4.115 live measurement rejects invalid budgets', () => {
  assert.throws(
    () => measureCanonicalizerTripleRowHeadroomM4115(0),
    /M4\.115 iteration budget must be a positive safe integer/u,
  );
});

test('M4.115 measurement owner is side-effect free when imported with numeric argv', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await import('./scripts/kern-canonicalizer/triple-row-headroom-m4-115-measure.mjs'); process.stdout.write('quiet')",
      'scripts/check-kern-canonicalizer-coverage.mjs',
      '176119',
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(output, 'quiet');
});

test('M4.115 rejects receipt drift, decoration, sharing, and cycles', () => {
  const actual = loadCanonicalizerTripleRowHeadroomM4115();
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
      () => validateCanonicalizerTripleRowHeadroomM4115(copy),
      /coverage M4\.115 triple-row headroom rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), actual);
  assert.throws(
    () => validateCanonicalizerTripleRowHeadroomM4115(decorated),
    /coverage M4\.115 triple-row headroom rejection/u,
  );
  const shared = structuredClone(actual);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerTripleRowHeadroomM4115(shared),
    /cycles or shared references/u,
  );
  const cyclic = structuredClone(actual);
  cyclic.future = cyclic;
  assert.throws(
    () => validateCanonicalizerTripleRowHeadroomM4115(cyclic),
    /cycles or shared references/u,
  );
});

test('M4.115 preserves M4.114 and loads canonically in a fresh process', () => {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM4114();
  assert.equal(
    analysis.digest,
    '23fd8f52fa70e2a72fb4b4b1b7ae4c477b369a5f46853691b86b7506a9717e0c',
  );
  assert.equal(analysis.inputCommit, '2cb03f0e84f6c586dd28404d331a67dd2bb839bb');
  const receipt = loadCanonicalizerTripleRowHeadroomM4115();
  assert.equal(readFileSync(receiptUrl, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
  const fresh = JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {loadCanonicalizerTripleRowHeadroomM4115 as load} from './scripts/kern-canonicalizer/triple-row-headroom-m4-115.mjs'; process.stdout.write(JSON.stringify(load()))",
    ],
    {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    },
  ));
  assert.deepEqual(fresh, receipt);
});
