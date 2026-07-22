import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPublishedCanonicalizerResidualAnalysisM446,
} from './coverage-residual-analysis-m4-46.mjs';
import {
  measureCanonicalizerResidualAnalysisM450,
  validateCanonicalizerResidualAnalysisM450,
} from './coverage-residual-analysis-m4-50.mjs';
import { formatM450ResidualAnalysisStatus } from './coverage-status.mjs';
import { assertCoverageSummary } from './coverage-summary-writer.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-50.json', import.meta.url);

const EXPECTED_SELECTION = {
  changedLimits: ['maxPropertyRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 19, maxPropertyRows: 31, maxValueRows: 388 },
  totalDelta: 1,
  witnesses: [
    'examples/selfhost-validator/validator.kern#17:classcyclefrom',
  ],
};

test('M4.50 publishes exact current residual assignments and measured frontier', () => {
  const actual = measureCanonicalizerResidualAnalysisM450();
  assert.equal(actual.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 64,
    baseId: 'kern.kir-canonicalizer.profile.m4.36',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: actual.baseline.coveragePolicyDigest,
    currentProfileLimits: {
      maxNodeRows: 19,
      maxPropertyRows: 30,
      maxValueRows: 388,
    },
    functionFactsDigest: actual.baseline.functionFactsDigest,
    legacyParameterBlockers: 39,
    residualFunctionCount: 39,
  });
  assert.equal(
    actual.assignmentsDigest,
    'd3175ab22aaf82a3e37a5c439b4e603d3922e53224b649176c9940d9e04431dc',
  );
  assert.equal(actual.assignments.length, 39);
  assert.equal(new Set(actual.assignments.map(({ id }) => id)).size, 39);
  assert.ok(actual.assignments.every(({ reasons }) => reasons.length > 0));
  assert.equal(actual.frontier.profileRowsAvailableFunctions, 23);
  assert.equal(actual.frontier.evaluatedObservedSettings, 23);
  assert.equal(actual.frontier.actionableCandidates.length, 23);
  assert.deepEqual(actual.selectedNextAction, actual.frontier.actionableCandidates[0]);
  assert.deepEqual(actual.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    formatM450ResidualAnalysisStatus(actual.selectedNextAction),
    'M4.50 current analysis selected 1 function by maxPropertyRows widening.',
  );

  const checkedIn = JSON.parse(readFileSync(summaryUrl, 'utf8'));
  assert.deepEqual(actual, checkedIn);
  assertCoverageSummary(summaryUrl, actual);
  assert.deepEqual(validateCanonicalizerResidualAnalysisM450(checkedIn), checkedIn);
});

test('M4.50 analysis rejects assignment, candidate, ranking, and baseline drift', () => {
  const actual = measureCanonicalizerResidualAnalysisM450();
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.assignments.reverse(); },
    (copy) => { copy.assignments[0].reasons.pop(); },
    (copy) => { copy.assignments[0].parameterRows += 1; },
    (copy) => { copy.baseline.coverageImplementationDigest = '0'.repeat(64); },
    (copy) => { copy.baseline.currentProfileLimits.maxNodeRows += 1; },
    (copy) => { copy.frontier.evaluatedObservedSettings -= 1; },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.frontier.actionableCandidates[0].changedLimits = ['maxValueRows']; },
    (copy) => { copy.frontier.actionableCandidates[0].totalDelta -= 1; },
    (copy) => { copy.frontier.actionableCandidates[0].witnesses.pop(); },
    (copy) => { copy.selectedNextAction = null; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerResidualAnalysisM450(copy),
      /coverage M4\.50 residual analysis rejection/u,
    );
  }
});

test('M4.50 analysis rejects decorated data before receipt comparison', () => {
  const actual = measureCanonicalizerResidualAnalysisM450();
  const toJsonSpoof = { future: true, toJSON: () => actual };
  assert.equal(JSON.stringify(toJsonSpoof), JSON.stringify(actual));

  const accessorSpoof = structuredClone(actual);
  Object.defineProperty(accessorSpoof, 'format', {
    enumerable: true,
    get: () => actual.format,
  });
  const customPrototype = Object.assign(Object.create({ inherited: true }), actual);
  const symbolSpoof = structuredClone(actual);
  symbolSpoof[Symbol('hidden')] = true;
  const sparseSpoof = structuredClone(actual);
  sparseSpoof.assignments.length += 1;
  for (const value of [toJsonSpoof, accessorSpoof, customPrototype, symbolSpoof, sparseSpoof]) {
    assert.throws(
      () => validateCanonicalizerResidualAnalysisM450(value),
      /coverage M4\.50 residual analysis rejection/u,
    );
  }
});

test('M4.50 preserves M4.46 and reproduces in a fresh process', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM446().digest,
    '67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {measureCanonicalizerResidualAnalysisM450 as measure} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-50.mjs'; process.stdout.write(JSON.stringify(measure()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), measureCanonicalizerResidualAnalysisM450());
});
