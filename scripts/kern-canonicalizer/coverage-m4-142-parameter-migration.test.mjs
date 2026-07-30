import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICALIZE_PARAMETER_TARGET_M4142,
} from './canonicalize-parameter-target.mjs';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM4142ParameterMigration,
  assertM4142ParameterTarget,
  m4142ParameterMigration,
} from './coverage-m4-142-parameter-migration.mjs';
import { parameterMigrationRoots } from './coverage-value-band-parameter-migrations.mjs';

test('M4.142 migrates only canonicalize to the exact direct parameter sequence', () => {
  assert.equal(
    assertM4142ParameterMigration(measureCanonicalizerCoverage()),
    'M4.142 consumes the exact M4.141 1-function/15-row canonicalize queue and advances ' +
      'the cumulative base to 110/112 with 2 legacy-parameter blockers and an empty parameter ' +
      'queue; M4.143 remeasures the bounded residual frontier.',
  );
  assert.deepEqual(m4142ParameterMigration(), {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
});

test('M4.142 target evidence is recursively immutable', () => {
  const target = CANONICALIZE_PARAMETER_TARGET_M4142;
  assert.equal(Object.isFrozen(target), true);
  assert.equal(Object.isFrozen(target.parameters), true);
  assert.equal(Object.isFrozen(target.profileRows), true);
  assert.equal(target.parameters.every((parameter) => Object.isFrozen(parameter)), true);
  assert.throws(() => { target.parameters[0][0] = 'substituted'; }, TypeError);
  assert.throws(() => { target.parameters.push(['future', 'string']); }, TypeError);
  assert.throws(() => { target.profileRows.nodes += 1; }, TypeError);
});

test('M4.142 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const target = CANONICALIZE_PARAMETER_TARGET_M4142;
  const root = parameterMigrationRoots([target]).get(target.path)?.[target.functionOrdinal];
  const coverage = measureCanonicalizerCoverage();
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM4142ParameterTarget(root, fact);
  const mutations = [
    (copy) => { copy.root.props.params = 'nodeKind:string[]'; },
    (copy) => { copy.root.props.name = 'substituted'; },
    (copy) => { copy.root.props.returns = 'string'; },
    (copy) => { copy.root.props.export = undefined; },
    (copy) => { copy.root.children[0].props.name = 'renamed'; },
    (copy) => { copy.root.children[0].props.type = 'string'; },
    (copy) => { copy.root.children.unshift(structuredClone(copy.root.children[0])); },
    (copy) => { copy.root.children.push(copy.root.children.shift()); },
    (copy) => {
      copy.root.children.find(({ type }) => type === 'handler')
        .children[0].props.cond = 'false';
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
    assert.throws(() => assertM4142ParameterTarget(copy.root, copy.fact));
  }
});
