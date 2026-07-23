import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM450 } from './coverage-residual-analysis-m4-50.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM454,
  validatePublishedCanonicalizerResidualAnalysisM454,
} from './coverage-residual-analysis-m4-54.mjs';
import { formatM454ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-54.json', import.meta.url);
const PUBLISHED_DIGEST = '9c8507a4fe5bacf1048bfc1f6946c3e493ee35cd7fb63ce3a2a7ced474ad1423';
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows', 'maxPropertyRows'],
  completeFunctions: 7,
  completeTools: 4,
  limits: { maxNodeRows: 25, maxPropertyRows: 50, maxValueRows: 388 },
  totalDelta: 25,
  witnesses: [
    'examples/capstone-assertion-engine/compare.kern#4:compareNode',
    'examples/capstone-checker-subset/checker-while.kern#14:literalTrue',
    'examples/capstone-checker-subset/checker-while.kern#17:checkerWhileRejectDetail',
    'examples/capstone-checker-subset/checker.kern#14:termProvenanced',
    'examples/capstone-checker-subset/checker.kern#6:whileRejectDetail',
    'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#3:emitstatementlist',
    'examples/selfhost-validator/validator.kern#11:owncallable',
  ],
};

test('M4.54 freezes the exact published residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM454();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '87431a527dfb8d0f3a707b74ce33907392670a51');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 65,
    baseId: 'kern.kir-canonicalizer.profile.m4.36',
    coverageImplementationDigest: '6bb9375f22dd1bee7dd371c43f725d68a79dc2e83e94b2cecc3c1c3c5c15dd93',
    coveragePolicyDigest: '213ce7266b0d8e449c4333483fe8862ae7d3fc69f2aaa7b869595dcbd5111d5c',
    currentProfileLimits: { maxNodeRows: 19, maxPropertyRows: 31, maxValueRows: 388 },
    functionFactsDigest: '7f42974aba8157c6f20fae3cf0c7632317e36e2e7c0d6e5869c32aa31970dc78',
    legacyParameterBlockers: 38,
    residualFunctionCount: 38,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    '158ee2e9ee592986fa70f10e7345a243db0b082f7949497275e2dce2141ae6c8',
  );
  assert.equal(handoff.record.assignments.length, 38);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 22);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 22);
  assert.equal(handoff.record.frontier.actionableCandidates.length, 22);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    handoff.record.assignments
      .filter(({ id }) => EXPECTED_SELECTION.witnesses.includes(id))
      .reduce((total, { parameterRows }) => total + parameterRows, 0),
    102,
  );
  assert.equal(
    formatM454ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.54 published analysis selected 7 functions by maxNodeRows+maxPropertyRows widening; M4.55 authenticates structural runtime headroom.',
  );
});

test('M4.54 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM454().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.selectedNextAction.limits.maxNodeRows = 24; },
    (copy) => { copy.selectedNextAction.witnesses.pop(); },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM454(copy),
      /coverage M4\.54 residual analysis rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM454(decorated),
    /coverage M4\.54 residual analysis rejection/u,
  );
});

test('M4.54 preserves M4.50 and loads byte-identically in a fresh process', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM450().digest,
    '14fdff4dce865a79215eabdb02b05a29c62a66c633561e9643e2a46f38020e4f',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM454 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-54.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM454());
});
