import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM474 } from './coverage-residual-analysis-m4-74.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM478,
  validatePublishedCanonicalizerResidualAnalysisM478,
} from './coverage-residual-analysis-m4-78.mjs';
import { formatM478ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-78.json', import.meta.url);
const PUBLISHED_DIGEST = 'f63342ef1f4b2754add412232fd4cf24758b0a0f77b8522361ea2f66cd1fadc2';
const EXPECTED_SELECTION = {
  changedLimits: ['maxPropertyRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 461 },
  totalDelta: 8,
  witnesses: [
    'examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore',
  ],
};

test('M4.78 freezes the exact published residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM478();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '2ee34545f1a97acd5889f95e52bdd0952eb362bd');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 80,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: 'da5ef9ae66bb6e4d1ba703c39a9a15ce99cddaae1176973e1754598742b957df',
    coveragePolicyDigest: '1c923bfd76386c4e91296815fa3b5a3632c472f188cdba1094364d6dfd782813',
    currentProfileLimits: { maxNodeRows: 38, maxPropertyRows: 53, maxValueRows: 461 },
    functionFactsDigest: '054731c28f3cbb33c029826c9cd8af335aa0894b1129a39424a66b506d102bc2',
    legacyParameterBlockers: 23,
    residualFunctionCount: 23,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    '0abacdcff2a8ee7dfd977de09a3af2488350a383347b226a0afe36b8ca786ae7',
  );
  assert.equal(handoff.record.assignments.length, 23);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 7);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 7);
  assert.equal(handoff.record.frontier.actionableCandidates.length, 7);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    handoff.record.assignments
      .filter(({ id }) => EXPECTED_SELECTION.witnesses.includes(id))
      .reduce((total, { parameterRows }) => total + parameterRows, 0),
    22,
  );
  assert.equal(
    formatM478ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.78 published analysis selected 1 function by maxPropertyRows widening; M4.79 authenticates structural runtime headroom.',
  );
});

test('M4.78 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM478().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.baseline.currentProfileLimits.maxPropertyRows = 60; },
    (copy) => { copy.selectedNextAction.limits.maxPropertyRows = 62; },
    (copy) => { copy.selectedNextAction.witnesses.pop(); },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM478(copy),
      /coverage M4\.78 residual analysis rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM478(decorated),
    /coverage M4\.78 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.selectedNextAction = shared.frontier.actionableCandidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM478(shared),
    /coverage M4\.78 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.selectedNextAction.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM478(cyclic),
    /coverage M4\.78 residual analysis rejection/u,
  );
});

test('M4.78 preserves M4.74 and loads byte-identically in a fresh process', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM474().digest,
    'dae5ecfb09bd07575a8436771ff770c6ea544ea5efecba16ae45010b8f0df6e0',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM478 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-78.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM478());
});
