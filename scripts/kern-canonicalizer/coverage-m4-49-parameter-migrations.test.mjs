import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { generateCheckerMainKern } from '../capstone-checker-subset/gen-fixtures-kern.mjs';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM449ParameterMigrations,
  assertM449ParameterTarget,
  M449_PARAMETER_MIGRATION_TARGETS,
} from './coverage-m4-49-parameter-migrations.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM448,
  validatePublishedCanonicalizerPrerequisiteM448,
} from './coverage-prerequisite-m4-48.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { createCanonicalizerComposition, verifyCanonicalizerComposition } from './composition.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function targetFixture(name) {
  const target = M449_PARAMETER_MIGRATION_TARGETS.find((entry) => entry.name === name);
  assert.ok(target);
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children.filter(({ type }) => type === 'fn')[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.76 preserves the exact M4.49 parameter migrations while exposing the next queue', () => {
  const coverage = measureCanonicalizerCoverage();
  assertM449ParameterMigrations(coverage);
  assert.equal(coverage.baseCompleteFunctions, 79);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) => excludedProperties.includes('fn.params')).length,
    24,
  );
  assert.deepEqual(loadCanonicalizerPolicy().profileLimits, {
    maxNodeRows: 38,
    maxPropertyRows: 53,
    maxValueRows: 461,
  });
  const prerequisite = measureCanonicalizerPrerequisite();
  assert.deepEqual({
    completeFunctions: prerequisite.parameterMigration.completeFunctions,
    completeTools: prerequisite.parameterMigration.completeTools,
    migratedParameterRows: prerequisite.parameterMigration.migratedParameterRows,
    witnesses: prerequisite.parameterMigration.witnesses.map(({ id }) => id),
  }, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 6,
    witnesses: ['examples/kern-canonicalizer/canonicalizer.kern#0:typesource'],
  });
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.deepEqual(prerequisite.exhaustion.activeFamilies, ['exception-flow']);
});

test('M4.49 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture('isUserCallable');
  assertM449ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'name:string'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'string'; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'number'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => { root.children.find(({ type }) => type === 'handler').props.lang = 'typescript'; },
    ({ fact }) => { fact.id = `${fact.id}-substituted`; },
    ({ fact }) => { fact.excludedProperties.push('fn.params'); },
    ({ fact }) => { fact.profileBlockers.push('profile.rows.values'); },
    ({ fact }) => { fact.profileRows.values += 1; },
    ({ fact }) => { fact.nodeOccurrences.splice(fact.nodeOccurrences.indexOf('param'), 1); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => assertM449ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.49 generated consumers reproduce only from repository writers', () => {
  const checkerMain = readFileSync(
    new URL('../../examples/capstone-checker-subset/main.kern', import.meta.url),
  );
  assert.equal(checkerMain.toString('utf8'), generateCheckerMainKern());
  assert.equal(sha256(checkerMain), 'c73f0356534ee83eac5d81609d178fcbc67709a0c3ca291a62f79eeb9ad19c2e');
  const built = createCanonicalizerComposition();
  const verified = verifyCanonicalizerComposition();
  assert.equal(built.compositeBytes.length, 50_719);
  assert.equal(
    sha256(built.compositeBytes),
    'c1b42e6183731a757cdad7150339ec38090c11aeaa6404095ae16f34412a3b89',
  );
  assert.ok(built.compositeBytes.equals(verified.compositeBytes));
  assert.deepEqual(built.record, verified.record);
});

test('M4.48 prerequisite handoff remains exact and rejects hidden drift', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM448();
  assert.equal(handoff.digest, 'fbc4b671f665d1ed2ebb709201a4c3f4be27d9cec4f18708ce7130fd2b2a7b0a');
  assert.equal(handoff.sourceCommit, 'c16ab453b49d850d58022160a577c23eb70a2142');
  assert.equal(handoff.record.baseline.baseCompleteFunctions, 60);
  assert.equal(handoff.record.baseline.legacyParameterBlockers, 43);
  assert.equal(handoff.record.exhaustion.residualFunctionCount, 39);
  assert.deepEqual(
    handoff.record.parameterMigration.witnesses.map(({ id }) => id),
    M449_PARAMETER_MIGRATION_TARGETS.map(({ id }) => id),
  );

  for (const mutate of [
    (copy) => { copy.baseline.baseCompleteFunctions = 64; },
    (copy) => { copy.parameterMigration.witnesses.reverse(); },
    (copy) => { copy.exhaustion.residualFunctionCount = 38; },
  ]) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerPrerequisiteM448(copy),
      /coverage M4\.48 prerequisite rejection/u,
    );
  }
  const decorated = structuredClone(handoff.record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM448(decorated),
    /coverage M4\.48 prerequisite rejection/u,
  );
});
