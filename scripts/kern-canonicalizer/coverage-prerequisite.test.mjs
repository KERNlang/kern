import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
} from './coverage.mjs';
import {
  assertCurrentCanonicalizerFrontier,
} from './coverage-current.mjs';
import {
  buildCanonicalizerPrerequisiteSummary,
  measureCanonicalizerPrerequisite,
  migrateLegacyFunctionForPrerequisite,
  parseLegacyParametersForPrerequisite,
  validateCanonicalizerPrerequisiteSummary,
} from './coverage-prerequisite.mjs';
import { assertCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const summaryUrl = new URL('./coverage-prerequisite-summary.json', import.meta.url);
const EXPECTED_PARAMETER_MIGRATION = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

test('M4.151 publishes the exact terminal complete frontier', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.4');
  assert.equal(actual.outcome, 'complete');
  assert.equal(actual.minimumFamilyCount, null);
  assert.equal(actual.selectedPrerequisite, null);
  assert.deepEqual(actual.parameterMigration, EXPECTED_PARAMETER_MIGRATION);
  assert.deepEqual(actual.prerequisiteRanking, []);
  assert.deepEqual(actual.ranking, []);
  assert.equal(actual.exhaustion, null);
});

test('format 4 refuses a complete outcome when profile limits leave the base incomplete', () => {
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  canonicalizerPolicy.profileLimits = {
    maxNodeRows: 1,
    maxPropertyRows: 1,
    maxValueRows: 1,
  };
  assert.throws(
    () => buildCanonicalizerPrerequisiteSummary(
      loadCoveragePolicy(),
      new Map(),
      canonicalizerPolicy,
    ),
    /format 4 complete outcome requires full base coverage/u,
  );
});

test('format 4 rejects drift in the terminal complete frontier', () => {
  const actual = measureCanonicalizerPrerequisite();
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.prerequisite-summary.3'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.outcome = 'selected'; },
    (copy) => { copy.minimumFamilyCount = 0; },
    (copy) => { copy.selectedPrerequisite = { catalogFacts: 2, family: 'while-iteration', occurrences: 2 }; },
    (copy) => { copy.prerequisiteRanking.push({ catalogFacts: 2, family: 'while-iteration', occurrences: 2 }); },
    (copy) => { copy.ranking.push({}); },
    (copy) => { copy.exhaustion = {}; },
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

test('M4.151 publishes the exact current complete frontier', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.4');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 112,
    baseId: 'kern.kir-canonicalizer.profile.m4.141',
    canonicalizerDigest: 'f5c6a15806a1ffc031a171b234b13c205ce1d43134bf6fe89cc7e5fda1bc7cc4',
    canonicalizerPolicyDigest: '13d9315aeaf7ffa89ec17ad86b01e39e4a7084657000beb11f8bd0d478b21db7',
    compiledCoreDigest: 'c997bdaea094932754930bf96e2483cbada080bdb5182868f1936c3b69be774a',
    corpusDigest: '365842b501ba4f4c343f970eb05a93569a9cd62e88c9550a3c0923dee1f663c7',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: '605f091d7fee18ad4cfd4ab130ae7ae89632d7da75c973d04dd6f9b7d5ab833a',
    familyRegistryDigest: '2be9640b87d863298e5fa93704d526d8b09f58a5c4eed78a46cb8213cca56df8',
    functionCount: 112,
    functionFactsDigest: '9a2846e534915b225c6e094a032a3ec464f6b8f2afe30c5f93b12a29d983d6dd',
    legacyParameterBlockers: 0,
    profileDigest: 'fe14493f42136a4c6d5593b0ec6eb8c5c96c89076264cbdb961e8c2e03acb44b',
    toolCount: 4,
  });
  assert.match(actual.baseline.compiledCoreDigest, /^[0-9a-f]{64}$/u);
  assert.match(actual.baseline.functionFactsDigest, /^[0-9a-f]{64}$/u);
  assert.match(actual.baseline.coverageImplementationDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(actual.parameterMigration, EXPECTED_PARAMETER_MIGRATION);
  assert.equal(actual.selectedPrerequisite, null);
  assert.equal(actual.exhaustion, null);
  assert.deepEqual(actual.parameterMigration.witnesses, []);
  const checkedIn = JSON.parse(readFileSync(summaryUrl, 'utf8'));
  assert.deepEqual(actual, checkedIn);
  assertCoverageSummary(summaryUrl, actual);
});

test('current frontier rejects forged baseline identity and terminal queue evidence', () => {
  const coverage = measureCanonicalizerCoverage(loadCoveragePolicy());
  const prerequisite = measureCanonicalizerPrerequisite();
  assertCurrentCanonicalizerFrontier(coverage, prerequisite);
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.prerequisite-summary.future'; },
    (copy) => { copy.baseline.baseId = 'future'; },
    (copy) => { copy.baseline.functionFactsDigest = '0'.repeat(64); },
    (copy) => { copy.outcome = 'bounded-exhaustion'; },
    (copy) => { copy.exhaustion = {}; },
    (copy) => { copy.parameterMigration.migratedParameterRows = 1; },
    (copy) => { copy.parameterMigration.witnesses.push({ id: 'future' }); },
    (copy) => { copy.selectedPrerequisite = {}; },
    (copy) => { Object.setPrototypeOf(copy, { inherited: true }); },
    (copy) => { Object.setPrototypeOf(copy.baseline, { inherited: true }); },
    (copy) => { Object.setPrototypeOf(copy.parameterMigration, { inherited: true }); },
  ]) {
    const copy = structuredClone(prerequisite);
    mutate(copy);
    assert.throws(() => assertCurrentCanonicalizerFrontier(coverage, copy));
  }

  let getterRead = false;
  const accessor = structuredClone(prerequisite);
  Object.defineProperty(accessor.baseline, 'baseId', {
    configurable: true,
    enumerable: true,
    get() {
      getterRead = true;
      return prerequisite.baseline.baseId;
    },
  });
  assert.throws(
    () => assertCurrentCanonicalizerFrontier(coverage, accessor),
    /current prerequisite summary must contain only exact plain JSON data/u,
  );
  assert.equal(getterRead, false);
});

test('the live prerequisite measurement is stable in a fresh process', () => {
  const moduleUrl = new URL('./coverage-prerequisite.mjs', import.meta.url).href;
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import {measureCanonicalizerPrerequisite} from ${JSON.stringify(moduleUrl)}; ` +
      'process.stdout.write(JSON.stringify(measureCanonicalizerPrerequisite()))',
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  const parsed = JSON.parse(fresh.stdout);
  validateCanonicalizerPrerequisiteSummary(parsed);
  assert.deepEqual(parsed, measureCanonicalizerPrerequisite());
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
