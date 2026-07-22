import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPublishedCanonicalizerNodeRowHeadroomM447,
  validatePublishedCanonicalizerNodeRowHeadroomM447,
} from './node-row-headroom-m4-47.mjs';

const summaryUrl = new URL('./node-row-headroom-m4-47.json', import.meta.url);

test('M4.47 freezes the exact published structural headroom receipt', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerNodeRowHeadroomM447();
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    '0da8ef5be1be0ea2ac12ef739bd6cc38070d60b7b3a775f45602857d40979af1',
  );
  assert.equal(handoff.digest, '0da8ef5be1be0ea2ac12ef739bd6cc38070d60b7b3a775f45602857d40979af1');
  assert.equal(handoff.sourceCommit, '233e71a84fe7afdd7566e19a5545a885ffc36e8f');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.node-row-headroom.1');
  assert.equal(handoff.record.artifactScope, 'structural-kir-function');
  assert.deepEqual(handoff.record.limits, {
    candidateProfile: { maxNodeRows: 19, maxPropertyRows: 30, maxValueRows: 388 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(handoff.record.summary, {
    maxExactFloor: 15_236,
    minimumProductionHeadroom: 50_300,
    minimumPromotionHeadroom: 33_916,
    witnessCount: 4,
  });
  assert.equal(handoff.record.moduleEnvelope.disposition, 'not-claimed');
});

test('M4.47 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerNodeRowHeadroomM447().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.node-row-headroom.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.promotionBudget += 1; },
    (copy) => { copy.witnesses.reverse(); },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerNodeRowHeadroomM447(copy),
      /coverage M4\.47 node-row headroom rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerNodeRowHeadroomM447(decorated),
    /coverage M4\.47 node-row headroom rejection/u,
  );
});

test('M4.47 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerNodeRowHeadroomM447 as load} from './scripts/kern-canonicalizer/node-row-headroom-m4-47.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerNodeRowHeadroomM447());
});
