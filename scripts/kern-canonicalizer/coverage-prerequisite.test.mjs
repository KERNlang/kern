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

test('M4.57 consumes the authenticated dual-row parameter frontier first', () => {
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

test('format 3 rejects drift in the M4.57 selected frontier', () => {
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
    (copy) => { copy.parameterMigration.witnesses.push(structuredClone(copy.ranking[0].witnesses[0])); },
    (copy) => { copy.exhaustion = {}; },
    (copy) => { copy.baseline.baseId = 'future'; },
    (copy) => { copy.baseline.coveragePolicyDigest = 'invalid'; },
    (copy) => { copy.baseline.canonicalizerDigest = '0'.repeat(64); },
    (copy) => { copy.parameterMigration.completeFunctions = 1; },
    (copy) => { copy.parameterMigration.completeTools = 1; },
    (copy) => { copy.parameterMigration.migratedParameterRows = 1; },
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

test('M4.57 binds the exact consumed dual-row transition', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 72,
    baseId: 'kern.kir-canonicalizer.profile.m4.36',
    canonicalizerDigest: 'cd182decf48bad672bbae25b8f74aecc13dd7d308379167c42e7230cf8e3cd23',
    canonicalizerPolicyDigest: '5aeba11a3c26e7b8025f28cd0c6a8ba1b8de50bf2060ae311744a7527767c67d',
    compiledCoreDigest: '7b8d3540cb8927db1e9c8d3d2938671103186bed4cc32c955d68e5dbb82c7448',
    corpusDigest: 'e42e678e3a8067073c5e164eaffc4e1fda1ab769ad1e417e1075eba933e72a4b',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: 'ca8362845bc2460dde40596674ded29ff8aab3eb4de40a28fd7789cc558937b1',
    familyRegistryDigest: 'a7ea4bdc1af766f893b7491a59c727b0459ecb637a71f9f54d6087ee5baeeb87',
    functionCount: 104,
    functionFactsDigest: '962d0bc6b57a5158fdc8c0f6dfc5c1aebf5ee0c2e53fe4e352241cc75b91f3b5',
    legacyParameterBlockers: 31,
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
