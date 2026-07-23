import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPublishedCanonicalizerNodeRowHeadroomM463,
  validatePublishedCanonicalizerNodeRowHeadroomM463,
} from './node-row-headroom-m4-63.mjs';

const RECEIPT_DIGEST = '110260eb3a2c9ed942e309d5b6e1331f2752bc486bfe99840c887e2a6ef7e7c3';
const summaryUrl = new URL('./node-row-headroom-m4-63.json', import.meta.url);

test('M4.63 freezes the exact published node-row structural headroom receipt', () => {
  const source = readFileSync(summaryUrl);
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  const handoff = loadPublishedCanonicalizerNodeRowHeadroomM463();
  assert.equal(handoff.digest, RECEIPT_DIGEST);
  assert.equal(handoff.sourceCommit, '6aba5e056c833e7dd2e613a21ac52e3f718d9673');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.node-row-headroom.2');
  assert.equal(handoff.record.artifactScope, 'structural-kir-function');
  assert.deepEqual(handoff.record.limits.candidateProfile, {
    maxNodeRows: 28,
    maxPropertyRows: 50,
    maxValueRows: 388,
  });
  assert.deepEqual(handoff.record.summary, {
    maxExactFloor: 27_076,
    minimumProductionHeadroom: 38_460,
    minimumPromotionHeadroom: 22_076,
    witnessCount: 4,
  });
  assert.equal(handoff.record.witnesses.reduce((total, row) => total + row.parameterRows, 0), 37);
  assert.deepEqual(handoff.record.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
});

test('M4.63 published digest rejects canonical and decorated drift', () => {
  const actual = loadPublishedCanonicalizerNodeRowHeadroomM463().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.node-row-headroom.3'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.candidateProfile.maxNodeRows += 1; },
    (copy) => { copy.witnesses.reverse(); },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerNodeRowHeadroomM463(copy),
      /coverage M4\.63 node-row headroom rejection/u,
    );
  }
  const decorated = structuredClone(actual);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerNodeRowHeadroomM463(decorated),
    /coverage M4\.63 node-row headroom rejection/u,
  );
});

test('M4.63 published handoff loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerNodeRowHeadroomM463 as load} from './scripts/kern-canonicalizer/node-row-headroom-m4-63.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerNodeRowHeadroomM463());
});
