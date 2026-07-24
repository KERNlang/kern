import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  generateCheckerMainKern,
  generateNumericMainKern,
} from '../capstone-checker-subset/gen-fixtures-kern.mjs';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM482ParameterMigration,
  assertM482ParameterTarget,
  M482_PARAMETER_MIGRATION_TARGET,
} from './coverage-m4-82-parameter-migration.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM481,
  validatePublishedCanonicalizerPrerequisiteM481,
} from './coverage-prerequisite-m4-81.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function targetFixture() {
  const target = M482_PARAMETER_MIGRATION_TARGET;
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children.filter(({ type }) => type === 'fn')[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.81 publishes the immutable checkWhileCore migration handoff', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM481();
  assert.equal(handoff.digest, 'd41669c95edfab7e6a088abd14841f93fd49ea9c0daa4a0369230effb8859e7d');
  assert.equal(handoff.sourceCommit, 'e8ff7714d21266c8990384c543b96580a028e1f1');
  assert.equal(
    sha256(readFileSync(new URL('./coverage-prerequisite-m4-81.json', import.meta.url))),
    handoff.digest,
  );
  assert.deepEqual(handoff.record.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 22,
    witnesses: [{
      id: M482_PARAMETER_MIGRATION_TARGET.id,
      parameterRows: M482_PARAMETER_MIGRATION_TARGET.parameters.length,
      profileRows: M482_PARAMETER_MIGRATION_TARGET.profileRows,
      tool: 'checker',
    }],
  });
  assert.equal(handoff.record.baseline.baseCompleteFunctions, 81);
  assert.equal(handoff.record.baseline.legacyParameterBlockers, 23);
  assert.equal(handoff.record.exhaustion.residualFunctionCount, 22);
});

test('M4.82 migrates the exact checkWhileCore parameter queue', () => {
  const fixture = targetFixture();
  assertM482ParameterMigration(measureCanonicalizerCoverage());
  assertM482ParameterTarget(fixture.root, fixture.fact, fixture.target);
});

test('M4.82 generated checker consumers reproduce only from repository writers', () => {
  const checkerMain = readFileSync(
    new URL('../../examples/capstone-checker-subset/main.kern', import.meta.url),
    'utf8',
  );
  const numericMain = readFileSync(
    new URL('../../examples/capstone-checker-subset/numeric-main.kern', import.meta.url),
    'utf8',
  );
  assert.equal(checkerMain, generateCheckerMainKern());
  assert.equal(numericMain, generateNumericMainKern());
  assert.equal(sha256(checkerMain), '80bf569b3114daa205f9df594a9a796ec04be92a59be8c27ddb2594fd03667cf');
  assert.equal(sha256(numericMain), '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a');
});

test('M4.82 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture();
  assertM482ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'row:number'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'boolean'; },
    ({ root }) => { root.props.export = 'true'; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'string'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => { root.children.find(({ type }) => type === 'handler').props.lang = 'typescript'; },
    ({ fact }) => { fact.id = `${fact.id}-substituted`; },
    ({ fact }) => { fact.excludedProperties.push('fn.params'); },
    ({ fact }) => { fact.profileBlockers.push('profile.rows.properties'); },
    ({ fact }) => { fact.profileRows.properties += 1; },
    ({ fact }) => { fact.nodeOccurrences.splice(fact.nodeOccurrences.indexOf('param'), 1); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => assertM482ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.81 handoff rejects causal, decorated, and shared-reference drift', () => {
  const record = loadPublishedCanonicalizerPrerequisiteM481().record;
  for (const mutate of [
    (copy) => { copy.baseline.baseCompleteFunctions = 82; },
    (copy) => { copy.parameterMigration.witnesses = []; },
    (copy) => { copy.exhaustion.residualFunctionCount = 21; },
  ]) {
    const copy = structuredClone(record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerPrerequisiteM481(copy),
      /coverage M4\.81 prerequisite rejection/u,
    );
  }
  const decorated = structuredClone(record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM481(decorated),
    /coverage M4\.81 prerequisite rejection/u,
  );
  const shared = structuredClone(record);
  shared.ranking = shared.prerequisiteRanking;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM481(shared),
    /coverage M4\.81 prerequisite rejection/u,
  );
});
