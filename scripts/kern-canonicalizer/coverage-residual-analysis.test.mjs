import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  measureCanonicalizerResidualAnalysis,
  validateCanonicalizerResidualAnalysis,
} from './coverage-residual-analysis.mjs';
import { assertCoverageSummary } from './coverage-summary-writer.mjs';

const summaryUrl = new URL('./coverage-residual-analysis.json', import.meta.url);

test('M4.31 publishes exact residual assignments and a measured profile frontier', () => {
  const actual = measureCanonicalizerResidualAnalysis();
  assert.equal(actual.format, 'kern.kir-canonicalizer.residual-analysis.1');
  assert.equal(actual.baseline.baseId, 'kern.kir-canonicalizer.profile.m4.29');
  assert.equal(actual.baseline.baseCompleteFunctions, 33);
  assert.equal(actual.baseline.legacyParameterBlockers, 69);
  assert.equal(actual.baseline.residualFunctionCount, 69);
  assert.deepEqual(actual.baseline.currentProfileLimits, {
    maxNodeRows: 16,
    maxPropertyRows: 30,
    maxValueRows: 72,
  });
  assert.equal(
    actual.assignmentsDigest,
    '7cd89ffda2d591cf9a82fa0f836d5b7f095887a33a9b4c843a117a0ab6734c1c',
  );
  assert.equal(actual.assignments.length, 69);
  assert.equal(new Set(actual.assignments.map(({ id }) => id)).size, 69);
  assert.ok(actual.assignments.every(({ reasons }) => reasons.length > 0));
  assert.ok(actual.frontier.evaluatedObservedSettings > 0);
  assert.equal(actual.frontier.evaluatedObservedSettings, 50);
  assert.equal(actual.frontier.profileRowsAvailableFunctions, 53);
  assert.equal(actual.frontier.actionableCandidates.length, 50);
  assert.deepEqual(actual.selectedNextAction, actual.frontier.actionableCandidates[0]);
  assert.deepEqual({
    changedLimits: actual.selectedNextAction.changedLimits,
    completeFunctions: actual.selectedNextAction.completeFunctions,
    completeTools: actual.selectedNextAction.completeTools,
    limits: actual.selectedNextAction.limits,
    totalDelta: actual.selectedNextAction.totalDelta,
  }, {
    changedLimits: ['maxValueRows'],
    completeFunctions: 12,
    completeTools: 4,
    limits: { maxNodeRows: 16, maxPropertyRows: 30, maxValueRows: 106 },
    totalDelta: 34,
  });
  assert.deepEqual(actual.selectedNextAction.witnesses, [
    'examples/capstone-assertion-engine/compare.kern#5:compareTrees',
    'examples/capstone-checker-subset/checker-while.kern#3:previousSiblingKind',
    'examples/capstone-checker-subset/checker-while.kern#7:functionRow',
    'examples/capstone-checker-subset/checker.kern#10:isForCounter',
    'examples/capstone-checker-subset/checker.kern#11:isAssigned',
    'examples/capstone-checker-subset/checker.kern#13:paramOrdinalOf',
    'examples/capstone-checker-subset/checker.kern#15:argIndexOf',
    'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#0:validfirst',
    'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#6:structuralname',
    'examples/selfhost-validator/validator.kern#0:charokfirst',
    'examples/selfhost-validator/validator.kern#16:classrow',
    'examples/selfhost-validator/validator.kern#8:contained',
  ]);
  const checkedIn = JSON.parse(readFileSync(summaryUrl, 'utf8'));
  assert.deepEqual(actual, checkedIn);
  assertCoverageSummary(summaryUrl, actual);
  assert.deepEqual(validateCanonicalizerResidualAnalysis(checkedIn), checkedIn);
});

test('residual analysis rejects assignment, candidate, ranking, and baseline drift', () => {
  const actual = measureCanonicalizerResidualAnalysis();
  const mutations = [
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments[0].reasons.pop(); },
    (copy) => { copy.baseline.coverageImplementationDigest = '0'.repeat(64); },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.frontier.actionableCandidates[0].limits.maxValueRows -= 1; },
    (copy) => { copy.frontier.actionableCandidates[0].witnesses.pop(); },
    (copy) => { copy.selectedNextAction = null; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerResidualAnalysis(copy),
      /coverage residual analysis rejection/u,
    );
  }
});

test('residual analysis reproduces byte-identically in a fresh process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {measureCanonicalizerResidualAnalysis} from './scripts/kern-canonicalizer/coverage-residual-analysis.mjs'; process.stdout.write(JSON.stringify(measureCanonicalizerResidualAnalysis()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), measureCanonicalizerResidualAnalysis());
});
