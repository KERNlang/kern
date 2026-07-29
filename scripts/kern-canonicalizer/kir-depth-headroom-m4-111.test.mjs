import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildCanonicalizerKirDepthHeadroomM4111,
  loadCanonicalizerKirDepthHeadroomM4111,
  validateCanonicalizerKirDepthHeadroomM4111,
} from './kir-depth-headroom-m4-111.mjs';
import {
  measureCanonicalizerKirDepthHeadroomWitnessM4111,
} from './kir-depth-headroom-m4-111-measure.mjs';
import { loadPublishedCanonicalizerProjectionAnalysisM4110 } from './projection-analysis-m4-110.mjs';

const summaryUrl = new URL('./kir-depth-headroom-m4-111.json', import.meta.url);
const RECEIPT_DIGEST = '0acd91174c05caa96587876209abe1e3aa8744d3d8643204d07028c3e0526be9';

test('M4.111 authenticates exact structural KIR and runtime-envelope headroom GO', () => {
  const source = readFileSync(summaryUrl);
  const receipt = loadCanonicalizerKirDepthHeadroomM4111();
  assert.deepEqual(receipt, buildCanonicalizerKirDepthHeadroomM4111());
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.kir-depth-headroom.1');
  assert.deepEqual(receipt.limits, {
    activeKir: { maxBytes: 262144, maxDepth: 64, maxNodes: 4096 },
    candidateKir: { maxBytes: 262144, maxDepth: 76, maxNodes: 4096 },
    productionBudget: 65_536,
    profile: { maxNodeRows: 89, maxPropertyRows: 125, maxValueRows: 2100 },
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
    runtimeMaxDepth: 64,
  });
  assert.deepEqual(receipt.promotion, {
    disposition: 'approved-with-headroom',
    kirDepthPromotionApproved: true,
    nextMilestone: 'M4.112',
    requiredDepth: 76,
  });
  assert.deepEqual(receipt.structuralBoundary, {
    belowCandidateDepth: 75,
    belowCandidateOutcome: 'failure',
    candidateDepth: 76,
    candidateOutcome: 'success',
    rejectedWitnesses: [
      'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#4:emitstatement',
      'examples/selfhost-validator/validator.kern#15:exportkind',
    ],
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 31_028,
    minimumProductionHeadroom: 34_508,
    minimumPromotionHeadroom: 18_124,
    totalArtifactBytes: 334_655,
    totalParameterRows: 134,
    witnessCount: 9,
  });
  assert.deepEqual(
    receipt.witnesses.map(({ exactFloor, id, requiredDepth }) => ({
      exactFloor,
      id,
      requiredDepth,
    })),
    [
      {
        exactFloor: 10_703,
        id: 'examples/capstone-assertion-engine/compare.kern#2:compareList',
        requiredDepth: 70,
      },
      {
        exactFloor: 13_107,
        id: 'examples/capstone-assertion-engine/compare.kern#3:compareMap',
        requiredDepth: 70,
      },
      {
        exactFloor: 10_605,
        id: 'examples/capstone-checker-subset/checker-while.kern#11:lengthReceiverProven',
        requiredDepth: 66,
      },
      {
        exactFloor: 18_032,
        id: 'examples/capstone-checker-subset/checker-while.kern#9:numericBindingProven',
        requiredDepth: 72,
      },
      {
        exactFloor: 14_058,
        id: 'examples/capstone-checker-subset/checker.kern#17:paramCallsitesOk',
        requiredDepth: 72,
      },
      {
        exactFloor: 4_290,
        id: 'examples/capstone-checker-subset/checker.kern#20:mapKeyToken',
        requiredDepth: 67,
      },
      {
        exactFloor: 8_374,
        id: 'examples/capstone-checker-subset/checker.kern#21:mapKnownBefore',
        requiredDepth: 71,
      },
      {
        exactFloor: 31_028,
        id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#4:emitstatement',
        requiredDepth: 76,
      },
      {
        exactFloor: 16_323,
        id: 'examples/selfhost-validator/validator.kern#15:exportkind',
        requiredDepth: 76,
      },
    ],
  );
});

test('M4.111 live measurement rejects invalid witness and budget inputs', () => {
  assert.throws(
    () => measureCanonicalizerKirDepthHeadroomWitnessM4111('', 1),
    /M4\.111/u,
  );
  assert.throws(
    () => measureCanonicalizerKirDepthHeadroomWitnessM4111('missing', 0),
    /M4\.111/u,
  );
});

test('M4.111 receipt rejects mutation, decoration, sharing, and cycles', () => {
  const receipt = loadCanonicalizerKirDepthHeadroomM4111();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.kir-depth-headroom.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.candidateKir.maxDepth = 77; },
    (copy) => { copy.promotion.kirDepthPromotionApproved = false; },
    (copy) => { copy.source.projectionAnalysisSha256 = '0'.repeat(64); },
    (copy) => { copy.witnesses.reverse(); },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerKirDepthHeadroomM4111(copy),
      /coverage M4\.111 KIR depth headroom rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), receipt);
  assert.throws(
    () => validateCanonicalizerKirDepthHeadroomM4111(decorated),
    /coverage M4\.111 KIR depth headroom rejection/u,
  );
  const shared = structuredClone(receipt);
  shared.witnesses[1] = shared.witnesses[0];
  assert.throws(
    () => validateCanonicalizerKirDepthHeadroomM4111(shared),
    /coverage M4\.111 KIR depth headroom rejection/u,
  );
  const cyclic = structuredClone(receipt);
  cyclic.self = cyclic;
  assert.throws(
    () => validateCanonicalizerKirDepthHeadroomM4111(cyclic),
    /coverage M4\.111 KIR depth headroom rejection/u,
  );
});

test('M4.111 exact floors remain immutable archival evidence after M4.117', () => {
  const receipt = loadCanonicalizerKirDepthHeadroomM4111();
  for (const witness of receipt.witnesses) {
    assert.equal(witness.belowFloor, witness.exactFloor - 1);
    assert.equal(witness.belowFloorOutcome, 'failure');
    assert.equal(witness.floorOutcome, 'success');
    assert.equal(witness.roundTrip, true);
  }
  const successor = measureCanonicalizerKirDepthHeadroomWitnessM4111(
    receipt.witnesses[0].id,
    receipt.witnesses[0].exactFloor,
  );
  assert.equal(successor.envelope.outcome, 'success');
  assert.equal(successor.roundTrip, true);
});

test('M4.111 preserves M4.110 and loads canonically in a fresh process', () => {
  assert.equal(
    loadPublishedCanonicalizerProjectionAnalysisM4110().digest,
    '38f26bb48237832163acb8fa99ee0b65b8dc343f77f6a7570481e54d01d6732f',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadCanonicalizerKirDepthHeadroomM4111 as load} from './scripts/kern-canonicalizer/kir-depth-headroom-m4-111.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadCanonicalizerKirDepthHeadroomM4111());
});
