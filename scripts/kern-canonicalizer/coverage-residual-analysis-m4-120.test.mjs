import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM4114 } from './coverage-residual-analysis-m4-114.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM4120,
  measureCanonicalizerResidualAnalysisM4120,
  validatePublishedCanonicalizerResidualAnalysisM4120,
} from './coverage-residual-analysis-m4-120.mjs';
import { formatM4120ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-120.json', import.meta.url);
const PUBLISHED_DIGEST = '02789e8cc4f0fff5da641942cf1716e5fdc6c71975170afd82524fccef487bc5';
const EXPECTED_ASSIGNMENTS = [
  {
    id: 'examples/capstone-checker-subset/checker.kern#2:rejectLine',
    parameterRows: 5,
    profileRows: null,
    reasons: ['projection.limit-depth'],
    tool: 'checker',
  },
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

test('M4.120 freezes the exact published M4.119 residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4120();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '2ffe06f0c31e7b6cbdea62f47df97f5a94b66dad');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 102,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: 'b99cc57c7ec9cc55da813e818b60688685fe86b4ae79753fa3b457aa25b61686',
    coveragePolicyDigest: 'bb64551fcdbacd85759a86f9cd7703ffe7fa14505cfe1a935223d7fe2b953534',
    currentProfileLimits: { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2411 },
    functionFactsDigest: '5f9f2e022f5fd23e8ebdde4523de7a538a49d2d105d2fd04807cd84f99d58906',
    legacyParameterBlockers: 5,
    residualFunctionCount: 5,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    '7590a3a7dbc3bbd11ca4a05c81e52a907d8cdd5619e4b2a78e198975673c84fe',
  );
  assert.deepEqual(handoff.record.assignments, EXPECTED_ASSIGNMENTS);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 0);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 0);
  assert.deepEqual(handoff.record.frontier.actionableCandidates, []);
  assert.equal(handoff.record.selectedNextAction, null);
  assert.equal(
    formatM4120ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.120 published analysis found no actionable profile widening across the five-function ' +
      'residual frontier; M4.121 investigates projection and canonical-surface blockers.',
  );
  assert.deepEqual(measureCanonicalizerResidualAnalysisM4120(), handoff.record);
});

test('M4.120 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM4120().record;
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
      () => validatePublishedCanonicalizerResidualAnalysisM4120(copy),
      /coverage M4\.120 residual analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4120(decorated),
    /coverage M4\.120 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.frontier.actionableCandidates.push(shared.assignments);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4120(shared),
    /coverage M4\.120 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4120(cyclic),
    /coverage M4\.120 residual analysis rejection/u,
  );
});

test('M4.120 preserves the immutable M4.114 analysis', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM4114().digest,
    '23fd8f52fa70e2a72fb4b4b1b7ae4c477b369a5f46853691b86b7506a9717e0c',
  );
});

test('M4.120 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM4120 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-120.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM4120());
});
