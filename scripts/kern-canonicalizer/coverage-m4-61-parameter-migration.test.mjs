import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM461ParameterMigration,
  assertM461ParameterTarget,
  M461_PARAMETER_MIGRATION_TARGET,
} from './coverage-m4-61-parameter-migration.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM460,
  validatePublishedCanonicalizerPrerequisiteM460,
} from './coverage-prerequisite-m4-60.mjs';

function targetFixture() {
  const target = M461_PARAMETER_MIGRATION_TARGET;
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children.filter(({ type }) => type === 'fn')[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.61 migrates the exact sortstrings parameter row', () => {
  const fixture = targetFixture();
  assertM461ParameterMigration(measureCanonicalizerCoverage());
  assertM461ParameterTarget(fixture.root, fixture.fact, fixture.target);
});

test('M4.61 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture();
  assertM461ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'xs:string[]'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'string'; },
    ({ root }) => { root.props.export = 'false'; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'number[]'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => { root.children.find(({ type }) => type === 'handler').props.lang = 'typescript'; },
    ({ root }) => { root.children.find(({ type }) => type === 'handler').children[0].props.value = '["changed"]'; },
    ({ fact }) => { fact.id = `${fact.id}-substituted`; },
    ({ fact }) => { fact.excludedProperties.push('fn.params'); },
    ({ fact }) => { fact.profileBlockers.push('profile.rows.values'); },
    ({ fact }) => { fact.profileRows.values += 1; },
    ({ fact }) => { fact.nodeOccurrences.splice(fact.nodeOccurrences.indexOf('param'), 1); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => assertM461ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.60 publishes exactly the immutable one-row sortstrings migration handoff', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM460();
  const prerequisite = handoff.record;
  assert.equal(handoff.digest, 'c24a3f59fab134a0845980550196f5d843c05d28986ea68a6e31642e3577dfdf');
  assert.equal(handoff.sourceCommit, '828283e9694db3017dfc0121b6db8d6420f3988a');
  assert.deepEqual(prerequisite.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 1,
    witnesses: [{
      id: M461_PARAMETER_MIGRATION_TARGET.id,
      parameterRows: 1,
      profileRows: M461_PARAMETER_MIGRATION_TARGET.profileRows,
      tool: 'validator',
    }],
  });
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.deepEqual(prerequisite.exhaustion.activeFamilies, ['exception-flow']);

  for (const mutate of [
    (copy) => { copy.baseline.baseCompleteFunctions = 73; },
    (copy) => { copy.parameterMigration.witnesses = []; },
    (copy) => { copy.exhaustion.activeFamilies = []; },
  ]) {
    const copy = structuredClone(prerequisite);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerPrerequisiteM460(copy),
      /coverage M4\.60 prerequisite rejection/u,
    );
  }
  const decorated = structuredClone(prerequisite);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM460(decorated),
    /coverage M4\.60 prerequisite rejection/u,
  );
});
