import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM4101 } from './coverage-residual-analysis-m4-101.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM4109,
  measureCanonicalizerResidualAnalysisM4109,
  validatePublishedCanonicalizerResidualAnalysisM4109,
} from './coverage-residual-analysis-m4-109.mjs';
import { formatM4109ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-109.json', import.meta.url);
const PUBLISHED_DIGEST = 'ad6240c77ed276d1f865beb702ceeb7c85767191dbaa3cf36f526505c4e555fb';

test('M4.109 freezes the exact published M4.108 residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4109();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '88e311ac5565ed424f71bb2f9ed7a18333a5e8e4');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 92,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: 'f06254bfd88d53c1887c014689e5a7de451fb5540e04c8dc1c30b27380e42143',
    coveragePolicyDigest: '0285747660651cab2ee1029456dc40c190c42d2515937fa6d3534247df363b54',
    currentProfileLimits: { maxNodeRows: 89, maxPropertyRows: 125, maxValueRows: 2100 },
    functionFactsDigest: 'd5fa84e9d8cca79d2352ae106a533dd489291b670ab27ad4adc7e70010a2e214',
    legacyParameterBlockers: 15,
    residualFunctionCount: 15,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    'f200b876c0ed6dd9cd75cfebe1c46c3d6cf97b13e0422886bc13b0f02f46b203',
  );
  assert.equal(handoff.record.assignments.length, 15);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 0);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 0);
  assert.deepEqual(handoff.record.frontier.actionableCandidates, []);
  assert.equal(handoff.record.selectedNextAction, null);
  assert.equal(
    formatM4109ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.109 published analysis found no actionable profile widening; ' +
      'M4.110 investigates the authenticated projection blockers.',
  );
});

test('M4.109 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM4109().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.profileRowsAvailableFunctions = 1; },
    (copy) => { copy.frontier.evaluatedObservedSettings = 1; },
    (copy) => { copy.frontier.actionableCandidates.push({}); },
    (copy) => { copy.selectedNextAction = {}; },
    (copy) => { copy.baseline.currentProfileLimits.maxNodeRows = 90; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM4109(copy),
      /coverage M4\.109 residual analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4109(decorated),
    /coverage M4\.109 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.frontier.actionableCandidates.push(shared.assignments[0]);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4109(shared),
    /coverage M4\.109 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.frontier.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4109(cyclic),
    /coverage M4\.109 residual analysis rejection/u,
  );
});

test('M4.109 remains immutable archival evidence after M4.117', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM4101().digest,
    '9b389d0b2536cf2cd11d49bc47f1f234c46924c14c2ef160faf633069a3c94f0',
  );
  assert.throws(
    () => measureCanonicalizerResidualAnalysisM4109(),
    /policy digest must remain exact/u,
  );
});

test('M4.109 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM4109 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-109.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM4109());
});
