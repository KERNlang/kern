import assert from 'node:assert/strict';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM4124ParameterMigration,
  assertM4124ParameterTarget,
  m4124CoverageStatus,
  m4124ParameterMigration,
  M4124_PARAMETER_MIGRATION_TARGET,
} from './coverage-m4-124-parameter-migration.mjs';
import { m4123ParameterMigration } from './coverage-m4-123-kir-depth-promotion.mjs';
import { parameterMigrationRoots } from './coverage-value-band-parameter-migrations.mjs';

function targetFixture() {
  const target = M4124_PARAMETER_MIGRATION_TARGET;
  const root = parameterMigrationRoots([target]).get(target.path)?.[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.124 consumes the exact immutable M4.123 rejectLine queue', () => {
  assert.deepEqual(m4123ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 5,
    witnesses: [{
      id: M4124_PARAMETER_MIGRATION_TARGET.id,
      parameterRows: 5,
      profileRows: { nodes: 8, properties: 15, values: 106 },
      tool: 'checker',
    }],
  });
  assert.equal(
    m4124CoverageStatus(),
    'M4.124 consumes the exact M4.123 1-function/5-row rejectLine queue and advances the ' +
      'cumulative base to 103/112 with 4 legacy-parameter blockers; M4.125 remeasures the ' +
      'bounded residual frontier.',
  );
});

test('M4.124 migrates only rejectLine to five direct parameters', () => {
  const coverage = measureCanonicalizerCoverage();
  assertM4124ParameterMigration(coverage);
  assert.equal(coverage.baseCompleteFunctions, 103);
  assert.equal(coverage.functions.filter(({ excludedProperties }) =>
    excludedProperties.includes('fn.params')).length, 4);
  assert.deepEqual(m4124ParameterMigration(), {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
});

test('M4.124 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture();
  assertM4124ParameterTarget(fixture.root, fixture.fact);
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
    assert.throws(() => assertM4124ParameterTarget(copy.root, copy.fact));
  }
});
