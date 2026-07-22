import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPublishedCanonicalizerResidualAnalysisM450,
} from './coverage-residual-analysis-m4-50.mjs';
import {
  loadCanonicalizerPropertyRowHeadroomM451,
  measureCanonicalizerPropertyRowHeadroomM451,
  validateCanonicalizerPropertyRowHeadroomM451,
} from './property-row-headroom-m4-51.mjs';

const summaryUrl = new URL('./property-row-headroom-m4-51.json', import.meta.url);
const RECEIPT_DIGEST = 'c36711a885495d41b879bdcc364122f380dfde1a720a0985cdafbd78e067dfbe';

test('M4.51 authenticates exact property-row structural headroom', () => {
  const source = readFileSync(summaryUrl);
  const receipt = loadCanonicalizerPropertyRowHeadroomM451();
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  assert.deepEqual(receipt, measureCanonicalizerPropertyRowHeadroomM451());
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
  assert.equal(
    receipt.source.residualAnalysisSha256,
    '14fdff4dce865a79215eabdb02b05a29c62a66c633561e9643e2a46f38020e4f',
  );
  assert.equal(receipt.source.residualAnalysisSourceCommit, '8600d8110986b0ddf7772611fc29af3245ee7c1c');
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
});

test('M4.51 receipt rejects evidence drift and decorated data', () => {
  const actual = loadCanonicalizerPropertyRowHeadroomM451();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.property-row-headroom.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.candidateProfile.maxPropertyRows += 1; },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.witnesses[0].roundTrip = false; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerPropertyRowHeadroomM451(copy),
      /coverage M4\.51 property-row headroom rejection/u,
    );
  }
  const decorated = structuredClone(actual);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validateCanonicalizerPropertyRowHeadroomM451(decorated),
    /coverage M4\.51 property-row headroom rejection/u,
  );
});

test('M4.51 preserves M4.50 and reproduces in a fresh locale-independent process', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM450().digest,
    '14fdff4dce865a79215eabdb02b05a29c62a66c633561e9643e2a46f38020e4f',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadCanonicalizerPropertyRowHeadroomM451 as load} from './scripts/kern-canonicalizer/property-row-headroom-m4-51.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadCanonicalizerPropertyRowHeadroomM451());
});
