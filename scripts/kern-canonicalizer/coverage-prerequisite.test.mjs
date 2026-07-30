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

test('M4.147 consumes the expressionsources queue at the exhausted structural frontier', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.equal(actual.outcome, 'bounded-exhaustion');
  assert.equal(actual.minimumFamilyCount, null);
  assert.equal(actual.selectedPrerequisite, null);
  assert.deepEqual(actual.parameterMigration, EXPECTED_PARAMETER_MIGRATION);
  assert.deepEqual(actual.prerequisiteRanking, []);
  assert.deepEqual(actual.ranking, []);
  assert.deepEqual(actual.exhaustion.activeFamilies, []);
  assert.equal(actual.exhaustion.residualFunctionCount, 1);
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

test('M4.147 publishes the exact current terminal structural frontier', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 111,
    baseId: 'kern.kir-canonicalizer.profile.m4.141',
    canonicalizerDigest: '836e71de0c456247fdd8e5725d388aeb0f60853083616f82666d2fd2c191d266',
    canonicalizerPolicyDigest: '13d9315aeaf7ffa89ec17ad86b01e39e4a7084657000beb11f8bd0d478b21db7',
    compiledCoreDigest: '29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2',
    corpusDigest: '8308f89b292ed823e8b551e0533c550008ee98ba5f817081ae4c9919421a3b6c',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: '28b76e1260febf3e518a2a6d97b11f96bf202fcce149fb201b92b5b0a5d98019',
    familyRegistryDigest: '2be9640b87d863298e5fa93704d526d8b09f58a5c4eed78a46cb8213cca56df8',
    functionCount: 112,
    functionFactsDigest: '8a75842adba91baaeb54c959bbd2647dab0165817dfa7a2e1d341efc914adc54',
    legacyParameterBlockers: 1,
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
    'e953208c40e51714c3e0338455f67437fb6a6fda6c3f9fb42df0870dda003720',
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
