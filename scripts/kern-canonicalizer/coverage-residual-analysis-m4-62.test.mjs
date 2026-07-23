import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM454 } from './coverage-residual-analysis-m4-54.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM462,
  measureCanonicalizerResidualAnalysisM462,
  validatePublishedCanonicalizerResidualAnalysisM462,
} from './coverage-residual-analysis-m4-62.mjs';
import { formatM462ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-62.json', import.meta.url);
const PUBLISHED_DIGEST = '5339ffa5c128efbe857b53e64a67092d72b8b6b6cbe6cc3ea16c96f4939e79cc';
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows'],
  completeFunctions: 4,
  completeTools: 2,
  limits: { maxNodeRows: 28, maxPropertyRows: 50, maxValueRows: 388 },
  totalDelta: 3,
  witnesses: [
    'examples/capstone-checker-subset/checker-while.kern#1:isSafeMagnitude',
    'examples/capstone-checker-subset/checker.kern#22:mapCallRejectDetail',
    'examples/selfhost-validator/validator.kern#10:fnokat',
    'examples/selfhost-validator/validator.kern#12:ownexportkind',
  ],
};

test('M4.62 freezes the exact current residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM462();
  assert.deepEqual(measureCanonicalizerResidualAnalysisM462(), handoff.record);
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, 'f36a870843ccdd222e8cf2e7595c0e205ed545bf');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 73,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: '613810d0b74e31f21cd756520dbfe94047ba06ee654ef349a86663a32b517d83',
    coveragePolicyDigest: '00517a1a5e8958ed4158310a2c5c4815c9a8cf673d98e73f45c41f4edbae408e',
    currentProfileLimits: { maxNodeRows: 25, maxPropertyRows: 50, maxValueRows: 388 },
    functionFactsDigest: '4ef2c486bbff42c35795789ac66e362863a357f5e7d6ca10dd77525576dc761d',
    legacyParameterBlockers: 30,
    residualFunctionCount: 30,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    '6a2d680c3dfe3fdbddf24f5b6cd383e03d5c2b7ed1fdf5667ec6ea94551c40e5',
  );
  assert.equal(handoff.record.assignments.length, 30);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 14);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 12);
  assert.equal(handoff.record.frontier.actionableCandidates.length, 12);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    handoff.record.assignments
      .filter(({ id }) => EXPECTED_SELECTION.witnesses.includes(id))
      .reduce((total, { parameterRows }) => total + parameterRows, 0),
    37,
  );
  assert.equal(
    formatM462ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.62 published analysis selected 4 functions by maxNodeRows widening; M4.63 authenticates structural runtime headroom.',
  );
});

test('M4.62 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM462().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.selectedNextAction.limits.maxNodeRows = 27; },
    (copy) => { copy.selectedNextAction.witnesses.pop(); },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM462(copy),
      /coverage M4\.62 residual analysis rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM462(decorated),
    /coverage M4\.62 residual analysis rejection/u,
  );
});

test('M4.62 preserves M4.54 and loads byte-identically in a fresh process', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM454().digest,
    '9c8507a4fe5bacf1048bfc1f6946c3e493ee35cd7fb63ce3a2a7ced474ad1423',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM462 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-62.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM462());
});
