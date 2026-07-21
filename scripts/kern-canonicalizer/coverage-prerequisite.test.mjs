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

test('M4.26 migrates the exact binding parameter-ready tranche', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.2');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 32,
    baseId: 'kern.kir-canonicalizer.profile.m4.25',
    canonicalizerDigest: '5337c271465e710261901af18fe55d19a6e69a62f976d0d0fe44df209c4a2974',
    canonicalizerPolicyDigest: '87463f6a56c75aeffc853c52923312a99b6ff864e9e37afe8d984c5704f917c2',
    compiledCoreDigest: '1c30b1f3a53ee83663a9d46f7152464571ac5be8fdb44f600b087bc78b1e1f54',
    corpusDigest: 'a99e6773a47023bb6b833f6dd34b1d9c475888be99924dac07f13b2c1ba58e7c',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: '9a1175b209c38ee0a56ef2da8ee114170e87455e6a0ccd79a3f838dd8558e653',
    familyRegistryDigest: 'a7ea4bdc1af766f893b7491a59c727b0459ecb637a71f9f54d6087ee5baeeb87',
    functionCount: 104,
    functionFactsDigest: '68a20ac32504a4c079e778b75dd613a224a1d03113ba31db41bd3c2a880d127f',
    legacyParameterBlockers: 70,
    profileDigest: '366123a03fa2d444347f740b77a53e0a8b1b9de668fd681c5167ce1365c97dd7',
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
    { catalogFacts: 1, family: 'unary-expression', occurrences: 48 },
  ]);
  assert.deepEqual(actual.ranking, [
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
    catalogFacts: 1,
    family: 'unary-expression',
    occurrences: 48,
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
