import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  measureCanonicalizerPrerequisite,
  migrateLegacyFunctionForPrerequisite,
  parseLegacyParametersForPrerequisite,
  validateCanonicalizerPrerequisiteSummary,
} from './coverage-prerequisite.mjs';
import { assertCoverageSummary } from './coverage-summary-writer.mjs';

const summaryUrl = new URL('./coverage-prerequisite-summary.json', import.meta.url);
const EXPECTED_PARAMETER_MIGRATION = {
  completeFunctions: 7,
  completeTools: 4,
  migratedParameterRows: 102,
  witnesses: [
    {
      id: 'examples/capstone-assertion-engine/compare.kern#4:compareNode',
      parameterRows: 13,
      profileRows: { nodes: 24, properties: 39, values: 373 },
      tool: 'assertion-engine',
    },
    {
      id: 'examples/capstone-checker-subset/checker-while.kern#14:literalTrue',
      parameterRows: 7,
      profileRows: { nodes: 23, properties: 33, values: 244 },
      tool: 'checker',
    },
    {
      id: 'examples/capstone-checker-subset/checker-while.kern#17:checkerWhileRejectDetail',
      parameterRows: 22,
      profileRows: { nodes: 25, properties: 49, values: 189 },
      tool: 'checker',
    },
    {
      id: 'examples/capstone-checker-subset/checker.kern#14:termProvenanced',
      parameterRows: 11,
      profileRows: { nodes: 24, properties: 36, values: 237 },
      tool: 'checker',
    },
    {
      id: 'examples/capstone-checker-subset/checker.kern#6:whileRejectDetail',
      parameterRows: 22,
      profileRows: { nodes: 25, properties: 48, values: 188 },
      tool: 'checker',
    },
    {
      id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#3:emitstatementlist',
      parameterRows: 15,
      profileRows: { nodes: 25, properties: 50, values: 235 },
      tool: 'canonicalizer',
    },
    {
      id: 'examples/selfhost-validator/validator.kern#11:owncallable',
      parameterRows: 12,
      profileRows: { nodes: 24, properties: 42, values: 212 },
      tool: 'validator',
    },
  ],
};

const EXPECTED_RANKING = [{
  completeFunctions: 1,
  completeTools: 1,
  families: ['while-iteration'],
  migratedParameterRows: 1,
  occurrences: 2,
  witnesses: [{
    id: 'examples/selfhost-validator/validator.kern#19:sortstrings',
    parameterRows: 1,
    profileRows: { nodes: 25, properties: 43, values: 266 },
    tool: 'validator',
  }],
}];

test('M4.56 publishes the authenticated dual-row parameter frontier first', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.equal(actual.outcome, 'selected');
  assert.equal(actual.minimumFamilyCount, 1);
  assert.equal(actual.exhaustion, null);
  assert.deepEqual(actual.parameterMigration, EXPECTED_PARAMETER_MIGRATION);
  assert.deepEqual(actual.prerequisiteRanking, [{
    catalogFacts: 2,
    family: 'while-iteration',
    occurrences: 2,
  }]);
  assert.deepEqual(actual.ranking, EXPECTED_RANKING);
  assert.deepEqual(actual.selectedPrerequisite, actual.prerequisiteRanking[0]);
});

test('format 3 rejects drift in the M4.56 selected frontier', () => {
  const actual = measureCanonicalizerPrerequisite();
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.prerequisite-summary.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.outcome = 'bounded-exhaustion'; },
    (copy) => { copy.minimumFamilyCount = 0; },
    (copy) => { copy.minimumFamilyCount = 2; },
    (copy) => { copy.selectedPrerequisite = null; },
    (copy) => { copy.selectedPrerequisite.family = 'future'; },
    (copy) => { copy.prerequisiteRanking = []; },
    (copy) => { copy.prerequisiteRanking.push(structuredClone(copy.prerequisiteRanking[0])); },
    (copy) => { copy.ranking = []; },
    (copy) => { copy.ranking[0].families[0] = 'exception-flow'; },
    (copy) => { copy.ranking[0].occurrences = 1; },
    (copy) => { copy.ranking[0].witnesses[0].id = copy.parameterMigration.witnesses[0].id; },
    (copy) => { copy.exhaustion = {}; },
    (copy) => { copy.baseline.baseId = 'future'; },
    (copy) => { copy.baseline.coveragePolicyDigest = 'invalid'; },
    (copy) => { copy.baseline.canonicalizerDigest = '0'.repeat(64); },
    (copy) => { copy.parameterMigration.completeFunctions = 8; },
    (copy) => { copy.parameterMigration.completeTools = 3; },
    (copy) => { copy.parameterMigration.migratedParameterRows = 101; },
    (copy) => { copy.parameterMigration.witnesses.reverse(); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerPrerequisiteSummary(copy),
      /coverage prerequisite rejection/u,
    );
  }
});

test('M4.56 binds the exact promoted dual-row transition', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 65,
    baseId: 'kern.kir-canonicalizer.profile.m4.36',
    canonicalizerDigest: '9ef2e9f787f91efec3deb06ff07b11bf2093a07aa1301d59fda3551dc80d4bb5',
    canonicalizerPolicyDigest: '5aeba11a3c26e7b8025f28cd0c6a8ba1b8de50bf2060ae311744a7527767c67d',
    compiledCoreDigest: '7b8d3540cb8927db1e9c8d3d2938671103186bed4cc32c955d68e5dbb82c7448',
    corpusDigest: 'da83239e2f10cf3a14350fc935c43ca44fcaf461e6513e14cc25ff984ec3c9de',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: '213ce7266b0d8e449c4333483fe8862ae7d3fc69f2aaa7b869595dcbd5111d5c',
    familyRegistryDigest: 'a7ea4bdc1af766f893b7491a59c727b0459ecb637a71f9f54d6087ee5baeeb87',
    functionCount: 104,
    functionFactsDigest: 'b8f15f0c98c3019e78b6450eaca47d1110677555db0695136ca2b1a12fa78aee',
    legacyParameterBlockers: 38,
    profileDigest: '382fc8ca3efb672c72eeb0e33ead337e05d7beab08dcdf67e2e9849b3ad9f24b',
    toolCount: 4,
  });
  assert.match(actual.baseline.coverageImplementationDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(actual.parameterMigration, EXPECTED_PARAMETER_MIGRATION);
  const readyIds = new Set(actual.parameterMigration.witnesses.map(({ id }) => id));
  const residualIds = actual.ranking.flatMap(({ witnesses }) => witnesses.map(({ id }) => id));
  assert.equal(residualIds.some((id) => readyIds.has(id)), false);
  const checkedIn = JSON.parse(readFileSync(summaryUrl, 'utf8'));
  assert.deepEqual(actual, checkedIn);
  assertCoverageSummary(summaryUrl, actual);
});

test('the live prerequisite measurement is stable in a fresh process', () => {
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {measureCanonicalizerPrerequisite} from './scripts/kern-canonicalizer/coverage-prerequisite.mjs'; process.stdout.write(JSON.stringify(measureCanonicalizerPrerequisite()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), measureCanonicalizerPrerequisite());
});

test('M4.15 counterfactual parameters fail closed outside exact portable pairs', () => {
  assert.deepEqual(parseLegacyParametersForPrerequisite('raw:string,n:number[]'), [
    { name: 'raw', type: 'string' },
    { name: 'n', type: 'number[]' },
  ]);
  for (const raw of [
    '',
    'raw',
    'raw:string:extra',
    'raw:string,raw:number',
    'bad-name:string',
    '$x:string',
    'true:string',
    '__kern:string',
    '_kernTmp:string',
    'raw:unknown',
  ]) {
    assert.throws(
      () => parseLegacyParametersForPrerequisite(raw),
      /coverage prerequisite rejection/u,
    );
  }
  assert.throws(
    () => migrateLegacyFunctionForPrerequisite({
      children: [
        { children: [], props: { name: 'direct', type: 'string' }, type: 'param' },
        { children: [], props: { lang: 'kern' }, type: 'handler' },
      ],
      props: { name: 'mixed', params: 'legacy:string', returns: 'void' },
      type: 'fn',
    }),
    /legacy function must be a function without direct parameter children/u,
  );
});
