import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM492 } from './coverage-residual-analysis-m4-92.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM495,
  measureCanonicalizerResidualAnalysisM495,
  validatePublishedCanonicalizerResidualAnalysisM495,
} from './coverage-residual-analysis-m4-95.mjs';
import { formatM495ResidualAnalysisStatus } from './coverage-status.mjs';
import { loadCanonicalizerRuntimeCostM493 } from './runtime-cost-m4-93.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-95.json', import.meta.url);
const PUBLISHED_DIGEST = 'f69bbae69a3f25d059dcdc23e023f4432dcd23c19dc9e6228087811f178a4928';
const EXPECTED_SELECTION = {
  changedLimits: ['maxPropertyRows', 'maxValueRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 74, maxPropertyRows: 95, maxValueRows: 832 },
  totalDelta: 270,
  witnesses: [
    'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk',
  ],
};

test('M4.95 freezes the exact published M4.94 residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM495();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, 'c623388fe7f8a8c288743f85bfaf79d55f889b94');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 89,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: 'f3e648ceb482e0b6131c97ee884d623169437408bcea83c427bcf61f99543a0c',
    coveragePolicyDigest: '3f68fc1e198be2c8072a619170e4494e05c54f8442dffa6271189bbd33a352c7',
    currentProfileLimits: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 },
    functionFactsDigest: 'c99b3c527d0e262a3c8876ea3508f52aac8ab8eaf7914fa6b3ff9792c0ab83f0',
    legacyParameterBlockers: 17,
    residualFunctionCount: 17,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    'ac1ce11255b827161910b883fb8061606849524c52f9531036dea2570e82264f',
  );
  assert.equal(handoff.record.assignments.length, 17);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 2);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 2);
  assert.equal(handoff.record.frontier.actionableCandidates.length, 2);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    handoff.record.assignments
      .filter(({ id }) => EXPECTED_SELECTION.witnesses.includes(id))
      .reduce((total, { parameterRows }) => total + parameterRows, 0),
    24,
  );
  assert.equal(
    formatM495ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.95 published analysis selected 1 function by maxPropertyRows+maxValueRows widening; ' +
      'M4.96 investigates the remaining runtime bottleneck before any profile promotion.',
  );
});

test('M4.95 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM495().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.baseline.currentProfileLimits.maxPropertyRows = 78; },
    (copy) => { copy.selectedNextAction.limits.maxValueRows = 833; },
    (copy) => { copy.selectedNextAction.witnesses.pop(); },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM495(copy),
      /coverage M4\.95 residual analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM495(decorated),
    /coverage M4\.95 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.selectedNextAction = shared.frontier.actionableCandidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM495(shared),
    /coverage M4\.95 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.selectedNextAction.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM495(cyclic),
    /coverage M4\.95 residual analysis rejection/u,
  );
});

test('M4.95 preserves exact M4.92 and M4.93 history', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM492().digest,
    'c6311d6351db075292af7a36a850787dd3bdf135ab290b60098da3ce25509e24',
  );
  assert.equal(
    createHash('sha256').update(readFileSync(
      new URL('./runtime-cost-m4-93.json', import.meta.url),
    )).digest('hex'),
    '62631ce9d2c97e80b6187c0d75bcb878a610ab1076ab8df71a46d53c0e51b3f3',
  );
  assert.equal(
    loadCanonicalizerRuntimeCostM493().productionObservation.outcome,
    'not-claimed',
  );
});

test('M4.95 receipt reproduces through the repository writer', () => {
  const publishedBytes = readFileSync(summaryUrl);
  const writer = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./coverage-residual-analysis-m4-95.mjs', import.meta.url)), '--write'],
    { encoding: 'utf8' },
  );
  assert.equal(writer.status, 0, writer.stderr);
  assert.deepEqual(readFileSync(summaryUrl), publishedBytes);
  assert.deepEqual(
    measureCanonicalizerResidualAnalysisM495(),
    loadPublishedCanonicalizerResidualAnalysisM495().record,
  );
});

test('M4.95 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM495 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-95.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM495());
});
