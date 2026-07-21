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

test('M4.18 collapses the live prerequisite to counted iteration alone', () => {
  const actual = measureCanonicalizerPrerequisite();
  assert.equal(actual.format, 'kern.kir-canonicalizer.prerequisite-summary.1');
  assert.deepEqual(actual.baseline, {
    baseCompleteFunctions: 21,
    baseId: 'kern.kir-canonicalizer.profile.m4.18',
    canonicalizerDigest: '37b081f3ff01320b96cf7482d096999f4121429d700e8f8fe0852f2f8e1e9308',
    canonicalizerPolicyDigest: '87463f6a56c75aeffc853c52923312a99b6ff864e9e37afe8d984c5704f917c2',
    compiledCoreDigest: '1c30b1f3a53ee83663a9d46f7152464571ac5be8fdb44f600b087bc78b1e1f54',
    corpusDigest: 'c1f9c8f75d2f714b850c3851be4547289876f10e2896b6b9a5ab5e4b6fec43ef',
    coverageImplementationDigest: actual.baseline.coverageImplementationDigest,
    coveragePolicyDigest: 'd317f1368761e24b64025ef9cfccb1571acf387cf0021a6e5721d245f3f5ba17',
    familyRegistryDigest: 'a7ea4bdc1af766f893b7491a59c727b0459ecb637a71f9f54d6087ee5baeeb87',
    functionCount: 104,
    functionFactsDigest: '26af920d9b7627417e0696892b5f7fe1dc2b99d2db4d4c2584ac828329038096',
    legacyParameterBlockers: 81,
    profileDigest: 'a147a2a25ca0126e35edc2b0e4973608863fd38ac806cc3a99c17fe8a6fdec75',
    toolCount: 4,
  });
  assert.match(actual.baseline.coverageImplementationDigest, /^[0-9a-f]{64}$/u);
  assert.equal(actual.minimumFamilyCount, 1);
  assert.deepEqual(actual.prerequisiteRanking, [
    { catalogFacts: 4, family: 'counted-iteration', occurrences: 468 },
  ]);
  assert.deepEqual(actual.ranking, [
    {
      completeFunctions: 6,
      completeTools: 3,
      families: ['counted-iteration'],
      migratedParameterRows: 14,
      occurrences: 468,
      witnesses: [
        {
          id: 'examples/capstone-checker-subset/checker-while.kern#4:hasDirectChild',
          parameterRows: 2,
          profileRows: { nodes: 8, properties: 13, values: 53 },
          tool: 'checker',
        },
        {
          id: 'examples/capstone-checker-subset/checker-while.kern#6:subtreeEnd',
          parameterRows: 2,
          profileRows: { nodes: 9, properties: 14, values: 70 },
          tool: 'checker',
        },
        {
          id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#8:stringat',
          parameterRows: 2,
          profileRows: { nodes: 8, properties: 14, values: 62 },
          tool: 'canonicalizer',
        },
        {
          id: 'examples/selfhost-validator/validator.kern#13:containsid',
          parameterRows: 2,
          profileRows: { nodes: 8, properties: 14, values: 54 },
          tool: 'validator',
        },
        {
          id: 'examples/selfhost-validator/validator.kern#6:rootpath',
          parameterRows: 3,
          profileRows: { nodes: 9, properties: 16, values: 66 },
          tool: 'validator',
        },
        {
          id: 'examples/selfhost-validator/validator.kern#7:statusof',
          parameterRows: 3,
          profileRows: { nodes: 9, properties: 16, values: 66 },
          tool: 'validator',
        },
      ],
    },
  ]);
  assert.deepEqual(actual.selectedPrerequisite, {
    catalogFacts: 4,
    family: 'counted-iteration',
    occurrences: 468,
  });
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
