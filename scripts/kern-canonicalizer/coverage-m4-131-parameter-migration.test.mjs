import assert from 'node:assert/strict';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM4131ParameterMigration,
  assertM4131ParameterTarget,
  m4131CoverageStatus,
  m4131ParameterMigration,
  M4131_PARAMETER_MIGRATION_TARGET,
} from './coverage-m4-131-parameter-migration.mjs';
import { m4130ParameterMigration } from './coverage-m4-130-combined-promotion.mjs';
import { parameterMigrationRoots } from './coverage-value-band-parameter-migrations.mjs';

function targetFixture() {
  const target = M4131_PARAMETER_MIGRATION_TARGET;
  const root = parameterMigrationRoots([target]).get(target.path)?.[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.131 consumes the exact immutable M4.130 validate queue', () => {
  assert.deepEqual(m4130ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 41,
    witnesses: [{
      id: M4131_PARAMETER_MIGRATION_TARGET.id,
      parameterRows: 41,
      profileRows: { nodes: 202, properties: 308, values: 4_493 },
      tool: 'validator',
    }],
  });
  assert.equal(
    m4131CoverageStatus(),
    'M4.131 consumes the exact M4.130 1-function/41-row validate queue and advances the ' +
      'cumulative base to 104/112 with 3 legacy-parameter blockers; M4.132 remeasures the ' +
      'bounded residual frontier.',
  );
});

test('M4.131 migrates only validate to 41 direct parameters', () => {
  const coverage = measureCanonicalizerCoverage();
  assertM4131ParameterMigration(coverage);
  assert.equal(coverage.baseCompleteFunctions, 109);
  assert.equal(coverage.functions.filter(({ excludedProperties }) =>
    excludedProperties.includes('fn.params')).length, 3);
  assert.deepEqual(m4131ParameterMigration(), {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
});

test('M4.131 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture();
  assertM4131ParameterTarget(fixture.root, fixture.fact);
  const mutations = [
    ({ root }) => { root.props.params = 'schemaVersion:number'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'string'; },
    ({ root }) => { root.props.export = undefined; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'string'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => {
      root.children.find(({ type }) => type === 'handler').children[0].props.value = '"drift"';
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
    assert.throws(() => assertM4131ParameterTarget(copy.root, copy.fact));
  }
});
