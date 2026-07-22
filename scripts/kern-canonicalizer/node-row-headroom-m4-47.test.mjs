import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM446 } from './coverage-residual-analysis-m4-46.mjs';
import {
  loadCanonicalizerNodeRowHeadroomM447,
  measureCanonicalizerNodeRowHeadroomM447,
  validateCanonicalizerNodeRowHeadroomM447,
} from './node-row-headroom-m4-47.mjs';
import { assertCoverageSummary } from './coverage-summary-writer.mjs';

const summaryUrl = new URL('./node-row-headroom-m4-47.json', import.meta.url);

test('M4.47 publishes exact structural headroom for the M4.46 node-row cohort', () => {
  const actual = measureCanonicalizerNodeRowHeadroomM447();
  const published = loadCanonicalizerNodeRowHeadroomM447();
  assert.equal(actual.format, 'kern.kir-canonicalizer.node-row-headroom.1');
  assert.equal(actual.artifactScope, 'structural-kir-function');
  assert.deepEqual(actual.limits, {
    candidateProfile: { maxNodeRows: 19, maxPropertyRows: 30, maxValueRows: 388 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(
    actual.witnesses.map(({ exactFloor, id }) => ({ exactFloor, id })),
    [
      { exactFloor: 8_303, id: 'examples/capstone-checker-subset/checker.kern#12:isIndexRebound' },
      { exactFloor: 10_361, id: 'examples/capstone-checker-subset/checker.kern#9:isUserCallable' },
      {
        exactFloor: 15_236,
        id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#4:validinteger',
      },
      { exactFloor: 10_591, id: 'examples/selfhost-validator/validator.kern#3:isportable' },
    ],
  );
  assert.deepEqual(actual.summary, {
    maxExactFloor: 15_236,
    minimumProductionHeadroom: 50_300,
    minimumPromotionHeadroom: 33_916,
    witnessCount: 4,
  });
  assert.equal(actual.moduleEnvelope.disposition, 'not-claimed');
  assert.deepEqual(actual, published);
  assert.deepEqual(actual, JSON.parse(readFileSync(summaryUrl, 'utf8')));
  assert.deepEqual(validateCanonicalizerNodeRowHeadroomM447(actual), actual);
  assertCoverageSummary(summaryUrl, actual);
  assert.equal(
    actual.source.residualAnalysisSha256,
    loadPublishedCanonicalizerResidualAnalysisM446().digest,
  );
});

test('M4.47 headroom receipt rejects source, arithmetic, witness, and decorated drift', () => {
  const actual = measureCanonicalizerNodeRowHeadroomM447();
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.node-row-headroom.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.artifactScope = 'module-kir'; },
    (copy) => { copy.source.residualAnalysisSha256 = '0'.repeat(64); },
    (copy) => { copy.limits.promotionBudget += 1; },
    (copy) => { copy.witnesses.reverse(); },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.witnesses[0].promotionHeadroom -= 1; },
    (copy) => { copy.witnesses[0].roundTrip = false; },
    (copy) => { copy.summary.maxExactFloor -= 1; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerNodeRowHeadroomM447(copy),
      /coverage M4\.47 node-row headroom rejection/u,
    );
  }
  const decorated = structuredClone(actual);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validateCanonicalizerNodeRowHeadroomM447(decorated),
    /coverage M4\.47 node-row headroom rejection/u,
  );
});

test('M4.47 headroom evidence reproduces in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {measureCanonicalizerNodeRowHeadroomM447 as measure} from './scripts/kern-canonicalizer/node-row-headroom-m4-47.mjs'; process.stdout.write(JSON.stringify(measure()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), measureCanonicalizerNodeRowHeadroomM447());
});
