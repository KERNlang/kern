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

const EXPECTED_EXHAUSTION = {
  activeFamilies: ['exception-flow', 'while-iteration'],
  completingClosureCount: 0,
  evaluatedNonEmptyClosureCount: 3,
  reasonAssignmentsDigest: 'a965461fa32dc4bbb1fdfa3ca153d91d019865e6ddb10e57f64087be6d7402bf',
  reasonCounts: [
    { count: 1, id: 'if.properties.cond.expression.text.character-u007f' },
    { count: 1, id: 'if.properties.cond.expression.text.character-u0080' },
    { count: 1, id: 'if.properties.cond.expression.text.character-u009f' },
    { count: 1, id: 'if.properties.cond.expression.text.character-u2028' },
    { count: 1, id: 'if.properties.cond.expression.text.character-u2029' },
    { count: 1, id: 'if.properties.cond.expression.text.character-ufeff' },
    { count: 1, id: 'let.value:unknown-expression-kind' },
    { count: 27, id: 'profile.rows.nodes' },
    { count: 23, id: 'profile.rows.properties' },
    { count: 28, id: 'profile.rows.values' },
    { count: 13, id: 'projection.limit-depth' },
    { count: 1, id: 'projection.limit-nodes' },
    { count: 2, id: 'projection.unknown-expression-kind' },
    { count: 1, id: 'throw.value:unknown-expression-kind' },
  ],
  residualFunctionCount: 45,
  scope: 'current-bounded-profile',
};

test('M4.41 consumes the authenticated 154-row parameter migration frontier', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.equal(actual.outcome, 'bounded-exhaustion');
  assert.equal(actual.minimumFamilyCount, null);
  assert.deepEqual(actual.exhaustion, EXPECTED_EXHAUSTION);
  assert.deepEqual(actual.parameterMigration, EXPECTED_PARAMETER_MIGRATION);
  assert.deepEqual(actual.prerequisiteRanking, []);
  assert.deepEqual(actual.ranking, []);
  assert.equal(actual.selectedPrerequisite, null);
});

test('format 3 rejects mixed selection and bounded-exhaustion shapes after M4.41 queue consumption', () => {
  const actual = measureCanonicalizerPrerequisite();
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.prerequisite-summary.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.outcome = 'selected'; },
    (copy) => { copy.minimumFamilyCount = 0; },
    (copy) => { copy.selectedPrerequisite = { family: 'future' }; },
    (copy) => { copy.prerequisiteRanking.push({ family: 'future' }); },
    (copy) => { copy.ranking.push({ families: ['future'] }); },
    (copy) => { copy.exhaustion = null; },
    (copy) => { copy.exhaustion.activeFamilies.pop(); },
    (copy) => { copy.exhaustion.activeFamilies.push('exception-flow'); },
    (copy) => { copy.exhaustion.activeFamilies.reverse(); },
    (copy) => { copy.exhaustion.activeFamilies[0] = 'future-family'; },
    (copy) => { copy.exhaustion.completingClosureCount = 1; },
    (copy) => { copy.exhaustion.evaluatedNonEmptyClosureCount = 2; },
    (copy) => { copy.exhaustion.reasonAssignmentsDigest = 'invalid'; },
    (copy) => { copy.exhaustion.reasonAssignmentsDigest = '0'.repeat(64); },
    (copy) => { copy.exhaustion.reasonCounts[0].count = 0; },
    (copy) => { copy.exhaustion.reasonCounts[0].count = 2; },
    (copy) => { copy.exhaustion.reasonCounts[0].count = 57; },
    (copy) => { copy.exhaustion.reasonCounts[0].future = true; },
    (copy) => { copy.exhaustion.reasonCounts.reverse(); },
    (copy) => { copy.exhaustion.residualFunctionCount = 44; },
    (copy) => { copy.exhaustion.scope = 'kern5-complete'; },
    (copy) => { copy.baseline.baseId = 'future'; },
    (copy) => { copy.baseline.coveragePolicyDigest = 'invalid'; },
    (copy) => { copy.baseline.canonicalizerDigest = '0'.repeat(64); },
    (copy) => { copy.parameterMigration.completeFunctions = 1; },
    (copy) => { copy.parameterMigration.completeTools = 1; },
    (copy) => { copy.parameterMigration.migratedParameterRows = 1; },
    (copy) => {
      copy.parameterMigration.witnesses.push({
        id: 'examples/selfhost-validator/validator.kern#0:future',
        parameterRows: 1,
        profileRows: { nodes: 1, properties: 1, values: 1 },
        tool: 'validator',
      });
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
  const selected = structuredClone(actual);
  selected.outcome = 'selected';
  selected.exhaustion = null;
  selected.minimumFamilyCount = 1;
  selected.selectedPrerequisite = { catalogFacts: 1, family: 'exception-flow', occurrences: 34 };
  selected.prerequisiteRanking = [selected.selectedPrerequisite];
  selected.ranking = [{
    completeFunctions: 1,
    completeTools: 1,
    families: ['exception-flow'],
    migratedParameterRows: 1,
    occurrences: 34,
    witnesses: [{
      id: 'examples/selfhost-validator/validator.kern#0:future',
      parameterRows: 1,
      profileRows: { nodes: 1, properties: 1, values: 1 },
      tool: 'validator',
    }],
  }];
  assert.throws(
    () => validateCanonicalizerPrerequisiteSummary(selected),
    /summary must match authenticated measurement/u,
  );
});

test('M4.41 binds the exact post-migration 154-row transition', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 57,
    baseId: 'kern.kir-canonicalizer.profile.m4.36',
    canonicalizerDigest: '2b39f976b7eeb3e2cedc400821880a77edc11b99a72d0e24a28ddec8cabaeb4c',
    canonicalizerPolicyDigest: '26e37f1839a36c6acbe220afb5afccd6f357d72256f29d21df0a715adb2d1f5d',
    compiledCoreDigest: '7b8d3540cb8927db1e9c8d3d2938671103186bed4cc32c955d68e5dbb82c7448',
    corpusDigest: 'dba3f9d2d5354dca7ff0509a3ae45b7e26068e7170d160f00201cb585c036662',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: 'c6fa85f4906716bc11f13b68192e4108a46d61329c690aaa6be53c5433f8a3e6',
    familyRegistryDigest: 'a7ea4bdc1af766f893b7491a59c727b0459ecb637a71f9f54d6087ee5baeeb87',
    functionCount: 104,
    functionFactsDigest: 'ca9702a70e92e79aa384c04a09e4ea835009e19f726671dead147f160b632ea8',
    legacyParameterBlockers: 45,
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
