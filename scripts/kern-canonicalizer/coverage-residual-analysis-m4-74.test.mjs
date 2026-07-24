import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM470 } from './coverage-residual-analysis-m4-70.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM474,
  validatePublishedCanonicalizerResidualAnalysisM474,
} from './coverage-residual-analysis-m4-74.mjs';
import { formatM474ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-74.json', import.meta.url);
const PUBLISHED_DIGEST = 'dae5ecfb09bd07575a8436771ff770c6ea544ea5efecba16ae45010b8f0df6e0';
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows', 'maxValueRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 38, maxPropertyRows: 53, maxValueRows: 461 },
  totalDelta: 80,
  witnesses: [
    'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
  ],
};

test('M4.74 freezes the exact published residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM474();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '1fe7851101cf2a25e1aebfd561655bb458aec66b');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 79,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: '7a378888f6dad20dc2b56660658068b02d169e312d25385e0de76f9ec9b63b49',
    coveragePolicyDigest: '60c907324d92462afdd16fb6d43b6f4ff837231cdf561caece4ad064053ab2f9',
    currentProfileLimits: { maxNodeRows: 31, maxPropertyRows: 53, maxValueRows: 388 },
    functionFactsDigest: '5bd2779a0abc83fcb9bd0f5bcfe74e162e3d45fd0c6dda4a37c9caef573fba03',
    legacyParameterBlockers: 24,
    residualFunctionCount: 24,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    'bc209e6142330b70cac9499b3cc66a6750bdf3baabe6763a9f6b847995c21831',
  );
  assert.equal(handoff.record.assignments.length, 24);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 8);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 8);
  assert.equal(handoff.record.frontier.actionableCandidates.length, 8);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    handoff.record.assignments
      .filter(({ id }) => EXPECTED_SELECTION.witnesses.includes(id))
      .reduce((total, { parameterRows }) => total + parameterRows, 0),
    6,
  );
  assert.equal(
    formatM474ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.74 published analysis selected 1 function by maxNodeRows+maxValueRows widening; M4.75 authenticates structural runtime headroom.',
  );
});

test('M4.74 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM474().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.baseline.currentProfileLimits.maxValueRows = 460; },
    (copy) => { copy.selectedNextAction.limits.maxNodeRows = 39; },
    (copy) => { copy.selectedNextAction.witnesses.pop(); },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM474(copy),
      /coverage M4\.74 residual analysis rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM474(decorated),
    /coverage M4\.74 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.selectedNextAction = shared.frontier.actionableCandidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM474(shared),
    /coverage M4\.74 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.selectedNextAction.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM474(cyclic),
    /coverage M4\.74 residual analysis rejection/u,
  );
});

test('M4.74 preserves M4.70 and loads byte-identically in a fresh process', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM470().digest,
    '2e1b2dea394f8a238b2f63b4a7045576b1843948740b3a6666b0c002971d8401',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM474 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-74.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM474());
});
