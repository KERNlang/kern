import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadCanonicalizerResidualAnalysisHandoff,
  validateCanonicalizerResidualAnalysisHandoff,
} from './coverage-residual-analysis.mjs';

const summaryUrl = new URL('./coverage-residual-analysis.json', import.meta.url);

test('M4.31 residual analysis is an exact immutable historical handoff', () => {
  const checkedIn = JSON.parse(readFileSync(summaryUrl, 'utf8'));
  const handoff = loadCanonicalizerResidualAnalysisHandoff();
  assert.equal(handoff.sourceCommit, 'fdf55cfb52616ef9bdf006a42f6a58a56a10b7c1');
  assert.equal(handoff.digest, '160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076');
  assert.deepEqual(handoff.record, checkedIn);
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.1');
  assert.equal(handoff.record.assignments.length, 69);
  assert.equal(
    handoff.record.assignmentsDigest,
    '7cd89ffda2d591cf9a82fa0f836d5b7f095887a33a9b4c843a117a0ab6734c1c',
  );
  assert.deepEqual(handoff.record.baseline.currentProfileLimits, {
    maxNodeRows: 16,
    maxPropertyRows: 30,
    maxValueRows: 72,
  });
  assert.deepEqual(handoff.record.selectedNextAction, {
    changedLimits: ['maxValueRows'],
    completeFunctions: 12,
    completeTools: 4,
    limits: { maxNodeRows: 16, maxPropertyRows: 30, maxValueRows: 106 },
    totalDelta: 34,
    witnesses: [
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
    ],
  });
  assert.deepEqual(validateCanonicalizerResidualAnalysisHandoff(checkedIn), handoff);
});

test('M4.31 handoff rejects assignment, frontier, selection, and baseline drift', () => {
  const actual = loadCanonicalizerResidualAnalysisHandoff().record;
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignmentsDigest = '0'.repeat(64); },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.assignments.reverse(); },
    (copy) => { copy.assignments[0].id = copy.assignments[1].id; },
    (copy) => { copy.assignments[0].tool = 'invented'; },
    (copy) => { copy.assignments[0].reasons.pop(); },
    (copy) => { copy.assignments[2].profileRows.values += 1; },
    (copy) => { copy.baseline.baseId = 'future'; },
    (copy) => { copy.baseline.coverageImplementationDigest = '0'.repeat(64); },
    (copy) => { copy.baseline.currentProfileLimits.maxValueRows += 1; },
    (copy) => { copy.frontier.evaluatedObservedSettings -= 1; },
    (copy) => { copy.frontier.actionableCandidates.reverse(); },
    (copy) => { copy.frontier.actionableCandidates[0].changedLimits = ['maxNodeRows']; },
    (copy) => { copy.frontier.actionableCandidates[0].limits.maxValueRows -= 1; },
    (copy) => { copy.frontier.actionableCandidates[0].totalDelta -= 1; },
    (copy) => { copy.frontier.actionableCandidates[0].witnesses.pop(); },
    (copy) => { copy.selectedNextAction = null; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerResidualAnalysisHandoff(copy),
      /coverage residual analysis handoff rejection/u,
    );
  }
});

test('M4.31 historical handoff loads byte-identically in a fresh process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadCanonicalizerResidualAnalysisHandoff as load} from './scripts/kern-canonicalizer/coverage-residual-analysis.mjs'; const h=load(); process.stdout.write(JSON.stringify({digest:h.digest,record:h.record,sourceCommit:h.sourceCommit}))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadCanonicalizerResidualAnalysisHandoff());
});
