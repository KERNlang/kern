import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPublishedCanonicalizerResidualAnalysisM4132,
} from './coverage-residual-analysis-m4-132.mjs';
import { assertM4133ProjectionAnalysis } from './coverage-m4-133-central.mjs';
import {
  loadPublishedCanonicalizerProjectionAnalysisM4133,
  measureCanonicalizerProjectionAnalysisM4133,
  validatePublishedCanonicalizerProjectionAnalysisM4133,
} from './projection-analysis-m4-133.mjs';

const summaryUrl = new URL('./projection-analysis-m4-133.json', import.meta.url);
const PUBLISHED_DIGEST = '89da63518b22003642eabba46177dce3e835d2fde82aebfb4ebe10bd3273bf0a';
const EXPECTED_REQUIREMENTS = [
  {
    canonicalSurfaceBlockers: [
      'if.properties.cond.expression.text.character-u007f',
      'if.properties.cond.expression.text.character-u0080',
      'if.properties.cond.expression.text.character-u009f',
      'if.properties.cond.expression.text.character-u2028',
      'if.properties.cond.expression.text.character-u2029',
      'if.properties.cond.expression.text.character-ufeff',
    ],
    id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
    outcome: 'projected',
    parameterRows: 2,
    profileRows: { nodes: 54, properties: 82, values: 932 },
    requiredKirLimits: {},
    requiredProfileLimits: {},
    tool: 'canonicalizer',
  },
  {
    id: 'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
    outcome: 'unsupported',
    parameterRows: 6,
    projectionCode: 'unknown-expression-kind',
    sourceBlockers: ['let.value:unknown-expression-kind'],
    tool: 'canonicalizer',
  },
  {
    id: 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
    outcome: 'unsupported',
    parameterRows: 15,
    projectionCode: 'unknown-expression-kind',
    sourceBlockers: ['throw.value:unknown-expression-kind'],
    tool: 'canonicalizer',
  },
];

test('M4.133 freezes the exact three-function projection frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerProjectionAnalysisM4133();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '0899f689fbe1b91471d89b380447f3bcf27dd3a0');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.projection-analysis.1');
  assert.deepEqual(handoff.record.input, {
    assignmentDigest: 'a3383dd12d41a3beaca9bf9c0de49ddadc9333c99ca7b14162e0a01ebdb0d338',
    baseKirLimits: { maxBytes: 273_051, maxDepth: 98, maxNodes: 5_313 },
    profileLimits: { maxNodeRows: 202, maxPropertyRows: 308, maxValueRows: 4_493 },
    residualAnalysisDigest: '1f260e985d3fd8990a387da07144eca4f59c22a3133407b6c408e26e597b521e',
    residualFunctions: 3,
  });
  assert.deepEqual(handoff.record.requirements, EXPECTED_REQUIREMENTS);
  assert.deepEqual(handoff.record.summary, {
    canonicalSurfaceFunctions: 1,
    observedSettings: 0,
    projectedFunctions: 1,
    unsupportedFunctions: 2,
  });
  assert.deepEqual(handoff.record.candidates, []);
  assert.equal(handoff.record.selectedNextAction, null);
  assert.deepEqual(measureCanonicalizerProjectionAnalysisM4133(), handoff.record);
  assert.equal(
    assertM4133ProjectionAnalysis(),
    'M4.133 projection analysis finds no actionable KIR/profile candidate: quotesource is ' +
      'canonical-surface-blocked and 2 functions remain unknown-expression-kind; M4.134 ' +
      'investigates source/canonical-surface and expression-support remediation.',
  );
});

test('M4.133 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerProjectionAnalysisM4133().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.projection-analysis.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.requirements.pop(); },
    (copy) => { copy.summary.observedSettings = 1; },
    (copy) => { copy.candidates.push({}); },
    (copy) => { copy.input.baseKirLimits.maxBytes += 1; },
    (copy) => { copy.selectedNextAction = {}; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerProjectionAnalysisM4133(copy),
      /coverage M4\.133 projection analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4133(decorated),
    /coverage M4\.133 projection analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.candidates.push(shared.requirements);
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4133(shared),
    /coverage M4\.133 projection analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4133(cyclic),
    /coverage M4\.133 projection analysis rejection/u,
  );
});

test('M4.133 preserves the immutable M4.132 analysis', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM4132().digest,
    '1f260e985d3fd8990a387da07144eca4f59c22a3133407b6c408e26e597b521e',
  );
});

test('M4.133 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerProjectionAnalysisM4133 as load} from './scripts/kern-canonicalizer/projection-analysis-m4-133.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerProjectionAnalysisM4133());
});
