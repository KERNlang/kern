import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM4109 } from './coverage-residual-analysis-m4-109.mjs';
import {
  loadPublishedCanonicalizerProjectionAnalysisM4110,
  measureCanonicalizerProjectionAnalysisM4110,
  validatePublishedCanonicalizerProjectionAnalysisM4110,
} from './projection-analysis-m4-110.mjs';
import { formatM4110ProjectionAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./projection-analysis-m4-110.json', import.meta.url);
const PUBLISHED_DIGEST = '38f26bb48237832163acb8fa99ee0b65b8dc343f77f6a7570481e54d01d6732f';
const EXPECTED_WITNESSES = [
  'examples/capstone-assertion-engine/compare.kern#2:compareList',
  'examples/capstone-assertion-engine/compare.kern#3:compareMap',
  'examples/capstone-checker-subset/checker-while.kern#11:lengthReceiverProven',
  'examples/capstone-checker-subset/checker-while.kern#9:numericBindingProven',
  'examples/capstone-checker-subset/checker.kern#17:paramCallsitesOk',
  'examples/capstone-checker-subset/checker.kern#20:mapKeyToken',
  'examples/capstone-checker-subset/checker.kern#21:mapKnownBefore',
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#4:emitstatement',
  'examples/selfhost-validator/validator.kern#15:exportkind',
];

test('M4.110 freezes exact projection requirements and the ranked depth candidate', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerProjectionAnalysisM4110();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, 'e77fc4567543ad6984b86b97d8a7a8e469020ebd');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.projection-analysis.1');
  assert.equal(handoff.record.input.residualAnalysisDigest,
    'ad6240c77ed276d1f865beb702ceeb7c85767191dbaa3cf36f526505c4e555fb');
  assert.equal(handoff.record.requirements.length, 15);
  assert.equal(handoff.record.summary.projectedFunctions, 13);
  assert.equal(handoff.record.summary.unsupportedFunctions, 2);
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
  assert.deepEqual(handoff.record.selectedNextAction, {
    changedLimits: ['maxDepth'],
    completeFunctions: 9,
    completeTools: 4,
    kirLimits: { maxBytes: 262144, maxDepth: 76, maxNodes: 4096 },
    migratedParameterRows: 134,
    totalDelta: 12,
    witnesses: EXPECTED_WITNESSES,
  });
  assert.equal(
    formatM4110ProjectionAnalysisStatus(handoff.record.selectedNextAction),
    'M4.110 projection analysis selects maxDepth 76 for 9 functions/134 rows across 4 tools; ' +
      'M4.111 authenticates structural KIR and runtime-envelope safety.',
  );
});

test('M4.110 receipt rejects mutation, decoration, sharing, and cycles', () => {
  const published = loadPublishedCanonicalizerProjectionAnalysisM4110().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.projection-analysis.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.requirements.pop(); },
    (copy) => { copy.requirements[0].requiredKirLimits.maxDepth += 1; },
    (copy) => { copy.candidates.reverse(); },
    (copy) => { copy.selectedNextAction.kirLimits.maxDepth = 77; },
    (copy) => { copy.summary.projectedFunctions = 12; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerProjectionAnalysisM4110(copy),
      /coverage M4\.110 projection analysis rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4110(decorated),
    /coverage M4\.110 projection analysis rejection/u,
  );
  const shared = structuredClone(published);
  shared.selectedNextAction = shared.candidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4110(shared),
    /coverage M4\.110 projection analysis rejection/u,
  );
  const cyclic = structuredClone(published);
  cyclic.input.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4110(cyclic),
    /coverage M4\.110 projection analysis rejection/u,
  );
});

test('M4.110 remains immutable archival evidence after M4.117', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM4109().digest,
    'ad6240c77ed276d1f865beb702ceeb7c85767191dbaa3cf36f526505c4e555fb',
  );
  assert.throws(
    () => measureCanonicalizerProjectionAnalysisM4110(),
    /policy digest must remain exact/u,
  );
});

test('M4.110 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerProjectionAnalysisM4110 as load} from './scripts/kern-canonicalizer/projection-analysis-m4-110.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerProjectionAnalysisM4110());
});
