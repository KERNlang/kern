import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM487 } from './coverage-residual-analysis-m4-87.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM492,
  measureCanonicalizerResidualAnalysisM492,
  validatePublishedCanonicalizerResidualAnalysisM492,
} from './coverage-residual-analysis-m4-92.mjs';
import { formatM492ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-92.json', import.meta.url);
const PUBLISHED_DIGEST = 'c6311d6351db075292af7a36a850787dd3bdf135ab290b60098da3ce25509e24';
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

test('M4.92 freezes the exact published M4.91 residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM492();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '730aa181e1e3ea40b88dd22f74c58e853a706009');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 88,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: 'e7657b9c2a8e2a238bc5f1dbc190a804341a17d5cc70ed4e595aeea1062813c3',
    coveragePolicyDigest: '6cbdac4c6dfaa9746be103d1d8d10f01d89655f9e7ba9b2299f418d27beb9453',
    currentProfileLimits: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 },
    functionFactsDigest: 'df84fe6408fa96768ec67f9c2940ac27277ae7dbc1f0c81dbfb2ced29f58a225',
    legacyParameterBlockers: 18,
    residualFunctionCount: 18,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    'b222027da0639addba00e2c0149684e1e02a9bfd199feacae921b5fc028e07fe',
  );
  assert.equal(handoff.record.assignments.length, 18);
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
    formatM492ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.92 published analysis selected 1 function by maxPropertyRows+maxValueRows widening; M4.93 authenticates structural runtime headroom.',
  );
});

test('M4.92 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM492().record;
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
      () => validatePublishedCanonicalizerResidualAnalysisM492(copy),
      /coverage M4\.92 residual analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM492(decorated),
    /coverage M4\.92 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.selectedNextAction = shared.frontier.actionableCandidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM492(shared),
    /coverage M4\.92 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.selectedNextAction.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM492(cyclic),
    /coverage M4\.92 residual analysis rejection/u,
  );
});

test('M4.92 preserves exact M4.87 history and reproduces from current M4.91 facts', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM487().digest,
    '9046716d876c336140b567a8a40a9b52750106b2ac5db66f38f7621e935c203a',
  );
  assert.deepEqual(measureCanonicalizerResidualAnalysisM492().selectedNextAction, EXPECTED_SELECTION);
});

test('M4.92 repository writer reproduces the exact published bytes', () => {
  const publishedBytes = readFileSync(summaryUrl);
  const writer = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./coverage-residual-analysis-m4-92.mjs', import.meta.url)), '--write'],
    { encoding: 'utf8' },
  );
  assert.equal(writer.status, 0, writer.stderr);
  assert.deepEqual(readFileSync(summaryUrl), publishedBytes);
});

test('M4.92 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM492 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-92.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM492());
});
