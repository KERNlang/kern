import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPublishedCanonicalizerPropertyRowHeadroomM451,
  validatePublishedCanonicalizerPropertyRowHeadroomM451,
} from './property-row-headroom-m4-51.mjs';

const summaryUrl = new URL('./property-row-headroom-m4-51.json', import.meta.url);
const RECEIPT_DIGEST = 'c36711a885495d41b879bdcc364122f380dfde1a720a0985cdafbd78e067dfbe';

test('M4.51 freezes the exact published property-row headroom receipt', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerPropertyRowHeadroomM451();
  const receipt = handoff.record;
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  assert.equal(handoff.digest, RECEIPT_DIGEST);
  assert.equal(handoff.sourceCommit, '2e363bab008fd2f03ef21fdc1bcb0a2488bd0637');
  assert.equal(receipt.format, 'kern.kir-canonicalizer.property-row-headroom.1');
  assert.equal(receipt.artifactScope, 'structural-kir-function');
  assert.deepEqual(receipt.limits, {
    candidateProfile: { maxNodeRows: 19, maxPropertyRows: 31, maxValueRows: 388 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 11_951,
    minimumProductionHeadroom: 53_585,
    minimumPromotionHeadroom: 37_201,
    witnessCount: 1,
  });
  assert.deepEqual(receipt.witnesses, [{
    belowFloorOutcome: 'failure',
    exactFloor: 11_951,
    floorOutcome: 'success',
    id: 'examples/selfhost-validator/validator.kern#17:classcyclefrom',
    parameterRows: 6,
    productionHeadroom: 53_585,
    profileRows: { nodes: 19, properties: 31, values: 202 },
    promotionHeadroom: 37_201,
    roundTrip: true,
  }]);
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
});

test('M4.51 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerPropertyRowHeadroomM451().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.property-row-headroom.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.candidateProfile.maxPropertyRows += 1; },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.witnesses[0].roundTrip = false; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerPropertyRowHeadroomM451(copy),
      /coverage M4\.51 property-row headroom rejection/u,
    );
  }
  const decorated = structuredClone(published);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerPropertyRowHeadroomM451(decorated),
    /coverage M4\.51 property-row headroom rejection/u,
  );
});

test('M4.51 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerPropertyRowHeadroomM451 as load} from './scripts/kern-canonicalizer/property-row-headroom-m4-51.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerPropertyRowHeadroomM451());
});
