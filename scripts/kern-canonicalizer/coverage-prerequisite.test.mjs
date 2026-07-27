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
import { m4100ParameterMigration } from './coverage-m4-100-parameter-migration.mjs';
import { assertCoverageSummary } from './coverage-summary-writer.mjs';

const summaryUrl = new URL('./coverage-prerequisite-summary.json', import.meta.url);
const EXPECTED_PARAMETER_MIGRATION = m4100ParameterMigration();

const EXPECTED_EXHAUSTION = {
  activeFamilies: ['exception-flow'],
  completingClosureCount: 0,
  evaluatedNonEmptyClosureCount: 1,
  reasonAssignmentsDigest: 'f502a363d83d85b78d0cdc4287aefcd348de042ed94be5f9d14657cf5a6f9913',
  reasonCounts: [
    { count: 1, id: 'if.properties.cond.expression.text.character-u007f' },
    { count: 1, id: 'if.properties.cond.expression.text.character-u0080' },
    { count: 1, id: 'if.properties.cond.expression.text.character-u009f' },
    { count: 1, id: 'if.properties.cond.expression.text.character-u2028' },
    { count: 1, id: 'if.properties.cond.expression.text.character-u2029' },
    { count: 1, id: 'if.properties.cond.expression.text.character-ufeff' },
    { count: 1, id: 'let.value:unknown-expression-kind' },
    { count: 1, id: 'profile.rows.nodes' },
    { count: 1, id: 'profile.rows.properties' },
    { count: 1, id: 'profile.rows.values' },
    { count: 12, id: 'projection.limit-depth' },
    { count: 1, id: 'projection.limit-nodes' },
    { count: 2, id: 'projection.unknown-expression-kind' },
    { count: 1, id: 'throw.value:unknown-expression-kind' },
  ],
  residualFunctionCount: 16,
  scope: 'current-bounded-profile',
};

test('M4.100 consumes the comparisonOperandsOk queue and preserves bounded exhaustion', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.equal(actual.outcome, 'bounded-exhaustion');
  assert.equal(actual.minimumFamilyCount, null);
  assert.equal(actual.selectedPrerequisite, null);
  assert.deepEqual(actual.parameterMigration, EXPECTED_PARAMETER_MIGRATION);
  assert.deepEqual(actual.prerequisiteRanking, []);
  assert.deepEqual(actual.ranking, []);
  assert.deepEqual(actual.exhaustion, EXPECTED_EXHAUSTION);
});

test('format 3 rejects drift in the M4.100 migrated frontier', () => {
  const actual = measureCanonicalizerPrerequisite();
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.prerequisite-summary.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.outcome = 'selected'; },
    (copy) => { copy.minimumFamilyCount = 0; },
    (copy) => { copy.selectedPrerequisite = { catalogFacts: 2, family: 'while-iteration', occurrences: 2 }; },
    (copy) => { copy.prerequisiteRanking.push({ catalogFacts: 2, family: 'while-iteration', occurrences: 2 }); },
    (copy) => { copy.ranking.push({}); },
    (copy) => { copy.exhaustion = null; },
    (copy) => { copy.exhaustion.activeFamilies = []; },
    (copy) => { copy.exhaustion.completingClosureCount = 1; },
    (copy) => { copy.exhaustion.evaluatedNonEmptyClosureCount = 2; },
    (copy) => { copy.exhaustion.reasonAssignmentsDigest = '0'.repeat(64); },
    (copy) => { copy.exhaustion.reasonCounts.reverse(); },
    (copy) => { copy.exhaustion.residualFunctionCount = 29; },
    (copy) => { copy.exhaustion.scope = 'future'; },
    (copy) => { copy.baseline.baseId = 'future'; },
    (copy) => { copy.baseline.coveragePolicyDigest = 'invalid'; },
    (copy) => { copy.baseline.canonicalizerDigest = '0'.repeat(64); },
    (copy) => { copy.parameterMigration.completeFunctions += 1; },
    (copy) => { copy.parameterMigration.completeTools += 1; },
    (copy) => { copy.parameterMigration.migratedParameterRows += 1; },
    (copy) => { copy.parameterMigration.witnesses = [{ id: 'future' }]; },
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

test('M4.100 publishes the exact post-migration frontier', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 90,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    canonicalizerDigest: '983eed5c8841b0cdf41a0b678734f2457c97545a88607969acc9fd4dcc1fc807',
    canonicalizerPolicyDigest: '687f8ca3a3e1458bd6c3d3b7baacde4614c6a7eff78bb9d4071027f4311cfc09',
    compiledCoreDigest: '502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec',
    corpusDigest: 'e51d59f17c361443ea0f4762eed50aa0bfd1c473568a893e1a51a2e00755ba7b',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: 'e5fdb18d2de95a15429e51364fb817b3f99342d272105db6c53091e3baf00b8c',
    familyRegistryDigest: 'a7ea4bdc1af766f893b7491a59c727b0459ecb637a71f9f54d6087ee5baeeb87',
    functionCount: 109,
    functionFactsDigest: 'f6d17da9c73aa2321ec4cda779cb13d59221e2b8ebc335d914b4c5a013242b2f',
    legacyParameterBlockers: 16,
    profileDigest: '382fc8ca3efb672c72eeb0e33ead337e05d7beab08dcdf67e2e9849b3ad9f24b',
    toolCount: 4,
  });
  assert.match(actual.baseline.coverageImplementationDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(actual.parameterMigration, EXPECTED_PARAMETER_MIGRATION);
  assert.deepEqual(actual.exhaustion, EXPECTED_EXHAUSTION);
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
  const direct = migrateLegacyFunctionForPrerequisite({
    children: [
      { children: [], props: { name: 'direct', type: 'string' }, type: 'param' },
      { children: [], props: { lang: 'kern' }, type: 'handler' },
    ],
    props: { name: 'directOnly', returns: 'void' },
    type: 'fn',
  });
  assert.deepEqual(direct.parameters, [{ name: 'direct', type: 'string' }]);
  assert.equal(direct.root.props.params, undefined);
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
