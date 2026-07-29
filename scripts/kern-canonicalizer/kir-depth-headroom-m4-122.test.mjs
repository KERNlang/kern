import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildCanonicalizerKirDepthHeadroomM4122,
  loadCanonicalizerKirDepthHeadroomM4122,
  validateCanonicalizerKirDepthHeadroomM4122,
} from './kir-depth-headroom-m4-122.mjs';
import {
  measureCanonicalizerKirDepthHeadroomM4122,
  measureCanonicalizerKirDepthHeadroomWitnessM4122,
} from './kir-depth-headroom-m4-122-measure.mjs';
import { loadPublishedCanonicalizerProjectionAnalysisM4121 } from './projection-analysis-m4-121.mjs';

const summaryUrl = new URL('./kir-depth-headroom-m4-122.json', import.meta.url);
const WITNESS_ID = 'examples/capstone-checker-subset/checker.kern#2:rejectLine';
const RECEIPT_DIGEST =
  'e9b5e413a81d5c2992cd31eb705728608407e934d0f7c5c3d765865e65ad290e';

test('M4.122 authenticates exact structural KIR and runtime-envelope headroom', () => {
  const source = readFileSync(summaryUrl);
  const receipt = loadCanonicalizerKirDepthHeadroomM4122();
  assert.deepEqual(receipt, buildCanonicalizerKirDepthHeadroomM4122());
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.kir-depth-headroom.1');
  assert.deepEqual(receipt.limits, {
    activeKir: { maxBytes: 262144, maxDepth: 76, maxNodes: 4096 },
    candidateKir: { maxBytes: 262144, maxDepth: 77, maxNodes: 4096 },
    productionBudget: 65_536,
    profile: { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2411 },
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
    runtimeMaxDepth: 64,
  });
  assert.deepEqual(receipt.structuralBoundary, {
    belowCandidateDepth: 76,
    belowCandidateOutcome: 'failure',
    candidateDepth: 77,
    candidateOutcome: 'success',
    rejectedWitnesses: [WITNESS_ID],
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 1_007,
    minimumProductionHeadroom: 64_529,
    minimumPromotionHeadroom: 48_145,
    totalArtifactBytes: 7_725,
    totalParameterRows: 5,
    witnessCount: 1,
  });
  assert.equal(receipt.witnesses[0].id, WITNESS_ID);
  assert.equal(receipt.witnesses[0].requiredDepth, 77);
  assert.deepEqual(receipt.witnesses[0].structuralRows, {
    nodes: 8,
    properties: 15,
    values: 106,
  });
  assert.equal(receipt.witnesses[0].belowFloor, receipt.witnesses[0].exactFloor - 1);
  assert.equal(receipt.witnesses[0].belowFloorOutcome, 'failure');
  assert.equal(receipt.witnesses[0].floorOutcome, 'success');
  assert.equal(receipt.witnesses[0].publicParityVerified, true);
  assert.equal(receipt.witnesses[0].roundTrip, true);
  assert.equal(
    receipt.promotion.kirDepthPromotionApproved,
    receipt.witnesses[0].exactFloor <= receipt.limits.promotionBudget,
  );
  assert.deepEqual(
    receipt.witnesses,
    measureCanonicalizerKirDepthHeadroomM4122().witnesses,
  );
});

test('M4.122 live measurement rejects invalid witness and budget inputs', () => {
  assert.throws(
    () => measureCanonicalizerKirDepthHeadroomWitnessM4122('', 1),
    /M4\.122/u,
  );
  assert.throws(
    () => measureCanonicalizerKirDepthHeadroomWitnessM4122('missing', 0),
    /M4\.122/u,
  );
});

test('M4.122 receipt rejects mutation, decoration, sharing, and cycles', () => {
  const receipt = loadCanonicalizerKirDepthHeadroomM4122();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.kir-depth-headroom.3'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.candidateKir.maxDepth = 78; },
    (copy) => { copy.promotion.kirDepthPromotionApproved = false; },
    (copy) => { copy.source.compiledCoreJavaScriptSha256 = '0'.repeat(64); },
    (copy) => { copy.source.projectionAnalysisSha256 = '0'.repeat(64); },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerKirDepthHeadroomM4122(copy),
      /coverage M4\.122 KIR depth headroom rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), receipt);
  assert.throws(
    () => validateCanonicalizerKirDepthHeadroomM4122(decorated),
    /coverage M4\.122 KIR depth headroom rejection/u,
  );
  const shared = structuredClone(receipt);
  shared.future = shared.witnesses;
  assert.throws(
    () => validateCanonicalizerKirDepthHeadroomM4122(shared),
    /coverage M4\.122 KIR depth headroom rejection/u,
  );
  const cyclic = structuredClone(receipt);
  cyclic.self = cyclic;
  assert.throws(
    () => validateCanonicalizerKirDepthHeadroomM4122(cyclic),
    /coverage M4\.122 KIR depth headroom rejection/u,
  );
});

test('M4.122 preserves M4.121 and loads canonically in a fresh process', () => {
  assert.equal(
    loadPublishedCanonicalizerProjectionAnalysisM4121().digest,
    '2579208ec9759c7c31fc76d64dbbe4f09ac9852801506584e78450742a40f1b1',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadCanonicalizerKirDepthHeadroomM4122 as load} from " +
      "'./scripts/kern-canonicalizer/kir-depth-headroom-m4-122.mjs'; " +
      'process.stdout.write(JSON.stringify(load()))',
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadCanonicalizerKirDepthHeadroomM4122());
});
