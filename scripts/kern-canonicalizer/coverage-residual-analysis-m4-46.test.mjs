import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM443 } from './coverage-residual-analysis-m4-43.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM446,
  validatePublishedCanonicalizerResidualAnalysisM446,
} from './coverage-residual-analysis-m4-46.mjs';

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

test('M4.46 freezes the exact published 19-row node frontier before headroom evidence', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM446();
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    '67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402',
  );
  assert.equal(handoff.digest, '67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402');
  assert.equal(handoff.sourceCommit, '77ba01b467b411def9343ffb3c064e1650e6fced');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 60,
    baseId: 'kern.kir-canonicalizer.profile.m4.36',
    coverageImplementationDigest: '9ba952686c10c0210810f428fbbfabdd4d8612825e0047a8add9d2425466021e',
    coveragePolicyDigest: 'f326deb064b3e787cd24d1adfb12066db2c6206b93ac3bdebbcfbeb196e93096',
    currentProfileLimits: { maxNodeRows: 16, maxPropertyRows: 30, maxValueRows: 388 },
    functionFactsDigest: 'b6adf472db5ae14b3ad4735d20a3ed3c4b6d5425295af2904c4136d441399d50',
    legacyParameterBlockers: 43,
    residualFunctionCount: 43,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    'f72e98d37cd3fcbc711c53bc6dfd8c4afe0ea56a08c21b3907a550a17fa0418c',
  );
  assert.equal(handoff.record.assignments.length, 43);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 26);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 27);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    handoff.record.assignments
      .filter(({ id }) => EXPECTED_SELECTION.witnesses.includes(id))
      .reduce((total, { parameterRows }) => total + parameterRows, 0),
    12,
  );
});

test('M4.46 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM446().record;
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.selectedNextAction.limits.maxNodeRows = 20; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM446(copy),
      /coverage M4\.46 residual analysis rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM446(decorated),
    /coverage M4\.46 residual analysis rejection/u,
  );
});

test('M4.46 preserves prior history and loads byte-identically in a fresh process', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM443().digest,
    '823e464ea6b6cc78a6959c0bced2b6d5f63b5722e0e15bda4a2dd08abf8200d8',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM446 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-46.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM446());
});
