import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPublishedCanonicalizerResidualAnalysisM4120,
} from './coverage-residual-analysis-m4-120.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM4125,
  measureCanonicalizerResidualAnalysisM4125,
  validatePublishedCanonicalizerResidualAnalysisM4125,
} from './coverage-residual-analysis-m4-125.mjs';
import { formatM4125ResidualAnalysisStatus } from './coverage-status-m4-125.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-125.json', import.meta.url);
const PUBLISHED_DIGEST = 'eb2b075097025b9f91089a0587e84807279061801850b10402dd0978a2fe9652';
const EXPECTED_ASSIGNMENTS = [
  {
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
    parameterRows: 2,
    profileRows: null,
    reasons: [
      'if.properties.cond.expression.text.character-u007f',
      'if.properties.cond.expression.text.character-u0080',
      'if.properties.cond.expression.text.character-u009f',
      'if.properties.cond.expression.text.character-u2028',
      'if.properties.cond.expression.text.character-u2029',
      'if.properties.cond.expression.text.character-ufeff',
      'projection.limit-depth',
    ],
    tool: 'canonicalizer',
  },
  {
    id: 'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
    parameterRows: 6,
    profileRows: null,
    reasons: ['let.value:unknown-expression-kind', 'projection.unknown-expression-kind'],
    tool: 'canonicalizer',
  },
  {
    id: 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
    parameterRows: 15,
    profileRows: null,
    reasons: ['projection.unknown-expression-kind', 'throw.value:unknown-expression-kind'],
    tool: 'canonicalizer',
  },
  {
    id: 'examples/selfhost-validator/validator.kern#20:validate',
    parameterRows: 41,
    profileRows: null,
    reasons: ['projection.limit-nodes'],
    tool: 'validator',
  },
];

test('M4.125 freezes the exact published M4.124 residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4125();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, 'b2a722f43092ed16eeff45600dd8638fc53d4e05');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 103,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: '0c3186a44ce2ed3cf2a18e6790b23084bd0e5c9adafc229d4bac768fe16d35eb',
    coveragePolicyDigest: '04a61b18126cac0ddd723fef2686ae2f77c0bba6501c11dee6756fc3c0b0d400',
    currentProfileLimits: { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2411 },
    functionFactsDigest: '21869d80d31dbda6ddd60796bb479bb30e42985f52f2e1079efc28b81c467df5',
    legacyParameterBlockers: 4,
    residualFunctionCount: 4,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    'd56df2cc197c26f4c6f302c32e6447828e1e7359ba6f525f82bda5b6e2b5c481',
  );
  assert.deepEqual(handoff.record.assignments, EXPECTED_ASSIGNMENTS);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 0);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 0);
  assert.deepEqual(handoff.record.frontier.actionableCandidates, []);
  assert.equal(handoff.record.selectedNextAction, null);
  assert.equal(
    formatM4125ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.125 published analysis found no actionable profile widening across the four-function ' +
      'residual frontier; M4.126 investigates projection and canonical-surface blockers.',
  );
  assert.deepEqual(measureCanonicalizerResidualAnalysisM4125(), handoff.record);
});

test('M4.125 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM4125().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates = [{}]; },
    (copy) => { copy.baseline.currentProfileLimits.maxNodeRows = 123; },
    (copy) => { copy.selectedNextAction = {}; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM4125(copy),
      /coverage M4\.125 residual analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4125(decorated),
    /coverage M4\.125 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.frontier.actionableCandidates.push(shared.assignments);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4125(shared),
    /coverage M4\.125 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4125(cyclic),
    /coverage M4\.125 residual analysis rejection/u,
  );
});

test('M4.125 preserves the immutable M4.120 analysis', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM4120().digest,
    '02789e8cc4f0fff5da641942cf1716e5fdc6c71975170afd82524fccef487bc5',
  );
});

test('M4.125 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM4125 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-125.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM4125());
});
