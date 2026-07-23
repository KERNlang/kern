import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPublishedCanonicalizerNodeRowHeadroomM467,
  validatePublishedCanonicalizerNodeRowHeadroomM467,
} from './node-row-headroom-m4-67.mjs';

const summaryUrl = new URL('./node-row-headroom-m4-67.json', import.meta.url);
const RECEIPT_DIGEST = '61e2c3b388160035d5764efcc2037c408eca8fc30f12010430168dd2b3bf9bca';

test('M4.67 freezes the exact published node-row structural headroom receipt', () => {
  const source = readFileSync(summaryUrl);
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  const handoff = loadPublishedCanonicalizerNodeRowHeadroomM467();
  assert.equal(handoff.digest, RECEIPT_DIGEST);
  assert.equal(handoff.sourceCommit, '40b6961bbd41f3b60e346ef3246d6587c0c3a1f4');
  const receipt = handoff.record;
  assert.equal(receipt.format, 'kern.kir-canonicalizer.node-row-headroom.3');
  assert.equal(receipt.artifactScope, 'structural-kir-function');
  assert.deepEqual(receipt.limits, {
    candidateProfile: { maxNodeRows: 30, maxPropertyRows: 50, maxValueRows: 388 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 17_552,
    minimumProductionHeadroom: 47_984,
    minimumPromotionHeadroom: 31_600,
    witnessCount: 1,
  });
  assert.deepEqual(
    receipt.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    [{
      exactFloor: 17_552,
      id: 'examples/capstone-checker-subset/checker.kern#3:isSurfaceKind',
      parameterRows: 1,
      profileRows: { nodes: 30, properties: 32, values: 219 },
    }],
  );
  assert.ok(receipt.witnesses[0].exactFloor <= receipt.limits.promotionBudget);
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.equal(
    receipt.source.residualAnalysisSha256,
    '7c3748692b35c5c30c9241b70de86af69ff5046382dba8b07963bd1c6e7c5736',
  );
  assert.equal(
    receipt.source.residualAnalysisInputCommit,
    'e81c1b9543ad53625f81c9bd9a513e55bfb18083',
  );
});

test('M4.67 published digest rejects receipt drift, decorated data, and shared references', () => {
  const actual = loadPublishedCanonicalizerNodeRowHeadroomM467().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.node-row-headroom.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.candidateProfile.maxNodeRows += 1; },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.witnesses[0].roundTrip = false; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerNodeRowHeadroomM467(copy),
      /coverage M4\.67 node-row headroom rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), actual);
  assert.throws(
    () => validatePublishedCanonicalizerNodeRowHeadroomM467(decorated),
    /coverage M4\.67 node-row headroom rejection/u,
  );
  const shared = structuredClone(actual);
  shared.future = shared.limits;
  assert.throws(
    () => validatePublishedCanonicalizerNodeRowHeadroomM467(shared),
    /cycles or shared references/u,
  );
});

test('M4.67 published handoff reproduces in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerNodeRowHeadroomM467 as load} from './scripts/kern-canonicalizer/node-row-headroom-m4-67.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerNodeRowHeadroomM467());
});
