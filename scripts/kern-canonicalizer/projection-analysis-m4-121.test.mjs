import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM4120 } from './coverage-residual-analysis-m4-120.mjs';
import { formatM4121ProjectionAnalysisStatus } from './coverage-status.mjs';
import {
  loadPublishedCanonicalizerProjectionAnalysisM4121,
  measureCanonicalizerProjectionAnalysisM4121,
  validatePublishedCanonicalizerProjectionAnalysisM4121,
} from './projection-analysis-m4-121.mjs';

const summaryUrl = new URL('./projection-analysis-m4-121.json', import.meta.url);
const PUBLISHED_DIGEST = '2579208ec9759c7c31fc76d64dbbe4f09ac9852801506584e78450742a40f1b1';
const SELECTED_WITNESSES = [
  'examples/capstone-checker-subset/checker.kern#2:rejectLine',
];

test('M4.121 freezes exact projection requirements and the ranked depth candidate', () => {
  const source = readFileSync(summaryUrl);
  const measured = measureCanonicalizerProjectionAnalysisM4121();
  const handoff = loadPublishedCanonicalizerProjectionAnalysisM4121();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '195e3fbadc48146c520a5cbcfcbb1b3567db2717');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.projection-analysis.1');
  assert.equal(
    handoff.record.input.residualAnalysisDigest,
    '02789e8cc4f0fff5da641942cf1716e5fdc6c71975170afd82524fccef487bc5',
  );
  assert.deepEqual(measured, handoff.record);
  assert.equal(handoff.record.requirements.length, 5);
  assert.equal(handoff.record.summary.observedSettings, 3);
  assert.equal(handoff.record.summary.projectedFunctions, 3);
  assert.equal(handoff.record.summary.unsupportedFunctions, 2);
  assert.deepEqual(
    handoff.record.requirements.find(({ id }) => id.endsWith('#2:rejectLine')),
    {
      id: 'examples/capstone-checker-subset/checker.kern#2:rejectLine',
      outcome: 'projected',
      parameterRows: 5,
      profileRows: { nodes: 8, properties: 15, values: 106 },
      requiredKirLimits: { maxDepth: 77 },
      tool: 'checker',
    },
  );
  assert.deepEqual(
    handoff.record.requirements.find(({ id }) => id.endsWith('#5:quotesource')),
    {
      id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
      outcome: 'projected',
      parameterRows: 2,
      profileRows: { nodes: 54, properties: 82, values: 932 },
      requiredKirLimits: { maxDepth: 93 },
      tool: 'canonicalizer',
    },
  );
  assert.deepEqual(
    handoff.record.requirements.find(({ id }) => id.endsWith('#20:validate')),
    {
      id: 'examples/selfhost-validator/validator.kern#20:validate',
      outcome: 'projected',
      parameterRows: 41,
      profileRows: { nodes: 202, properties: 308, values: 4493 },
      requiredKirLimits: { maxBytes: 273051, maxDepth: 98, maxNodes: 5313 },
      tool: 'validator',
    },
  );
  assert.deepEqual(
    handoff.record.requirements
      .filter(({ outcome }) => outcome === 'unsupported')
      .map(({ id, projectionCode }) => ({ id, projectionCode })),
    [
      {
        id: 'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
        projectionCode: 'unknown-expression-kind',
      },
      {
        id: 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
        projectionCode: 'unknown-expression-kind',
      },
    ],
  );
  assert.equal(handoff.record.candidates.length, 3);
  assert.deepEqual(handoff.record.selectedNextAction, {
    changedLimits: ['maxDepth'],
    completeFunctions: 1,
    completeTools: 1,
    kirLimits: { maxBytes: 262144, maxDepth: 77, maxNodes: 4096 },
    migratedParameterRows: 5,
    totalDelta: 1,
    witnesses: SELECTED_WITNESSES,
  });
  assert.equal(
    formatM4121ProjectionAnalysisStatus(handoff.record.selectedNextAction),
    'M4.121 projection analysis selects maxDepth 77 for 1 function/5 rows across 1 tool; ' +
      'M4.122 authenticates structural KIR and runtime-envelope safety.',
  );
});

test('M4.121 receipt rejects mutation, decoration, sharing, and cycles', () => {
  const published = loadPublishedCanonicalizerProjectionAnalysisM4121().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.projection-analysis.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.requirements.pop(); },
    (copy) => { copy.requirements[0].requiredKirLimits.maxDepth += 1; },
    (copy) => { copy.candidates.reverse(); },
    (copy) => { copy.selectedNextAction.kirLimits.maxDepth = 78; },
    (copy) => { copy.summary.projectedFunctions = 2; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerProjectionAnalysisM4121(copy),
      /coverage M4\.121 projection analysis rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4121(decorated),
    /coverage M4\.121 projection analysis rejection/u,
  );
  const shared = structuredClone(published);
  shared.selectedNextAction = shared.candidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4121(shared),
    /coverage M4\.121 projection analysis rejection/u,
  );
  const cyclic = structuredClone(published);
  cyclic.input.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4121(cyclic),
    /coverage M4\.121 projection analysis rejection/u,
  );
});

test('M4.121 preserves the immutable M4.120 residual input', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM4120().digest,
    '02789e8cc4f0fff5da641942cf1716e5fdc6c71975170afd82524fccef487bc5',
  );
});

test('M4.121 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerProjectionAnalysisM4121 as load} from './scripts/kern-canonicalizer/projection-analysis-m4-121.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerProjectionAnalysisM4121());
});
