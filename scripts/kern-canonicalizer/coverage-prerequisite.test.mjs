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
  activeFamilies: ['exception-flow'],
  completingClosureCount: 0,
  evaluatedNonEmptyClosureCount: 1,
  reasonAssignmentsDigest: '0abacdcff2a8ee7dfd977de09a3af2488350a383347b226a0afe36b8ca786ae7',
  reasonCounts: [
    { count: 1, id: 'if.properties.cond.expression.text.character-u007f' },
    { count: 1, id: 'if.properties.cond.expression.text.character-u0080' },
    { count: 1, id: 'if.properties.cond.expression.text.character-u009f' },
    { count: 1, id: 'if.properties.cond.expression.text.character-u2028' },
    { count: 1, id: 'if.properties.cond.expression.text.character-u2029' },
    { count: 1, id: 'if.properties.cond.expression.text.character-ufeff' },
    { count: 2, id: 'let.value:unknown-expression-kind' },
    { count: 5, id: 'profile.rows.nodes' },
    { count: 7, id: 'profile.rows.properties' },
    { count: 5, id: 'profile.rows.values' },
    { count: 12, id: 'projection.limit-depth' },
    { count: 1, id: 'projection.limit-nodes' },
    { count: 3, id: 'projection.unknown-expression-kind' },
    { count: 1, id: 'throw.value:unknown-expression-kind' },
  ],
  residualFunctionCount: 23,
  scope: 'current-bounded-profile',
};

test('M4.77 consumes the exact parameter tranche and preserves bounded exhaustion', () => {
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

test('format 3 rejects drift in the M4.77 consumed frontier', () => {
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
    (copy) => { copy.parameterMigration.completeFunctions = 1; },
    (copy) => { copy.parameterMigration.completeTools = 1; },
    (copy) => { copy.parameterMigration.migratedParameterRows = 1; },
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

test('M4.77 preserves the exact promoted base after consuming the queue', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 81,
    baseId: 'kern.kir-canonicalizer.profile.m4.60',
    canonicalizerDigest: 'fe5087dfcb79898a4b5d46cd233a2bbbeea156417f18ac314e87330172e31b28',
    canonicalizerPolicyDigest: 'ac4983323d0e9da875e75ae12aff079d8d52deee069d77f703280a06f2f42244',
    compiledCoreDigest: 'edcfa09f8d8973db85b200fbee7bd4e23bbca868144be86cfb06f14890228764',
    corpusDigest: '6f3d08f368bec3e81b55d20d35695c27d246545fe214e901ee8cc73cef22e9f9',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: '56ae4deb67877ac56789a4cbf8a069a90165fabe628df6daf389486593dfd8a8',
    familyRegistryDigest: 'a7ea4bdc1af766f893b7491a59c727b0459ecb637a71f9f54d6087ee5baeeb87',
    functionCount: 105,
    functionFactsDigest: 'a13b7b3be8c42a63c732ee0f2cd3b9aa9991e1fccb8bb7b7b4551b3bdaf7a188',
    legacyParameterBlockers: 23,
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
