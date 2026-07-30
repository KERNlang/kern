import assert from 'node:assert/strict';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM4147ParameterMigration,
  assertM4147ParameterTarget,
  m4147ParameterMigration,
} from './coverage-m4-147-parameter-migration.mjs';
import { parameterMigrationRoots } from './coverage-value-band-parameter-migrations.mjs';
import {
  EXPRESSIONSOURCES_PARAMETER_TARGET_M4147,
} from './expressionsources-parameter-target.mjs';

test('M4.147 migrates only expressionsources to the exact direct parameter sequence', () => {
  assert.equal(
    assertM4147ParameterMigration(measureCanonicalizerCoverage()),
    'M4.147 consumes the exact M4.146 1-function/6-row expressionsources queue and ' +
      'advances the cumulative base to 111/112 with 1 legacy-parameter blocker and an ' +
      'empty parameter queue; M4.148 remeasures the bounded quotesource residual frontier.',
  );
  assert.deepEqual(m4147ParameterMigration(), {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
});

test('M4.147 target evidence is recursively immutable', () => {
  const target = EXPRESSIONSOURCES_PARAMETER_TARGET_M4147;
  assert.equal(Object.isFrozen(target), true);
  assert.equal(Object.isFrozen(target.parameters), true);
  assert.equal(Object.isFrozen(target.profileRows), true);
  assert.equal(target.parameters.every((parameter) => Object.isFrozen(parameter)), true);
  assert.throws(() => { target.parameters[0][0] = 'substituted'; }, TypeError);
  assert.throws(() => { target.parameters.push(['future', 'string']); }, TypeError);
  assert.throws(() => { target.profileRows.nodes += 1; }, TypeError);
});

test('M4.147 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const target = EXPRESSIONSOURCES_PARAMETER_TARGET_M4147;
  const root = parameterMigrationRoots([target]).get(target.path)?.[target.functionOrdinal];
  const coverage = measureCanonicalizerCoverage();
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM4147ParameterTarget(root, fact);
  const mutations = [
    (copy) => { copy.root.props.params = 'valueTag:string[]'; },
    (copy) => { copy.root.props.name = 'substituted'; },
    (copy) => { copy.root.props.returns = 'string'; },
    (copy) => { copy.root.props.export = undefined; },
    (copy) => { copy.root.children[0].props.name = 'renamed'; },
    (copy) => { copy.root.children[0].props.type = 'string'; },
    (copy) => { copy.root.children.unshift(structuredClone(copy.root.children[0])); },
    (copy) => { copy.root.children.push(copy.root.children.shift()); },
    (copy) => {
      copy.root.children.find(({ type }) => type === 'handler')
        .children[0].props.value = 'new Set()';
    },
    (copy) => { copy.fact.id = `${copy.fact.id}-substituted`; },
    (copy) => { copy.fact.excludedProperties.push('fn.params'); },
    (copy) => { copy.fact.profileBlockers.push('profile.rows.nodes'); },
    (copy) => { copy.fact.profileRows.nodes += 1; },
    (copy) => {
      copy.fact.nodeOccurrences.splice(copy.fact.nodeOccurrences.indexOf('param'), 1);
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone({ fact, root });
    mutate(copy);
    assert.throws(() => assertM4147ParameterTarget(copy.root, copy.fact));
  }
});
