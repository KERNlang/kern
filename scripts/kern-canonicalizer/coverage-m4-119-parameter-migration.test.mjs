import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { generateCheckerMainKern } from '../capstone-checker-subset/gen-fixtures-kern.mjs';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM4119ParameterMigration,
  assertM4119ParameterTarget,
  M4119_PARAMETER_MIGRATION_TARGET,
} from './coverage-m4-119-parameter-migration.mjs';
import { m4118ParameterMigration } from './coverage-m4-118-triple-row-promotion.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { parameterMigrationRoots } from './coverage-value-band-parameter-migrations.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function targetFixture() {
  const target = M4119_PARAMETER_MIGRATION_TARGET;
  const root = parameterMigrationRoots([target]).get(target.path)?.[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.119 consumes the exact immutable M4.118 checkModule queue', () => {
  assert.deepEqual(m4118ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 58,
    witnesses: [{
      id: M4119_PARAMETER_MIGRATION_TARGET.id,
      parameterRows: 58,
      profileRows: { nodes: 122, properties: 193, values: 2411 },
      tool: 'checker',
    }],
  });
});

test('M4.119 migrates only checkModule to 58 direct parameters', () => {
  const coverage = measureCanonicalizerCoverage();
  const prerequisite = measureCanonicalizerPrerequisite();
  assertM4119ParameterMigration(coverage);
  assert.equal(coverage.baseCompleteFunctions, 102);
  assert.equal(coverage.functions.filter(({ excludedProperties }) =>
    excludedProperties.includes('fn.params')).length, 5);
  assert.deepEqual(prerequisite.parameterMigration, {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 5);
});

test('M4.119 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture();
  assertM4119ParameterTarget(fixture.root, fixture.fact);
  const mutations = [
    ({ root }) => { root.props.params = 'path:string'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'boolean'; },
    ({ root }) => { root.props.export = undefined; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'number'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => {
      root.children.find(({ type }) => type === 'handler').children[0].props.value = '["drift"]';
    },
    ({ fact }) => { fact.id = `${fact.id}-substituted`; },
    ({ fact }) => { fact.excludedProperties.push('fn.params'); },
    ({ fact }) => { fact.profileBlockers.push('profile.rows.nodes'); },
    ({ fact }) => { fact.profileRows.nodes += 1; },
    ({ fact }) => { fact.nodeOccurrences.splice(fact.nodeOccurrences.indexOf('param'), 1); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => assertM4119ParameterTarget(copy.root, copy.fact));
  }
});

test('M4.119 generated checker fixture reproduces from the repository writer', () => {
  const target = M4119_PARAMETER_MIGRATION_TARGET;
  const checker = readFileSync(new URL('../../examples/capstone-checker-subset/checker.kern', import.meta.url));
  const main = readFileSync(new URL('../../examples/capstone-checker-subset/main.kern', import.meta.url));
  assert.equal(main.toString('utf8'), generateCheckerMainKern());
  assert.equal(sha256(checker), target.sourceSha256);
});
