import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadPublishedCanonicalizerResidualAnalysisM4125,
} from './coverage-residual-analysis-m4-125.mjs';
import {
  loadPublishedCanonicalizerProjectionAnalysisM4126,
  measureCanonicalizerProjectionAnalysisM4126,
  validatePublishedCanonicalizerProjectionAnalysisM4126,
} from './projection-analysis-m4-126.mjs';
import { formatM4126ProjectionAnalysisStatus } from './coverage-status-m4-126.mjs';

const summaryUrl = new URL('./projection-analysis-m4-126.json', import.meta.url);
const PUBLISHED_DIGEST = '25f1ba6ed40efdff909a6c95a11c385c12f9eba2b0025375ed4943f14393e369';
const VALIDATE_ID = 'examples/selfhost-validator/validator.kern#20:validate';

test('M4.126 freezes exact projection requirements and the ranked validate candidate', () => {
  const source = readFileSync(summaryUrl);
  const measured = measureCanonicalizerProjectionAnalysisM4126();
  const handoff = loadPublishedCanonicalizerProjectionAnalysisM4126();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '9b5a5dc7c64a257356c412b6e1d98d85404d538b');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.projection-analysis.1');
  assert.deepEqual(measured, handoff.record);
  assert.deepEqual(handoff.record.input, {
    assignmentDigest: 'd56df2cc197c26f4c6f302c32e6447828e1e7359ba6f525f82bda5b6e2b5c481',
    baseKirLimits: { maxBytes: 262_144, maxDepth: 77, maxNodes: 4_096 },
    profileLimits: { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2_411 },
    residualAnalysisDigest: 'eb2b075097025b9f91089a0587e84807279061801850b10402dd0978a2fe9652',
    residualFunctions: 4,
  });
  assert.deepEqual(handoff.record.summary, {
    observedSettings: 2,
    projectedFunctions: 2,
    unsupportedFunctions: 2,
  });
  assert.deepEqual(
    handoff.record.requirements.find(({ id }) => id.endsWith('#5:quotesource')),
    {
      id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
      outcome: 'projected',
      parameterRows: 2,
      profileRows: { nodes: 54, properties: 82, values: 932 },
      requiredKirLimits: { maxDepth: 93 },
      requiredProfileLimits: {},
      tool: 'canonicalizer',
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
  assert.deepEqual(
    handoff.record.requirements.find(({ id }) => id === VALIDATE_ID),
    {
      id: VALIDATE_ID,
      outcome: 'projected',
      parameterRows: 41,
      profileRows: { nodes: 202, properties: 308, values: 4_493 },
      requiredKirLimits: { maxBytes: 273_051, maxDepth: 98, maxNodes: 5_313 },
      requiredProfileLimits: {
        maxNodeRows: 202,
        maxPropertyRows: 308,
        maxValueRows: 4_493,
      },
      tool: 'validator',
    },
  );
  assert.equal(handoff.record.candidates.length, 1);
  assert.deepEqual(handoff.record.selectedNextAction, {
    changedKirLimits: ['maxBytes', 'maxDepth', 'maxNodes'],
    changedProfileLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    kirLimits: { maxBytes: 273_051, maxDepth: 98, maxNodes: 5_313 },
    migratedParameterRows: 41,
    profileLimits: { maxNodeRows: 202, maxPropertyRows: 308, maxValueRows: 4_493 },
    totalDelta: 14_422,
    witnesses: [VALIDATE_ID],
  });
  assert.equal(
    formatM4126ProjectionAnalysisStatus(handoff.record.selectedNextAction),
    'M4.126 projection analysis selects combined KIR 273051/98/5313 and profile ' +
      '202/308/4493 for 1 function/41 rows across 1 tool; M4.127 authenticates ' +
      'structural KIR and runtime-envelope headroom.',
  );
});

test('M4.126 receipt rejects mutation, decoration, sharing, and cycles', () => {
  const published = loadPublishedCanonicalizerProjectionAnalysisM4126().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.projection-analysis.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.requirements.pop(); },
    (copy) => { copy.requirements[0].requiredKirLimits.maxDepth += 1; },
    (copy) => { copy.candidates.pop(); },
    (copy) => { copy.selectedNextAction.kirLimits.maxDepth += 1; },
    (copy) => { copy.selectedNextAction.profileLimits.maxValueRows += 1; },
    (copy) => { copy.summary.projectedFunctions = 1; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerProjectionAnalysisM4126(copy),
      /coverage M4\.126 projection analysis rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4126(decorated),
    /coverage M4\.126 projection analysis rejection/u,
  );
  const shared = structuredClone(published);
  shared.selectedNextAction = shared.candidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4126(shared),
    /coverage M4\.126 projection analysis rejection/u,
  );
  const cyclic = structuredClone(published);
  cyclic.input.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4126(cyclic),
    /coverage M4\.126 projection analysis rejection/u,
  );
  for (const mutate of [
    (copy) => { copy.changedKirLimits.pop(); },
    (copy) => { copy.changedProfileLimits.pop(); },
    (copy) => { copy.kirLimits.maxDepth += 1; },
    (copy) => { copy.profileLimits.maxValueRows += 1; },
    (copy) => { copy.totalDelta += 1; },
    (copy) => { copy.witnesses = []; },
  ]) {
    const action = structuredClone(published.selectedNextAction);
    mutate(action);
    assert.throws(
      () => formatM4126ProjectionAnalysisStatus(action),
      /M4\.126 status requires the exact combined validate candidate/u,
    );
  }
});

test('M4.126 preserves the immutable M4.125 residual input', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM4125().digest,
    'eb2b075097025b9f91089a0587e84807279061801850b10402dd0978a2fe9652',
  );
});

test('M4.126 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerProjectionAnalysisM4126 as load} from './scripts/kern-canonicalizer/projection-analysis-m4-126.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerProjectionAnalysisM4126());
});
