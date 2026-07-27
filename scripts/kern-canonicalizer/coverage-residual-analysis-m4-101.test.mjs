import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM495 } from './coverage-residual-analysis-m4-95.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM4101,
  measureCanonicalizerResidualAnalysisM4101,
  validatePublishedCanonicalizerResidualAnalysisM4101,
} from './coverage-residual-analysis-m4-101.mjs';
import { formatM4101ResidualAnalysisStatus } from './coverage-status.mjs';

const summaryUrl = new URL('./coverage-residual-analysis-m4-101.json', import.meta.url);
const PUBLISHED_DIGEST = '9b389d0b2536cf2cd11d49bc47f1f234c46924c14c2ef160faf633069a3c94f0';
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 89, maxPropertyRows: 125, maxValueRows: 2100 },
  totalDelta: 1313,
  witnesses: [
    'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement',
  ],
};

test('M4.101 freezes the exact published M4.100 residual frontier', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4101();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, 'f95952200aec3a13ff71d42f63b7a7ed47010e48');
  assert.equal(handoff.record.format, 'kern.kir-canonicalizer.residual-analysis.3');
  assert.deepEqual(handoff.record.baseline, {
    baseCompleteFunctions: 90,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    coverageImplementationDigest: '7809416075a702b6165ca035aa991a1aa1b6b5bfdde31d43ab93ded799f3c552',
    coveragePolicyDigest: 'e5fdb18d2de95a15429e51364fb817b3f99342d272105db6c53091e3baf00b8c',
    currentProfileLimits: { maxNodeRows: 74, maxPropertyRows: 95, maxValueRows: 832 },
    functionFactsDigest: 'f6d17da9c73aa2321ec4cda779cb13d59221e2b8ebc335d914b4c5a013242b2f',
    legacyParameterBlockers: 16,
    residualFunctionCount: 16,
  });
  assert.equal(
    handoff.record.assignmentsDigest,
    'f502a363d83d85b78d0cdc4287aefcd348de042ed94be5f9d14657cf5a6f9913',
  );
  assert.equal(handoff.record.assignments.length, 16);
  assert.equal(handoff.record.frontier.profileRowsAvailableFunctions, 1);
  assert.equal(handoff.record.frontier.evaluatedObservedSettings, 1);
  assert.equal(handoff.record.frontier.actionableCandidates.length, 1);
  assert.deepEqual(handoff.record.selectedNextAction, EXPECTED_SELECTION);
  assert.equal(
    handoff.record.assignments
      .filter(({ id }) => EXPECTED_SELECTION.witnesses.includes(id))
      .reduce((total, { parameterRows }) => total + parameterRows, 0),
    14,
  );
  assert.equal(
    formatM4101ResidualAnalysisStatus(handoff.record.selectedNextAction),
    'M4.101 published analysis selected 1 function by ' +
      'maxNodeRows+maxPropertyRows+maxValueRows widening; ' +
      'M4.102 authenticates structural runtime headroom.',
  );
});

test('M4.101 published digest rejects canonical and decorated drift', () => {
  const published = loadPublishedCanonicalizerResidualAnalysisM4101().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.residual-analysis.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.assignments.pop(); },
    (copy) => { copy.frontier.actionableCandidates = []; },
    (copy) => { copy.baseline.currentProfileLimits.maxNodeRows = 75; },
    (copy) => { copy.selectedNextAction.limits.maxValueRows = 2101; },
    (copy) => { copy.selectedNextAction.witnesses.pop(); },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM4101(copy),
      /coverage M4\.101 residual analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4101(decorated),
    /coverage M4\.101 residual analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.selectedNextAction = shared.frontier.actionableCandidates[0];
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4101(shared),
    /coverage M4\.101 residual analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.selectedNextAction.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerResidualAnalysisM4101(cyclic),
    /coverage M4\.101 residual analysis rejection/u,
  );
});

test('M4.101 preserves exact M4.95 history and remains archival after M4.104', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM495().digest,
    'f69bbae69a3f25d059dcdc23e023f4432dcd23c19dc9e6228087811f178a4928',
  );
  const publishedBytes = readFileSync(summaryUrl);
  const writer = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./coverage-residual-analysis-m4-101.mjs', import.meta.url)), '--write'],
    { encoding: 'utf8' },
  );
  assert.notEqual(writer.status, 0);
  assert.match(writer.stderr, /live semantic facts must match the exact published M4\.100 input/u);
  assert.deepEqual(readFileSync(summaryUrl), publishedBytes);
  assert.throws(
    () => measureCanonicalizerResidualAnalysisM4101(),
    /live semantic facts must match the exact published M4\.100 input/u,
  );
});

test('M4.101 loads byte-identically in a fresh locale-independent process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerResidualAnalysisM4101 as load} from './scripts/kern-canonicalizer/coverage-residual-analysis-m4-101.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerResidualAnalysisM4101());
});
