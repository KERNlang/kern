import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM478 } from './coverage-residual-analysis-m4-78.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM483,
  measureCanonicalizerResidualAnalysisM483,
  validatePublishedCanonicalizerResidualAnalysisM483,
} from './coverage-residual-analysis-m4-83.mjs';
import { formatM483ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-83.json', import.meta.url);
const PUBLISHED_DIGEST = '42815f7d4bd02daa625718deb8b8ae04590efb605dccc69ffc90b3a4bdcbf546';
const EXPECTED_SELECTION = {
  changedLimits: ['maxValueRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 580 },
  totalDelta: 119,
  witnesses: [
    'examples/capstone-checker-subset/checker.kern#16:argProvenanced',
  ],
};

test('M4.83 freezes the exact published residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM483();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '89083ba126201067c918ea7e130382ca171f4097');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 82,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: '5f82778a5af9da23df0c6885fa1ec8188f792df3f105e448d82b26c5cb9c6c86',
    coveragePolicyDigest: 'e4a310720a9f41d9c0d8b9340177d5df634d1add5209420fe600ebef46e78da6',
    currentProfileLimits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 461 },
    functionFactsDigest: '75a50e5f254e43391c1643329b15b508c06910e7ee4063f86bd12089010077d2',
    legacyParameterBlockers: 22,
    residualFunctionCount: 22,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    '37f914f5ccfce7a4cb86c1235939e760a133936c22775f3a1d25043ea7c7dcec',
  );
  assert.equal(handoff.record.assignments.length, 22);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 6);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 6);
  assert.equal(handoff.record.frontier.actionableCandidates.length, 6);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    handoff.record.assignments
      .filter(({ id }) => EXPECTED_SELECTION.witnesses.includes(id))
      .reduce((total, { parameterRows }) => total + parameterRows, 0),
    19,
  );
  assert.equal(
    formatM483ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.83 published analysis selected 1 function by maxValueRows widening; M4.84 authenticates structural runtime headroom.',
  );
});

test('M4.83 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM483().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.baseline.currentProfileLimits.maxValueRows = 579; },
    (copy) => { copy.selectedNextAction.limits.maxValueRows = 581; },
    (copy) => { copy.selectedNextAction.witnesses.pop(); },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM483(copy),
      /coverage M4\.83 residual analysis rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM483(decorated),
    /coverage M4\.83 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.selectedNextAction = shared.frontier.actionableCandidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM483(shared),
    /coverage M4\.83 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.selectedNextAction.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM483(cyclic),
    /coverage M4\.83 residual analysis rejection/u,
  );
});

test('M4.83 matches live measurement and preserves M4.78 exactly', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM478().digest,
    'f63342ef1f4b2754add412232fd4cf24758b0a0f77b8522361ea2f66cd1fadc2',
  );
  assert.deepEqual(
    measureCanonicalizerResidualAnalysisM483(),
    loadPublishedCanonicalizerResidualAnalysisM483().record,
  );
});

test('M4.83 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM483 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-83.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM483());
});
