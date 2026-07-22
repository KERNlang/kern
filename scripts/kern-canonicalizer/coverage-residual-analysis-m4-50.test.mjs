import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPublishedCanonicalizerResidualAnalysisM446,
} from './coverage-residual-analysis-m4-46.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM450,
  validatePublishedCanonicalizerResidualAnalysisM450,
} from './coverage-residual-analysis-m4-50.mjs';
import { formatM450ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-50.json', import.meta.url);
const PUBLISHED_DIGEST = '14fdff4dce865a79215eabdb02b05a29c62a66c633561e9643e2a46f38020e4f';
const EXPECTED_SELECTION = {
  changedLimits: ['maxPropertyRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 19, maxPropertyRows: 31, maxValueRows: 388 },
  totalDelta: 1,
  witnesses: [
    'examples/selfhost-validator/validator.kern#17:classcyclefrom',
  ],
};

test('M4.50 freezes the exact published residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM450();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.sourceCommit, '8600d8110986b0ddf7772611fc29af3245ee7c1c');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.equal(handoff.record.baseline.baseCompleteFunctions, 64);
  assert.equal(handoff.record.baseline.legacyParameterBlockers, 39);
  assert.equal(handoff.record.baseline.residualFunctionCount, 39);
  assert.equal(
    handoff.record.assignmentsDigest,
    'd3175ab22aaf82a3e37a5c439b4e603d3922e53224b649176c9940d9e04431dc',
  );
  assert.equal(handoff.record.assignments.length, 39);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 23);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 23);
  assert.equal(handoff.record.frontier.actionableCandidates.length, 23);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    formatM450ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.50 published analysis selected 1 function by maxPropertyRows widening; M4.51 authenticates structural runtime headroom.',
  );
});

test('M4.50 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM450().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.selectedNextAction = null; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM450(copy),
      /coverage M4\.50 residual analysis rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM450(decorated),
    /coverage M4\.50 residual analysis rejection/u,
  );
});

test('M4.50 preserves M4.46 and loads byte-identically in a fresh process', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM446().digest,
    '67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM450 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-50.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM450());
});
