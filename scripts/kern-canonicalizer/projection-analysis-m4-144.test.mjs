import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  loadPublishedCanonicalizerResidualAnalysisM4143,
} from './coverage-residual-analysis-m4-143.mjs';
import { assertM4144ProjectionAnalysis } from './coverage-m4-144-central.mjs';
import {
  loadPublishedCanonicalizerProjectionAnalysisM4144,
  validatePublishedCanonicalizerProjectionAnalysisM4144,
} from './projection-analysis-m4-144.mjs';
import { formatM4144ProjectionAnalysisStatus } from './coverage-status-m4-144.mjs';

const summaryUrl = new URL('./projection-analysis-m4-144.json', import.meta.url);
const PUBLISHED_DIGEST = '0aa57f2721cd76c9fed61ab5aaf22deccb868277e3627587712c92c907a6b086';
const QUOTESOURCE_ID =
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource';
const EXPRESSIONSOURCES_ID =
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources';
const CANONICAL_SURFACE_BLOCKERS = [
  'if.properties.cond.expression.text.character-u007f',
  'if.properties.cond.expression.text.character-u0080',
  'if.properties.cond.expression.text.character-u009f',
  'if.properties.cond.expression.text.character-u2028',
  'if.properties.cond.expression.text.character-u2029',
  'if.properties.cond.expression.text.character-ufeff',
];
const SELECTED_ACTION = {
  changedKirLimits: ['maxBytes', 'maxDepth', 'maxNodes'],
  changedProfileLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
  completeFunctions: 1,
  completeTools: 1,
  kirLimits: { maxBytes: 367_368, maxDepth: 122, maxNodes: 7_136 },
  migratedParameterRows: 6,
  profileLimits: { maxNodeRows: 205, maxPropertyRows: 332, maxValueRows: 6_304 },
  totalDelta: 98_002,
  witnesses: [EXPRESSIONSOURCES_ID],
};
const STATUS =
  'M4.144 projection analysis selects combined KIR 367368/122/7136 and profile ' +
  '205/332/6304 for 1 function/6 rows across 1 tool; M4.145 authenticates ' +
  'structural KIR and runtime-envelope headroom.';

test('M4.144 freezes exact structural requirements and the expressionsources candidate', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerProjectionAnalysisM4144();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, 'e3cc1d133ef90c4e802d8df5318935e3c826398b');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.projection-analysis.2');
  assert.deepEqual(handoff.record.input, {
    assignmentDigest: '1da9a57ec132a8147f75ab0d252e188aa86b2744b23d58cf3dfa3510b7bcc106',
    baseKirLimits: { maxBytes: 273_051, maxDepth: 98, maxNodes: 5_313 },
    inputCommit: 'e3cc1d133ef90c4e802d8df5318935e3c826398b',
    profileLimits: { maxNodeRows: 202, maxPropertyRows: 308, maxValueRows: 4_493 },
    residualAnalysisDigest: '22639a2453389244611a91560afcd8d03ecefca8874089015f338622e5ba6e3e',
    residualFunctions: 2,
  });
  assert.deepEqual(handoff.record.requirements, [
    {
      canonicalSurfaceBlockers: CANONICAL_SURFACE_BLOCKERS,
      id: QUOTESOURCE_ID,
      kirMinimumRejections: {},
      outcome: 'projected',
      parameterRows: 2,
      profileRows: { nodes: 54, properties: 82, values: 932 },
      requiredKirLimits: {},
      requiredProfileLimits: {},
      tool: 'canonicalizer',
    },
    {
      canonicalSurfaceBlockers: [],
      id: EXPRESSIONSOURCES_ID,
      kirMinimumRejections: {
        maxBytes: { code: 'limit-bytes', limit: 367_367 },
        maxDepth: { code: 'limit-depth', limit: 121 },
        maxNodes: { code: 'limit-nodes', limit: 7_135 },
      },
      outcome: 'projected',
      parameterRows: 6,
      profileRows: { nodes: 205, properties: 332, values: 6_304 },
      requiredKirLimits: { maxBytes: 367_368, maxDepth: 122, maxNodes: 7_136 },
      requiredProfileLimits: {
        maxNodeRows: 205,
        maxPropertyRows: 332,
        maxValueRows: 6_304,
      },
      tool: 'canonicalizer',
    },
  ]);
  assert.deepEqual(handoff.record.summary, {
    canonicalSurfaceFunctions: 1,
    observedSettings: 1,
    projectedFunctions: 2,
    unsupportedFunctions: 0,
  });
  assert.deepEqual(handoff.record.candidates, [SELECTED_ACTION]);
  assert.deepEqual(handoff.record.selectedNextAction, SELECTED_ACTION);
  assert.equal(formatM4144ProjectionAnalysisStatus(SELECTED_ACTION), STATUS);
  assert.equal(assertM4144ProjectionAnalysis(), STATUS);
});

test('M4.144 proves each exact KIR minimum one unit above its rejection', () => {
  const requirement = loadPublishedCanonicalizerProjectionAnalysisM4144()
    .record.requirements.find(({ id }) => id === EXPRESSIONSOURCES_ID);
  assert.deepEqual(requirement.requiredKirLimits, {
    maxBytes: 367_368,
    maxDepth: 122,
    maxNodes: 7_136,
  });
  assert.deepEqual(requirement.kirMinimumRejections, {
    maxBytes: { code: 'limit-bytes', limit: 367_367 },
    maxDepth: { code: 'limit-depth', limit: 121 },
    maxNodes: { code: 'limit-nodes', limit: 7_135 },
  });
  assert.deepEqual(requirement.profileRows, {
    nodes: 205,
    properties: 332,
    values: 6_304,
  });
});

test('M4.144 receipt rejects mutation and non-exact plain data', () => {
  const published = loadPublishedCanonicalizerProjectionAnalysisM4144().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.projection-analysis.1'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.input.inputCommit = '0'.repeat(40); },
    (copy) => { copy.requirements.pop(); },
    (copy) => { copy.requirements[1].requiredKirLimits.maxBytes -= 1; },
    (copy) => { copy.requirements[1].kirMinimumRejections.maxNodes.code = 'limit-depth'; },
    (copy) => { copy.requirements[0].canonicalSurfaceBlockers.pop(); },
    (copy) => { copy.candidates.pop(); },
    (copy) => { copy.selectedNextAction.kirLimits.maxDepth += 1; },
    (copy) => { copy.selectedNextAction.profileLimits.maxValueRows += 1; },
    (copy) => { copy.summary.observedSettings = -0; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerProjectionAnalysisM4144(copy),
      /coverage M4\.144 projection analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4144(decorated),
    /coverage M4\.144 projection analysis rejection/u,
  );

  const accessor = structuredClone(published);
  Object.defineProperty(accessor.summary, 'observedSettings', {
    configurable: true,
    enumerable: true,
    get: () => 1,
  });
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4144(accessor),
    /coverage M4\.144 projection analysis rejection/u,
  );

  const readOnly = structuredClone(published);
  Object.defineProperty(readOnly.input, 'residualFunctions', {
    configurable: true,
    enumerable: true,
    value: 2,
    writable: false,
  });
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4144(readOnly),
    /coverage M4\.144 projection analysis rejection/u,
  );

  const fixedLength = structuredClone(published);
  Object.defineProperty(fixedLength.requirements, 'length', { writable: false });
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4144(fixedLength),
    /coverage M4\.144 projection analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.selectedNextAction = shared.candidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4144(shared),
    /coverage M4\.144 projection analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.input.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerProjectionAnalysisM4144(cyclic),
    /coverage M4\.144 projection analysis rejection/u,
  );
});

test('M4.144 preserves the immutable M4.143 residual input', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM4143().digest,
    '22639a2453389244611a91560afcd8d03ecefca8874089015f338622e5ba6e3e',
  );
});

test('M4.144 loads byte-identically in a fresh locale-independent process', () => {
  const moduleUrl = new URL('./projection-analysis-m4-144.mjs', import.meta.url).href;
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import {loadPublishedCanonicalizerProjectionAnalysisM4144 as load} from ` +
      `${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(load()))`,
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerProjectionAnalysisM4144());
});

test('M4.144 module imports from stdin without treating argv dash as a path', () => {
  const moduleUrl = new URL('./projection-analysis-m4-144.mjs', import.meta.url).href;
  const fresh = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    input: `import ${JSON.stringify(moduleUrl)}; process.stdout.write('ok')`,
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal(fresh.stdout, 'ok');
});

test('M4.144 direct invocation through a symlink still requires --write', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kern-m4-144-entry-'));
  const link = join(directory, 'projection-analysis-m4-144.mjs');
  symlinkSync(new URL('./projection-analysis-m4-144.mjs', import.meta.url), link);
  try {
    const fresh = spawnSync(process.execPath, [link], {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
    });
    assert.notEqual(fresh.status, 0);
    assert.match(fresh.stderr, /direct invocation requires exactly --write/u);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('M4.144 import ignores a non-path argv placeholder', () => {
  const moduleUrl = new URL('./projection-analysis-m4-144.mjs', import.meta.url).href;
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `process.argv[1] = 'not-a-real-path'; await import(${JSON.stringify(moduleUrl)}); ` +
      "process.stdout.write('ok')",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal(fresh.stdout, 'ok');
});
