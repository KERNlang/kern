import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM462 } from './coverage-residual-analysis-m4-62.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM466,
  measureCanonicalizerResidualAnalysisM466,
  validatePublishedCanonicalizerResidualAnalysisM466,
} from './coverage-residual-analysis-m4-66.mjs';
import { formatM466ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-66.json', import.meta.url);
const PUBLISHED_DIGEST = '7c3748692b35c5c30c9241b70de86af69ff5046382dba8b07963bd1c6e7c5736';
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 30, maxPropertyRows: 50, maxValueRows: 388 },
  totalDelta: 2,
  witnesses: [
    'examples/capstone-checker-subset/checker.kern#3:isSurfaceKind',
  ],
};

test('M4.66 freezes the exact published residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM466();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, 'e81c1b9543ad53625f81c9bd9a513e55bfb18083');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 77,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: 'acac325be26eb7ec7ebdfbb0d5d1b7446a056333e63c3183d17e4fb322d56c8c',
    coveragePolicyDigest: 'b3f720fb34255cf93466430c17924fd9f3b6f81b588cae8a0526dc598ed8cfcf',
    currentProfileLimits: { maxNodeRows: 28, maxPropertyRows: 50, maxValueRows: 388 },
    functionFactsDigest: '5b2b03d3e5659e391462f3591416d3d032bf9becef42658396bf894af86bc4d1',
    legacyParameterBlockers: 26,
    residualFunctionCount: 26,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    '68108254cf57ba70b019f6556c6808e585eeb63355078b7f9c243271fdb989c6',
  );
  assert.equal(handoff.record.assignments.length, 26);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 10);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 10);
  assert.equal(handoff.record.frontier.actionableCandidates.length, 10);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    handoff.record.assignments
      .filter(({ id }) => EXPECTED_SELECTION.witnesses.includes(id))
      .reduce((total, { parameterRows }) => total + parameterRows, 0),
    1,
  );
  assert.equal(
    formatM466ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.66 published analysis selected 1 function by maxNodeRows widening; M4.67 authenticates structural runtime headroom.',
  );
});

test('M4.66 repository measurement reproduces the exact published receipt', () => {
  assert.deepEqual(
    measureCanonicalizerResidualAnalysisM466(),
    loadPublishedCanonicalizerResidualAnalysisM466().record,
  );
});

test('M4.66 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM466().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.baseline.currentProfileLimits.maxNodeRows = 29; },
    (copy) => { copy.selectedNextAction.limits.maxNodeRows = 29; },
    (copy) => { copy.selectedNextAction.witnesses.pop(); },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM466(copy),
      /coverage M4\.66 residual analysis rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM466(decorated),
    /coverage M4\.66 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.selectedNextAction = shared.frontier.actionableCandidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM466(shared),
    /coverage M4\.66 residual analysis rejection/u,
  );
});

test('M4.66 preserves M4.62 and loads byte-identically in a fresh process', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM462().digest,
    '5339ffa5c128efbe857b53e64a67092d72b8b6b6cbe6cc3ea16c96f4939e79cc',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM466 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-66.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM466());
});
