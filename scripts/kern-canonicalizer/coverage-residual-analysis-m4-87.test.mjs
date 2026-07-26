import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM483 } from './coverage-residual-analysis-m4-83.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM487,
  measureCanonicalizerResidualAnalysisM487,
  validatePublishedCanonicalizerResidualAnalysisM487,
} from './coverage-residual-analysis-m4-87.mjs';
import { formatM487ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-87.json', import.meta.url);
const PUBLISHED_DIGEST = '9046716d876c336140b567a8a40a9b52750106b2ac5db66f38f7621e935c203a';
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows', 'maxPropertyRows'],
  completeFunctions: 3,
  completeTools: 2,
  limits: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 },
  totalDelta: 52,
  witnesses: [
    'examples/capstone-checker-subset/checker.kern#18:indexRejectDetail',
    'examples/capstone-checker-subset/checker.kern#23:callRejectCode',
    'examples/selfhost-validator/validator.kern#2:isreserved',
  ],
};

test('M4.87 freezes the exact published residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM487();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '46337a6549390087ef095c18d0e178cf9ef28392');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 84,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: '35059b731c4761f49f1d8102db06cfe3b56b83ce76ff606232cb15f4e4f361e5',
    coveragePolicyDigest: '4ac57e59be2bcdb7b9aa0f7f35598703600bf47b4f17709e59c5823c0e605490',
    currentProfileLimits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 580 },
    functionFactsDigest: 'f6d4abfacc8e9fb592cca4e8aef28b59f6b5af963c07514f00dd760ca798624a',
    legacyParameterBlockers: 21,
    residualFunctionCount: 21,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    '0e6700b777a3cf2f5ed462636ba292ef69df90de141e3466b8831d8f190b7328',
  );
  assert.equal(handoff.record.assignments.length, 21);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 5);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 5);
  assert.equal(handoff.record.frontier.actionableCandidates.length, 5);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    handoff.record.assignments
      .filter(({ id }) => EXPECTED_SELECTION.witnesses.includes(id))
      .reduce((total, { parameterRows }) => total + parameterRows, 0),
    40,
  );
  assert.equal(
    formatM487ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.87 published analysis selected 3 functions by maxNodeRows+maxPropertyRows widening; M4.88 authenticates structural runtime headroom.',
  );
});

test('M4.87 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM487().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.baseline.currentProfileLimits.maxPropertyRows = 62; },
    (copy) => { copy.selectedNextAction.limits.maxNodeRows = 75; },
    (copy) => { copy.selectedNextAction.witnesses.pop(); },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM487(copy),
      /coverage M4\.87 residual analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM487(decorated),
    /coverage M4\.87 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.selectedNextAction = shared.frontier.actionableCandidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM487(shared),
    /coverage M4\.87 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.selectedNextAction.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM487(cyclic),
    /coverage M4\.87 residual analysis rejection/u,
  );
});

test('M4.87 preserves the exact published M4.83 history', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM483().digest,
    '42815f7d4bd02daa625718deb8b8ae04590efb605dccc69ffc90b3a4bdcbf546',
  );
  assert.deepEqual(loadPublishedCanonicalizerResidualAnalysisM487().record.selectedNextAction, EXPECTED_SELECTION);
});

test('M4.87 refuses regeneration from the changed M4.89 semantic frontier', () => {
  const publishedBytes = readFileSync(summaryUrl);
  assert.throws(
    () => measureCanonicalizerResidualAnalysisM487(),
    /live semantic facts must match the exact published M4\.86 input/u,
  );

  const writer = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./coverage-residual-analysis-m4-87.mjs', import.meta.url)), '--write'],
    { encoding: 'utf8' },
  );
  assert.notEqual(writer.status, 0);
  assert.match(writer.stderr, /live semantic facts must match the exact published M4\.86 input/u);
  assert.deepEqual(readFileSync(summaryUrl), publishedBytes);
});

test('M4.87 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM487 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-87.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM487());
});
