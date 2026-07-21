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
  completeFunctions: 12,
  completeTools: 4,
  migratedParameterRows: 44,
  witnesses: [
    ['examples/capstone-assertion-engine/compare.kern#5:compareTrees', 10, 13, 25, 106, 'assertion-engine'],
    ['examples/capstone-checker-subset/checker-while.kern#3:previousSiblingKind', 3, 10, 18, 77, 'checker'],
    ['examples/capstone-checker-subset/checker-while.kern#7:functionRow', 3, 9, 15, 85, 'checker'],
    ['examples/capstone-checker-subset/checker.kern#10:isForCounter', 5, 13, 21, 104, 'checker'],
    ['examples/capstone-checker-subset/checker.kern#11:isAssigned', 5, 13, 21, 104, 'checker'],
    ['examples/capstone-checker-subset/checker.kern#13:paramOrdinalOf', 5, 12, 20, 96, 'checker'],
    ['examples/capstone-checker-subset/checker.kern#15:argIndexOf', 4, 11, 18, 84, 'checker'],
    ['examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#0:validfirst', 1, 8, 11, 100, 'canonicalizer'],
    ['examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#6:structuralname', 1, 10, 16, 104, 'canonicalizer'],
    ['examples/selfhost-validator/validator.kern#0:charokfirst', 1, 10, 13, 92, 'validator'],
    ['examples/selfhost-validator/validator.kern#16:classrow', 4, 11, 19, 89, 'validator'],
    ['examples/selfhost-validator/validator.kern#8:contained', 2, 9, 13, 73, 'validator'],
  ].map(([id, parameterRows, nodes, properties, values, tool]) => ({
    id,
    parameterRows,
    profileRows: { nodes, properties, values },
    tool,
  })),
};

const EXPECTED_DO_SELECTION = {
  prerequisiteRanking: [{ catalogFacts: 2, family: 'do-statement', occurrences: 176 }],
  ranking: [{
    completeFunctions: 1,
    completeTools: 1,
    families: ['do-statement'],
    migratedParameterRows: 2,
    occurrences: 176,
    witnesses: [{
      id: 'examples/selfhost-validator/validator.kern#14:appendid',
      parameterRows: 2,
      profileRows: { nodes: 9, properties: 16, values: 80 },
      tool: 'validator',
    }],
  }],
};

test('M4.32 exposes the exact 12-function queue and disjoint residual do winner', () => {
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
    (copy) => { copy.parameterMigration.witnesses.pop(); },
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
  overlapping.ranking[0].witnesses[0] = structuredClone(overlapping.parameterMigration.witnesses[0]);
  assert.throws(
    () => validateCanonicalizerPrerequisiteSummary(overlapping),
    /selected format-3 summary must contain a positive winning closure/u,
  );
});

test('M4.32 binds the exact authenticated profile-promotion transition', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.3');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 33,
    baseId: 'kern.kir-canonicalizer.profile.m4.29',
    canonicalizerDigest: 'bf2b2c1f1e8fa85174d72503d836b3a305467af20c560a6e9f037ac616b97bb5',
    canonicalizerPolicyDigest: '9d3229bc2554adf7b49ff2fa0cba8885d156cb2f4e4b3b20fc9094719fc32279',
    compiledCoreDigest: '1c30b1f3a53ee83663a9d46f7152464571ac5be8fdb44f600b087bc78b1e1f54',
    corpusDigest: '5a92fbd4a085bc73827818fd1de0c614e889550b60df7eaa7f6404f31660805e',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: '6c19138011e493a28444fca1899c1c9418b292f30f0aff0ab7e02341d9a50f67',
    familyRegistryDigest: 'a7ea4bdc1af766f893b7491a59c727b0459ecb637a71f9f54d6087ee5baeeb87',
    functionCount: 104,
    functionFactsDigest: 'bcd5f6e2ec5c4b4c15b1329bb7de3ddbd829f4c870e30beaac0b67db19546614',
    legacyParameterBlockers: 69,
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
