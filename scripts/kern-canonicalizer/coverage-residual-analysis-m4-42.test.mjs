import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM438 } from './coverage-residual-analysis-m4-38.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM442,
  validatePublishedCanonicalizerResidualAnalysisM442,
} from './coverage-residual-analysis-m4-42.mjs';
import { measureCurrentCanonicalizerResidualAnalysis } from './coverage-residual-analysis-current.mjs';
import { loadCanonicalizerResidualAnalysisHandoff } from './coverage-residual-analysis.mjs';
import { formatM442ResidualAnalysisStatus } from './coverage-status.mjs';
import { assertCoverageSummary } from './coverage-summary-writer.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-42.json', import.meta.url);

function publishedRecord() {
  return loadPublishedCanonicalizerResidualAnalysisM442().record;
}

test('M4.42 preserves exact published residual assignments and measured frontier', () => {
  const handoff = loadPublishedCanonicalizerResidualAnalysisM442();
  const actual = handoff.record;
  assert.equal(handoff.digest, 'f37fed74d24a739adf3584ceb7608f8d25c490d2325ebc1c127e05ee15238a8e');
  assert.equal(handoff.sourceCommit, 'fa762508cf48beac0fce18afdda39beb08da51f1');
  assert.equal(actual.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 57,
    baseId: 'kern.kir-canonicalizer.profile.m4.36',
    coverageImplementationDigest: '6c74f747f3df19ea9e09eb88be4e0aa10d54a7319f90af0eeffe4054ad9ebd2d',
    coveragePolicyDigest: 'c6fa85f4906716bc11f13b68192e4108a46d61329c690aaa6be53c5433f8a3e6',
    currentProfileLimits: {
      maxNodeRows: 16,
      maxPropertyRows: 30,
      maxValueRows: 154,
    },
    functionFactsDigest: 'ca9702a70e92e79aa384c04a09e4ea835009e19f726671dead147f160b632ea8',
    legacyParameterBlockers: 45,
    residualFunctionCount: 45,
  });
  assert.equal(
    actual.assignmentsDigest,
    'a965461fa32dc4bbb1fdfa3ca153d91d019865e6ddb10e57f64087be6d7402bf',
  );
  assert.equal(actual.assignments.length, 45);
  assert.equal(new Set(actual.assignments.map(({ id }) => id)).size, 45);
  assert.ok(actual.assignments.every(({ reasons }) => reasons.length > 0));
  assert.equal(actual.frontier.evaluatedObservedSettings, 29);
  assert.equal(actual.frontier.profileRowsAvailableFunctions, 29);
  assert.equal(actual.frontier.actionableCandidates.length, 29);
  assert.deepEqual(actual.selectedNextAction, actual.frontier.actionableCandidates[0]);
  assert.deepEqual(actual.selectedNextAction, {
    changedLimits: ['maxValueRows'],
    completeFunctions: 2,
    completeTools: 2,
    limits: { maxNodeRows: 16, maxPropertyRows: 30, maxValueRows: 388 },
    totalDelta: 234,
    witnesses: [
      'examples/capstone-checker-subset/checker-while.kern#2:checkerSafeIntText',
      'examples/kern-canonicalizer/canonicalizer.kern#1:validbinaryop',
    ],
  });
  assert.equal(
    formatM442ResidualAnalysisStatus(actual.selectedNextAction),
    'M4.42 published analysis selected 2 functions by maxValueRows widening.',
  );

  const checkedIn = JSON.parse(readFileSync(summaryUrl, 'utf8'));
  assert.deepEqual(actual, checkedIn);
  assertCoverageSummary(summaryUrl, actual);
  assert.deepEqual(validatePublishedCanonicalizerResidualAnalysisM442(checkedIn).record, checkedIn);
});

test('M4.43 reauthenticates the published 388-row action against the live optimized frontier', () => {
  const current = measureCurrentCanonicalizerResidualAnalysis();
  const liveCoverage = JSON.parse(readFileSync(new URL('./coverage-summary.json', import.meta.url), 'utf8'));
  assert.deepEqual(current.baseline, {
    baseCompleteFunctions: 57,
    baseId: 'kern.kir-canonicalizer.profile.m4.36',
    coverageImplementationDigest: liveCoverage.coverageImplementationDigest,
    coveragePolicyDigest: '6c70a49fc5b8fabbefb902c3323534302448281fa998691598efd6a6d83fff6b',
    currentProfileLimits: {
      maxNodeRows: 16,
      maxPropertyRows: 30,
      maxValueRows: 154,
    },
    functionFactsDigest: '75ec5a9f2ce7c3b6a7c42b212ecbced4a4ecb9becb80766c2f04280eb05d4287',
    legacyParameterBlockers: 45,
    residualFunctionCount: 45,
  });
  assert.equal(
    current.assignmentsDigest,
    'fb73e3bfba455094fd188454de81c56e0a1ff8011bc3ec70eea2f02160537092',
  );
  assert.deepEqual(current.selectedNextAction, publishedRecord().selectedNextAction);
});

test('M4.42 published digest rejects any assignment, candidate, ranking, or baseline drift', () => {
  const actual = publishedRecord();
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.2'; },
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
      () => validatePublishedCanonicalizerResidualAnalysisM442(copy),
      /coverage M4\.42 residual analysis rejection/u,
    );
  }
});

test('M4.42 analysis rejects decorated objects before comparing receipt data', () => {
  const actual = publishedRecord();
  const toJsonSpoof = { future: true, toJSON: () => actual };
  assert.equal(JSON.stringify(toJsonSpoof), JSON.stringify(actual));
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM442(toJsonSpoof),
    /coverage M4\.42 residual analysis rejection/u,
  );

  const accessorSpoof = structuredClone(actual);
  Object.defineProperty(accessorSpoof, 'format', {
    enumerable: true,
    get: () => actual.format,
  });
  assert.equal(JSON.stringify(accessorSpoof), JSON.stringify(actual));
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM442(accessorSpoof),
    /coverage M4\.42 residual analysis rejection/u,
  );

  const customPrototype = Object.assign(Object.create({ inherited: true }), actual);
  const symbolSpoof = structuredClone(actual);
  symbolSpoof[Symbol('hidden')] = true;
  const sparseSpoof = structuredClone(actual);
  sparseSpoof.assignments.length += 1;
  for (const value of [customPrototype, symbolSpoof, sparseSpoof]) {
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM442(value),
      /coverage M4\.42 residual analysis rejection/u,
    );
  }
});

test('M4.42 preserves M4.31 and M4.38 and reproduces in a fresh process', () => {
  assert.equal(
    loadCanonicalizerResidualAnalysisHandoff().digest,
    '160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076',
  );
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM438().digest,
    '8bc1be3c941c8fd2d8a4a5990de0266f54ae986fbfd1e4712e6044c78cc092cd',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM442 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-42.mjs'; process.stdout.write(JSON.stringify(load().record))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), publishedRecord());
});
