import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPublishedCanonicalizerResidualAnalysisM4125,
} from './coverage-residual-analysis-m4-125.mjs';
import { assertM4132ResidualAnalysis } from './coverage-m4-132-central.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM4132,
  measureCanonicalizerResidualAnalysisM4132,
  validatePublishedCanonicalizerResidualAnalysisM4132,
} from './coverage-residual-analysis-m4-132.mjs';
import { formatM4132ResidualAnalysisStatus } from './coverage-status-m4-132.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-132.json', import.meta.url);
const PUBLISHED_DIGEST = '1f260e985d3fd8990a387da07144eca4f59c22a3133407b6c408e26e597b521e';
const EXPECTED_ASSIGNMENTS = [
  {
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
    parameterRows: 2,
    profileRows: { nodes: 54, properties: 82, values: 932 },
    reasons: [
      'if.properties.cond.expression.text.character-u007f',
      'if.properties.cond.expression.text.character-u0080',
      'if.properties.cond.expression.text.character-u009f',
      'if.properties.cond.expression.text.character-u2028',
      'if.properties.cond.expression.text.character-u2029',
      'if.properties.cond.expression.text.character-ufeff',
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
];

test('M4.132 freezes the exact published M4.131 residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4132();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, 'a92fb14e79cd40fcab8f1c071a2561149028021a');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 104,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: '24031730884107b423320d133f330481571a3de3aa1bc50cd6d88766e10f8fc3',
    coveragePolicyDigest: '254f089ec5d7c0162144aaf78114d33ed603c5cca04ae484f53111c7a83e5d9c',
    currentProfileLimits: {
      maxNodeRows: 202,
      maxPropertyRows: 308,
      maxValueRows: 4493,
    },
    functionFactsDigest: '7cebc6f79375a89e54648e76467e7d66b5dcc90ff7af789bbe2dfb57d6535f42',
    legacyParameterBlockers: 3,
    residualFunctionCount: 3,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    'a3383dd12d41a3beaca9bf9c0de49ddadc9333c99ca7b14162e0a01ebdb0d338',
  );
  assert.deepEqual(handoff.record.assignments, EXPECTED_ASSIGNMENTS);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 1);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 0);
  assert.deepEqual(handoff.record.frontier.actionableCandidates, []);
  assert.equal(handoff.record.selectedNextAction, null);
  assert.equal(
    formatM4132ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.132 published analysis found no actionable profile widening across the three-function ' +
      'residual frontier; M4.133 investigates projection and canonical-surface blockers.',
  );
  assert.deepEqual(measureCanonicalizerResidualAnalysisM4132(), handoff.record);
  assert.equal(
    assertM4132ResidualAnalysis(),
    'M4.132 published analysis found no actionable profile widening across the three-function ' +
      'residual frontier; M4.133 investigates projection and canonical-surface blockers.',
  );
});

test('M4.132 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM4132().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.profileRowsAvailableFunctions = 0; },
    (copy) => { copy.frontier.actionableCandidates = [{}]; },
    (copy) => { copy.baseline.currentProfileLimits.maxNodeRows = 203; },
    (copy) => { copy.selectedNextAction = {}; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM4132(copy),
      /coverage M4\.132 residual analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4132(decorated),
    /coverage M4\.132 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.frontier.actionableCandidates.push(shared.assignments);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4132(shared),
    /coverage M4\.132 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4132(cyclic),
    /coverage M4\.132 residual analysis rejection/u,
  );
});

test('M4.132 preserves the immutable M4.125 analysis', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM4125().digest,
    'eb2b075097025b9f91089a0587e84807279061801850b10402dd0978a2fe9652',
  );
});

test('M4.132 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM4132 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-132.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM4132());
});
