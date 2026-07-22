import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadCanonicalizerResidualAnalysisHandoff } from './coverage-residual-analysis.mjs';
import { loadPublishedCanonicalizerResidualAnalysisM438 } from './coverage-residual-analysis-m4-38.mjs';
import { loadPublishedCanonicalizerResidualAnalysisM442 } from './coverage-residual-analysis-m4-42.mjs';
import { loadPublishedCanonicalizerResidualAnalysisM443 } from './coverage-residual-analysis-m4-43.mjs';
import {
  measureCanonicalizerResidualAnalysisM446,
  validateCanonicalizerResidualAnalysisM446,
} from './coverage-residual-analysis-m4-46.mjs';
import { formatM446ResidualAnalysisStatus } from './coverage-status.mjs';
import { assertCoverageSummary } from './coverage-summary-writer.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-46.json', import.meta.url);

const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows'],
  completeFunctions: 4,
  completeTools: 3,
  limits: { maxNodeRows: 19, maxPropertyRows: 30, maxValueRows: 388 },
  totalDelta: 3,
  witnesses: [
    'examples/capstone-checker-subset/checker.kern#12:isIndexRebound',
    'examples/capstone-checker-subset/checker.kern#9:isUserCallable',
    'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#4:validinteger',
    'examples/selfhost-validator/validator.kern#3:isportable',
  ],
};

test('M4.46 publishes exact current residual assignments and measured frontier', () => {
  const actual = measureCanonicalizerResidualAnalysisM446();
  assert.equal(actual.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 60,
    baseId: 'kern.kir-canonicalizer.profile.m4.36',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: actual.baseline.coveragePolicyDigest,
    currentProfileLimits: {
      maxNodeRows: 16,
      maxPropertyRows: 30,
      maxValueRows: 388,
    },
    functionFactsDigest: actual.baseline.functionFactsDigest,
    legacyParameterBlockers: 43,
    residualFunctionCount: 43,
  });
  assert.equal(
    actual.assignmentsDigest,
    'f72e98d37cd3fcbc711c53bc6dfd8c4afe0ea56a08c21b3907a550a17fa0418c',
  );
  assert.equal(actual.assignments.length, 43);
  assert.equal(new Set(actual.assignments.map(({ id }) => id)).size, 43);
  assert.ok(actual.assignments.every(({ reasons }) => reasons.length > 0));
  assert.equal(actual.frontier.evaluatedObservedSettings, 26);
  assert.equal(actual.frontier.profileRowsAvailableFunctions, 27);
  assert.equal(actual.frontier.actionableCandidates.length, 26);
  assert.deepEqual(actual.selectedNextAction, actual.frontier.actionableCandidates[0]);
  assert.deepEqual(actual.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    actual.assignments
      .filter(({ id }) => EXPECTED_SELECTION.witnesses.includes(id))
      .reduce((total, { parameterRows }) => total + parameterRows, 0),
    12,
  );
  assert.equal(
    formatM446ResidualAnalysisStatus(actual.selectedNextAction),
    'M4.46 current analysis selected 4 functions by maxNodeRows widening.',
  );

  const checkedIn = JSON.parse(readFileSync(summaryUrl, 'utf8'));
  assert.deepEqual(actual, checkedIn);
  assertCoverageSummary(summaryUrl, actual);
  assert.deepEqual(validateCanonicalizerResidualAnalysisM446(checkedIn), checkedIn);
});

test('M4.46 analysis rejects assignment, candidate, ranking, and baseline drift', () => {
  const actual = measureCanonicalizerResidualAnalysisM446();
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
    (copy) => { copy.frontier.actionableCandidates[0].limits.maxNodeRows -= 1; },
    (copy) => { copy.frontier.actionableCandidates[0].totalDelta -= 1; },
    (copy) => { copy.frontier.actionableCandidates[0].witnesses.pop(); },
    (copy) => { copy.selectedNextAction = null; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerResidualAnalysisM446(copy),
      /coverage M4\.46 residual analysis rejection/u,
    );
  }
});

test('M4.46 analysis rejects decorated data before receipt comparison', () => {
  const actual = measureCanonicalizerResidualAnalysisM446();
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
      () => validateCanonicalizerResidualAnalysisM446(value),
      /coverage M4\.46 residual analysis rejection/u,
    );
  }
});

test('M4.46 preserves all published analyses and reproduces in a fresh process', () => {
  assert.equal(
    loadCanonicalizerResidualAnalysisHandoff().digest,
    '160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076',
  );
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM438().digest,
    '8bc1be3c941c8fd2d8a4a5990de0266f54ae986fbfd1e4712e6044c78cc092cd',
  );
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM442().digest,
    'f37fed74d24a739adf3584ceb7608f8d25c490d2325ebc1c127e05ee15238a8e',
  );
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM443().digest,
    '823e464ea6b6cc78a6959c0bced2b6d5f63b5722e0e15bda4a2dd08abf8200d8',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {measureCanonicalizerResidualAnalysisM446 as measure} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-46.mjs'; process.stdout.write(JSON.stringify(measure()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), measureCanonicalizerResidualAnalysisM446());
});
