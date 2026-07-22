import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  measureCanonicalizerResidualAnalysisM438,
  validateCanonicalizerResidualAnalysisM438,
} from './coverage-residual-analysis-m4-38.mjs';
import { loadCanonicalizerResidualAnalysisHandoff } from './coverage-residual-analysis.mjs';
import { formatCurrentResidualAnalysisStatus } from './coverage-status.mjs';
import { assertCoverageSummary } from './coverage-summary-writer.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-38.json', import.meta.url);

test('M4.38 publishes exact current residual assignments and measured frontier', () => {
  const actual = measureCanonicalizerResidualAnalysisM438();
  assert.equal(actual.format, 'kern.kir-canonicalizer.residual-analysis.2');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 46,
    baseId: 'kern.kir-canonicalizer.profile.m4.36',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: actual.baseline.coveragePolicyDigest,
    currentProfileLimits: {
      maxNodeRows: 16,
      maxPropertyRows: 30,
      maxValueRows: 106,
    },
    functionFactsDigest: actual.baseline.functionFactsDigest,
    legacyParameterBlockers: 56,
    residualFunctionCount: 56,
  });
  assert.equal(
    actual.assignmentsDigest,
    '8ae6a54e20836ad1b560c88c59fed44e6bd96ecdfbee30cf5cb5404d44f0daef',
  );
  assert.equal(actual.assignments.length, 56);
  assert.equal(new Set(actual.assignments.map(({ id }) => id)).size, 56);
  assert.ok(actual.assignments.every(({ reasons }) => reasons.length > 0));
  assert.equal(actual.frontier.evaluatedObservedSettings, 39);
  assert.equal(actual.frontier.profileRowsAvailableFunctions, 40);
  assert.equal(actual.frontier.actionableCandidates.length, 39);
  assert.deepEqual(actual.selectedNextAction, actual.frontier.actionableCandidates[0]);
  assert.deepEqual(actual.selectedNextAction, {
    changedLimits: ['maxValueRows'],
    completeFunctions: 11,
    completeTools: 3,
    limits: { maxNodeRows: 16, maxPropertyRows: 30, maxValueRows: 154 },
    totalDelta: 48,
    witnesses: [
      'examples/capstone-checker-subset/checker-while.kern#10:isLengthType',
      'examples/capstone-checker-subset/checker-while.kern#5:checkerElseRejectDetail',
      'examples/capstone-checker-subset/checker.kern#19:mapArgToken',
      'examples/capstone-checker-subset/checker.kern#8:isArrayBinding',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#10:propid',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#12:childat',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#14:valuechildat',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#15:recordfield',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#2:valididentifier',
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#3:validexpressionidentifier',
      'examples/selfhost-validator/validator.kern#18:hasimportcyclefrom',
    ],
  });
  assert.equal(
    formatCurrentResidualAnalysisStatus(actual.selectedNextAction),
    'Current residual analysis selected 11 functions by maxValueRows widening.',
  );
  assert.equal(
    formatCurrentResidualAnalysisStatus(null),
    'Current residual analysis found no actionable profile widening.',
  );

  const checkedIn = JSON.parse(readFileSync(summaryUrl, 'utf8'));
  assert.deepEqual(actual, checkedIn);
  assertCoverageSummary(summaryUrl, actual);
  assert.deepEqual(validateCanonicalizerResidualAnalysisM438(checkedIn), checkedIn);
});

test('M4.38 analysis rejects assignment, candidate, ranking, and baseline drift', () => {
  const actual = measureCanonicalizerResidualAnalysisM438();
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.1'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments[0].reasons.pop(); },
    (copy) => { copy.baseline.coverageImplementationDigest = '0'.repeat(64); },
    (copy) => { copy.baseline.currentProfileLimits.maxValueRows += 1; },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.frontier.actionableCandidates[0].limits.maxValueRows -= 1; },
    (copy) => { copy.frontier.actionableCandidates[0].witnesses.pop(); },
    (copy) => { copy.selectedNextAction = null; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerResidualAnalysisM438(copy),
      /coverage M4.38 residual analysis rejection/u,
    );
  }
});

test('M4.38 analysis rejects decorated objects before comparing receipt data', () => {
  const actual = measureCanonicalizerResidualAnalysisM438();
  const toJsonSpoof = {
    future: true,
    toJSON: () => actual,
  };
  assert.equal(JSON.stringify(toJsonSpoof), JSON.stringify(actual));
  assert.throws(
    () => validateCanonicalizerResidualAnalysisM438(toJsonSpoof),
    /coverage M4\.38 residual analysis rejection/u,
  );

  const accessorSpoof = structuredClone(actual);
  Object.defineProperty(accessorSpoof, 'format', {
    enumerable: true,
    get: () => actual.format,
  });
  assert.equal(JSON.stringify(accessorSpoof), JSON.stringify(actual));
  assert.throws(
    () => validateCanonicalizerResidualAnalysisM438(accessorSpoof),
    /coverage M4\.38 residual analysis rejection/u,
  );

  const customPrototype = Object.assign(Object.create({ inherited: true }), actual);
  const symbolSpoof = structuredClone(actual);
  symbolSpoof[Symbol('hidden')] = true;
  const sparseSpoof = structuredClone(actual);
  sparseSpoof.assignments.length += 1;
  for (const value of [customPrototype, symbolSpoof, sparseSpoof]) {
    assert.throws(
      () => validateCanonicalizerResidualAnalysisM438(value),
      /coverage M4\.38 residual analysis rejection/u,
    );
  }

  const trusted = validateCanonicalizerResidualAnalysisM438(actual);
  assert.notEqual(trusted, actual);
  assert.deepEqual(trusted, actual);
});

test('M4.38 analysis preserves M4.31 and reproduces in a fresh process', () => {
  assert.equal(
    loadCanonicalizerResidualAnalysisHandoff().digest,
    '160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {measureCanonicalizerResidualAnalysisM438 as measure} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-38.mjs'; process.stdout.write(JSON.stringify(measure()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), measureCanonicalizerResidualAnalysisM438());
});
