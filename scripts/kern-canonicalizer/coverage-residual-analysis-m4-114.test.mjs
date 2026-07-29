import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM4109 } from './coverage-residual-analysis-m4-109.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM4114,
  measureCanonicalizerResidualAnalysisM4114,
  validatePublishedCanonicalizerResidualAnalysisM4114,
} from './coverage-residual-analysis-m4-114.mjs';
import { formatM4114ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-114.json', import.meta.url);
const PUBLISHED_DIGEST = '23fd8f52fa70e2a72fb4b4b1b7ae4c477b369a5f46853691b86b7506a9717e0c';
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2411 },
  totalDelta: 412,
  witnesses: [
    'examples/capstone-checker-subset/checker.kern#24:checkModule',
  ],
};
const EXPECTED_ASSIGNMENTS = [
  {
    id: 'examples/capstone-checker-subset/checker.kern#24:checkModule',
    parameterRows: 58,
    profileRows: { nodes: 122, properties: 193, values: 2411 },
    reasons: ['profile.rows.nodes', 'profile.rows.properties', 'profile.rows.values'],
    tool: 'checker',
  },
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

test('M4.114 freezes the exact published M4.113 residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4114();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '2cb03f0e84f6c586dd28404d331a67dd2bb839bb');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 101,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: '0a89966bad66ff789b92229da6c234a50e89cc056c34d01997663178f6f24e8b',
    coveragePolicyDigest: '4c75933f4505db9f7bf73daa8a633517e4719ba4c60b15b3dadc59083ef3a4f7',
    currentProfileLimits: { maxNodeRows: 89, maxPropertyRows: 125, maxValueRows: 2100 },
    functionFactsDigest: '61111421f4b723dd3428a11c3ba2259387632fd0ab0d2c4d39491f969ae4c452',
    legacyParameterBlockers: 6,
    residualFunctionCount: 6,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    '7922f23766d95c5492800a9ae2b5f66217027a0214e716a0f6c96efb1c6ebb55',
  );
  assert.deepEqual(handoff.record.assignments, EXPECTED_ASSIGNMENTS);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 1);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 1);
  assert.deepEqual(handoff.record.frontier.actionableCandidates, [EXPECTED_SELECTION]);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    formatM4114ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.114 published analysis selected 1 function by ' +
      'maxNodeRows+maxPropertyRows+maxValueRows widening; ' +
      'M4.115 authenticates structural runtime headroom.',
  );
});

test('M4.114 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM4114().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates = []; },
    (copy) => { copy.baseline.currentProfileLimits.maxNodeRows = 90; },
    (copy) => { copy.selectedNextAction.limits.maxValueRows = 2412; },
    (copy) => { copy.selectedNextAction.witnesses.pop(); },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM4114(copy),
      /coverage M4\.114 residual analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4114(decorated),
    /coverage M4\.114 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.selectedNextAction = shared.frontier.actionableCandidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4114(shared),
    /coverage M4\.114 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.selectedNextAction.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4114(cyclic),
    /coverage M4\.114 residual analysis rejection/u,
  );
});

test('M4.114 reproduces live facts and preserves exact M4.109 history', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM4109().digest,
    'ad6240c77ed276d1f865beb702ceeb7c85767191dbaa3cf36f526505c4e555fb',
  );
  assert.deepEqual(
    measureCanonicalizerResidualAnalysisM4114(),
    loadPublishedCanonicalizerResidualAnalysisM4114().record,
  );
});

test('M4.114 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM4114 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-114.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM4114());
});
