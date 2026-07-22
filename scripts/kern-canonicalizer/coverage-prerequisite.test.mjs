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
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

const EXPECTED_DO_SELECTION = {
  prerequisiteRanking: [{ catalogFacts: 2, family: 'do-statement', occurrences: 178 }],
  ranking: [{
    completeFunctions: 1,
    completeTools: 1,
    families: ['do-statement'],
    migratedParameterRows: 2,
    occurrences: 178,
    witnesses: [{
      id: 'examples/selfhost-validator/validator.kern#14:appendid',
      parameterRows: 2,
      profileRows: { nodes: 9, properties: 16, values: 80 },
      tool: 'validator',
    }],
  }],
};

test('M4.35 implements do and preserves the exact residual prerequisite closure', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.equal(actual.outcome, 'selected');
  assert.equal(actual.minimumFamilyCount, 1);
  assert.equal(actual.exhaustion, null);
  assert.deepEqual(actual.parameterMigration, EXPECTED_PARAMETER_MIGRATION);
  assert.deepEqual(actual.prerequisiteRanking, EXPECTED_DO_SELECTION.prerequisiteRanking);
  assert.deepEqual(actual.selectedPrerequisite, EXPECTED_DO_SELECTION.prerequisiteRanking[0]);
  assert.deepEqual(actual.ranking, EXPECTED_DO_SELECTION.ranking);
  const parameterReadyIds = new Set(actual.parameterMigration.witnesses.map(({ id }) => id));
  assert.equal(actual.ranking[0].witnesses.some(({ id }) => parameterReadyIds.has(id)), false);
});

test('format 3 rejects selection, migration, overlap, and baseline drift', () => {
  const actual = measureCanonicalizerPrerequisite();
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.prerequisite-summary.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.outcome = 'bounded-exhaustion'; },
    (copy) => { copy.minimumFamilyCount = 2; },
    (copy) => { copy.selectedPrerequisite = null; },
    (copy) => { copy.prerequisiteRanking = []; },
    (copy) => { copy.ranking = []; },
    (copy) => { copy.exhaustion = {}; },
    (copy) => { copy.selectedPrerequisite.family = 'future'; },
    (copy) => { copy.ranking[0].completeFunctions = 0; },
    (copy) => { copy.ranking[0].completeTools = 0; },
    (copy) => { copy.ranking[0].migratedParameterRows = 0; },
    (copy) => { copy.ranking[0].families = ['future']; },
    (copy) => { copy.baseline.baseId = 'future'; },
    (copy) => { copy.baseline.coveragePolicyDigest = 'invalid'; },
    (copy) => { copy.parameterMigration.completeFunctions = 11; },
    (copy) => { copy.parameterMigration.completeTools = 3; },
    (copy) => { copy.parameterMigration.migratedParameterRows = 43; },
    (copy) => {
      copy.parameterMigration.witnesses.push(structuredClone(copy.ranking[0].witnesses[0]));
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerPrerequisiteSummary(copy),
      /coverage prerequisite rejection/u,
    );
  }
  const overlapping = structuredClone(actual);
  overlapping.parameterMigration = {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 2,
    witnesses: [structuredClone(overlapping.ranking[0].witnesses[0])],
  };
  assert.throws(
    () => validateCanonicalizerPrerequisiteSummary(overlapping),
    /selected format-3 summary must contain a positive winning closure/u,
  );
});

test('M4.35 binds the exact authenticated do implementation transition', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 45,
    baseId: 'kern.kir-canonicalizer.profile.m4.29',
    canonicalizerDigest: '40cadf5358a539eb54bfdd54adf48fba508d4c7eb03541a400e4d7e16f42b6a3',
    canonicalizerPolicyDigest: '9d3229bc2554adf7b49ff2fa0cba8885d156cb2f4e4b3b20fc9094719fc32279',
    compiledCoreDigest: '1c30b1f3a53ee83663a9d46f7152464571ac5be8fdb44f600b087bc78b1e1f54',
    corpusDigest: '009f1bc18de3e630a626ad9ddb5eff2b511d6fb7f0badc2aa87bce4f4336ecc1',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: 'fa5cedd2be8cac69bf4798826848ccf445e6788738685e015be149f5d3df67a4',
    familyRegistryDigest: 'a7ea4bdc1af766f893b7491a59c727b0459ecb637a71f9f54d6087ee5baeeb87',
    functionCount: 104,
    functionFactsDigest: 'd22ac32bf2803f1f33b8ce6fad2f2c4ced0da4ef22a3bd6565beb98e97fee20c',
    legacyParameterBlockers: 57,
    profileDigest: '2f17f2ec8537172a761fc8043f0a3c9e19a1852d4bb4755daf182c4bec2d1afa',
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
