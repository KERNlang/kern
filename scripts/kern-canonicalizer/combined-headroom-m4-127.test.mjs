import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildCanonicalizerCombinedHeadroomM4127,
  loadCanonicalizerCombinedHeadroomM4127,
  validateCanonicalizerCombinedHeadroomM4127,
} from './combined-headroom-m4-127.mjs';
import {
  measureCanonicalizerCombinedHeadroomWitnessM4127,
} from './combined-headroom-m4-127-measure.mjs';
import {
  loadPublishedCanonicalizerProjectionAnalysisM4126,
} from './projection-analysis-m4-126.mjs';

const RECEIPT_URL = new URL('./combined-headroom-m4-127.json', import.meta.url);
const RECEIPT_DIGEST =
  '604f2b9a59d2cd4b56b2a4263fcbb5129dd7bfb41c0601e7573b4a576515dcce';
const WITNESS_ID =
  'examples/selfhost-validator/validator.kern#20:validate';

test('M4.127 authenticates combined structural and runtime headroom NO-GO', () => {
  const source = readFileSync(RECEIPT_URL);
  const receipt = loadCanonicalizerCombinedHeadroomM4127();
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  assert.deepEqual(validateCanonicalizerCombinedHeadroomM4127(receipt), receipt);
  assert.deepEqual(buildCanonicalizerCombinedHeadroomM4127(), receipt);
  assert.deepEqual(receipt.limits, {
    activeKir: { maxBytes: 262_144, maxDepth: 77, maxNodes: 4_096 },
    activeProfile: { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2_411 },
    candidateKir: { maxBytes: 273_051, maxDepth: 98, maxNodes: 5_313 },
    candidateProfile: { maxNodeRows: 202, maxPropertyRows: 308, maxValueRows: 4_493 },
    productionBudget: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
    runtimeMaxDepth: 64,
  });
  assert.deepEqual(receipt.promotion, {
    combinedPromotionApproved: false,
    disposition: 'production-headroom-authenticated-promotion-budget-no-go',
    nextMilestone: 'M4.128',
    productionHeadroom: 10_642,
    promotionBudgetDeficit: 5_742,
    requiredFloorReduction: 5_742,
  });
  assert.equal(
    receipt.source.publishedInputCommit,
    '04e8f943ee070b4fc0b1d2ceb063adc53ecc5f06',
  );
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 54_894,
    minimumProductionHeadroom: 10_642,
    minimumPromotionHeadroom: -5_742,
    totalArtifactBytes: 273_051,
    totalParameterRows: 41,
    witnessCount: 1,
  });
  assert.deepEqual(receipt.witnesses, [{
    artifactBytes: 273_051,
    belowFloor: 54_893,
    belowFloorOutcome: 'failure',
    exactFloor: 54_894,
    floorOutcome: 'success',
    id: WITNESS_ID,
    parameterRows: 41,
    productionDelta: 10_642,
    profileRows: { nodes: 202, properties: 308, values: 4_493 },
    promotionDelta: -5_742,
    publicParityVerified: true,
    roundTrip: true,
  }]);
});

test('M4.127 exact floor fails below and succeeds with public parity', () => {
  const below = measureCanonicalizerCombinedHeadroomWitnessM4127(54_893);
  assert.equal(below.envelope.outcome, 'failure');
  assert.equal(below.roundTrip, false);
  const exact = measureCanonicalizerCombinedHeadroomWitnessM4127(
    54_894,
    { verifyPublicParity: true },
  );
  assert.equal(exact.envelope.outcome, 'success');
  assert.equal(exact.roundTrip, true);
  assert.equal(exact.publicParityVerified, true);
  assert.equal(exact.artifactBytes, 273_051);
  assert.deepEqual(exact.structuralRows, {
    nodes: 202,
    properties: 308,
    values: 4_493,
  });
});

test('M4.127 live measurement rejects invalid budgets and imports quietly', () => {
  assert.throws(
    () => measureCanonicalizerCombinedHeadroomWitnessM4127(0),
    /M4\.127 combined headroom measurement rejection/u,
  );
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await import('./scripts/kern-canonicalizer/combined-headroom-m4-127-measure.mjs'); process.stdout.write('quiet')",
      'scripts/check-kern-canonicalizer-coverage.mjs',
      '54894',
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(output, 'quiet');
});

test('M4.127 rejects receipt mutation, decoration, sharing, and cycles', () => {
  const actual = loadCanonicalizerCombinedHeadroomM4127();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.combined-headroom.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.candidateKir.maxBytes += 1; },
    (copy) => { copy.witnesses[0].exactFloor -= 1; },
    (copy) => { copy.promotion.combinedPromotionApproved = true; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerCombinedHeadroomM4127(copy),
      /coverage M4\.127 combined headroom rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), actual);
  assert.throws(
    () => validateCanonicalizerCombinedHeadroomM4127(decorated),
    /coverage M4\.127 combined headroom rejection/u,
  );
  const shared = structuredClone(actual);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerCombinedHeadroomM4127(shared),
    /cycles or shared references/u,
  );
  const cyclic = structuredClone(actual);
  cyclic.future = cyclic;
  assert.throws(
    () => validateCanonicalizerCombinedHeadroomM4127(cyclic),
    /cycles or shared references/u,
  );
});

test('M4.127 preserves M4.126 and loads canonically in a fresh process', () => {
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4126();
  assert.equal(
    analysis.digest,
    '25f1ba6ed40efdff909a6c95a11c385c12f9eba2b0025375ed4943f14393e369',
  );
  const receipt = loadCanonicalizerCombinedHeadroomM4127();
  assert.equal(readFileSync(RECEIPT_URL, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
  const fresh = JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {loadCanonicalizerCombinedHeadroomM4127 as load} from './scripts/kern-canonicalizer/combined-headroom-m4-127.mjs'; process.stdout.write(JSON.stringify(load()))",
    ],
    {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    },
  ));
  assert.deepEqual(fresh, receipt);
});
