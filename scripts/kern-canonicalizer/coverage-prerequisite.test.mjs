import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  measureCanonicalizerPrerequisite,
  migrateLegacyFunctionForPrerequisite,
  parseLegacyParametersForPrerequisite,
} from './coverage-prerequisite.mjs';
import { assertCoverageSummary } from './coverage-summary-writer.mjs';

const summaryUrl = new URL('./coverage-prerequisite-summary.json', import.meta.url);

test('M4.22 consumes the frozen parameter-ready tranche and preserves residual ranking', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.2');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 27,
    baseId: 'kern.kir-canonicalizer.profile.m4.21',
    canonicalizerDigest: '0eb8771b873f1b44f7dbe8754b27f159268da5115dcf288e59a627d62f366064',
    canonicalizerPolicyDigest: '87463f6a56c75aeffc853c52923312a99b6ff864e9e37afe8d984c5704f917c2',
    compiledCoreDigest: '1c30b1f3a53ee83663a9d46f7152464571ac5be8fdb44f600b087bc78b1e1f54',
    corpusDigest: 'e612418828f0636e3fb2843e1c57fb5bf6cd26bdfc3f547b1cb9aa7e6e813394',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: '7651b89e6a37025994a5bd5700f702508da6272c6aa66a47852633f021d4e5b7',
    familyRegistryDigest: 'a7ea4bdc1af766f893b7491a59c727b0459ecb637a71f9f54d6087ee5baeeb87',
    functionCount: 104,
    functionFactsDigest: 'bcabf9e047a9eae9c7fc24bfebfd7442b568436eada1c6307da32eb0df5ea2b7',
    legacyParameterBlockers: 75,
    profileDigest: 'fb441ef45e9efaf6124537e15fc73a87b9f63249ba7d555bb8c6360e162cb8af',
    toolCount: 4,
  });
  assert.match(actual.baseline.coverageImplementationDigest, /^[0-9a-f]{64}$/u);
  assert.equal(actual.minimumFamilyCount, 1);
  assert.deepEqual(actual.parameterMigration, {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
  assert.deepEqual(actual.prerequisiteRanking, [
    { catalogFacts: 6, family: 'binding', occurrences: 801 },
  ]);
  assert.deepEqual(actual.ranking, [
    {
      completeFunctions: 5,
      completeTools: 2,
      families: ['binding'],
      migratedParameterRows: 9,
      occurrences: 801,
      witnesses: [
        {
          id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#11:childcount',
          parameterRows: 2,
          profileRows: { nodes: 9, properties: 17, values: 71 },
          tool: 'canonicalizer',
        },
        {
          id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#13:valuechildcount',
          parameterRows: 2,
          profileRows: { nodes: 9, properties: 17, values: 71 },
          tool: 'canonicalizer',
        },
        {
          id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#7:propcount',
          parameterRows: 2,
          profileRows: { nodes: 9, properties: 17, values: 71 },
          tool: 'canonicalizer',
        },
        {
          id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#0:indentation',
          parameterRows: 1,
          profileRows: { nodes: 7, properties: 14, values: 42 },
          tool: 'canonicalizer',
        },
        {
          id: 'examples/selfhost-validator/validator.kern#9:paramcount',
          parameterRows: 2,
          profileRows: { nodes: 9, properties: 17, values: 71 },
          tool: 'validator',
        },
      ],
    },
    {
      completeFunctions: 1,
      completeTools: 1,
      families: ['unary-expression'],
      migratedParameterRows: 2,
      occurrences: 48,
      witnesses: [
        {
          id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#9:numberat',
          parameterRows: 2,
          profileRows: { nodes: 8, properties: 14, values: 66 },
          tool: 'canonicalizer',
        },
      ],
    },
  ]);
  assert.deepEqual(actual.selectedPrerequisite, {
    catalogFacts: 6,
    family: 'binding',
    occurrences: 801,
  });
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
