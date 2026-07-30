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

test('M4.142 exhausts structural families after consuming the canonicalize queue', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.equal(actual.outcome, 'bounded-exhaustion');
  assert.equal(actual.minimumFamilyCount, null);
  assert.equal(actual.selectedPrerequisite, null);
  assert.deepEqual(actual.parameterMigration, EXPECTED_PARAMETER_MIGRATION);
  assert.deepEqual(actual.prerequisiteRanking, []);
  assert.deepEqual(actual.ranking, []);
  assert.deepEqual(actual.exhaustion.activeFamilies, []);
  assert.equal(actual.exhaustion.residualFunctionCount, 2);
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

test('M4.142 publishes the exact current terminal structural frontier', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 110,
    baseId: 'kern.kir-canonicalizer.profile.m4.141',
    canonicalizerDigest: '9e7ecb330e665b7bf2a0d7e13d78f4cf3c0b9e5b27a799bdafbabd0e18ca770a',
    canonicalizerPolicyDigest: '54d5a78b40f47e1ca1bfdbf1a7d3836c756aae1ace22ff0245d008af78178ff4',
    compiledCoreDigest: '29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2',
    corpusDigest: '923813c69d6f7e8cdb15e68237e61f155ab7bca0f764102cfeb29b5071288c89',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: '3512347baf3870f21b879b632041eea72ffea304e037f0a26fcf720cbe596877',
    familyRegistryDigest: '2be9640b87d863298e5fa93704d526d8b09f58a5c4eed78a46cb8213cca56df8',
    functionCount: 112,
    functionFactsDigest: '72c677544b56de4b6e714d0f124f88f7f3db811b6442aeb6c8cb405ad7b9998f',
    legacyParameterBlockers: 2,
    profileDigest: 'fe14493f42136a4c6d5593b0ec6eb8c5c96c89076264cbdb961e8c2e03acb44b',
    toolCount: 4,
  });
  assert.match(actual.baseline.compiledCoreDigest, /^[0-9a-f]{64}$/u);
  assert.match(actual.baseline.functionFactsDigest, /^[0-9a-f]{64}$/u);
  assert.match(actual.baseline.coverageImplementationDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(actual.parameterMigration, EXPECTED_PARAMETER_MIGRATION);
  assert.equal(actual.selectedPrerequisite, null);
  assert.equal(
    actual.exhaustion.reasonAssignmentsDigest,
    '1da9a57ec132a8147f75ab0d252e188aa86b2744b23d58cf3dfa3510b7bcc106',
  );
  const readyIds = new Set(actual.parameterMigration.witnesses.map(({ id }) => id));
  assert.deepEqual([...readyIds], []);
  const checkedIn = JSON.parse(readFileSync(summaryUrl, 'utf8'));
  assert.deepEqual(actual, checkedIn);
  assertCoverageSummary(summaryUrl, actual);
});

test('current frontier rejects forged baseline identity and exhaustion evidence', () => {
  const coverage = measureCanonicalizerCoverage(loadCoveragePolicy());
  const prerequisite = measureCanonicalizerPrerequisite();
  assertCurrentCanonicalizerFrontier(coverage, prerequisite);
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.prerequisite-summary.future'; },
    (copy) => { copy.baseline.baseId = 'future'; },
    (copy) => { copy.baseline.functionFactsDigest = '0'.repeat(64); },
    (copy) => { copy.exhaustion.reasonAssignmentsDigest = '0'.repeat(64); },
    (copy) => { copy.exhaustion.reasonCounts[0].id = 'future'; },
    (copy) => { copy.exhaustion.completingClosureCount = 1; },
    (copy) => { Object.defineProperty(copy.exhaustion, 'future', { value: true }); },
    (copy) => { Object.setPrototypeOf(copy, { inherited: true }); },
    (copy) => { Object.setPrototypeOf(copy.baseline, { inherited: true }); },
    (copy) => { Object.setPrototypeOf(copy.exhaustion, { inherited: true }); },
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
