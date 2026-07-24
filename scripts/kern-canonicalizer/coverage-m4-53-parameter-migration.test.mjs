import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { generateCheckerMainKern, generateNumericMainKern } from '../capstone-checker-subset/gen-fixtures-kern.mjs';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM453ParameterMigration,
  assertM453ParameterTarget,
  M453_PARAMETER_MIGRATION_TARGET,
} from './coverage-m4-53-parameter-migration.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM452,
  validatePublishedCanonicalizerPrerequisiteM452,
} from './coverage-prerequisite-m4-52.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function targetFixture() {
  const source = readFileSync(new URL('../../examples/selfhost-validator/validator.kern', import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children.filter(({ type }) => type === 'fn')[17];
  const fact = measureCanonicalizerCoverage().functions.find(
    ({ id }) => id === M453_PARAMETER_MIGRATION_TARGET.id,
  );
  return { fact, root, target: M453_PARAMETER_MIGRATION_TARGET };
}

test('M4.77 preserves the exact M4.53 parameter migration after consuming the queue', () => {
  const coverage = measureCanonicalizerCoverage();
  assertM453ParameterMigration(coverage);
  assert.equal(coverage.baseCompleteFunctions, 80);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) => excludedProperties.includes('fn.params')).length,
    23,
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
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.deepEqual(prerequisite.exhaustion.activeFamilies, ['exception-flow']);
});

test('M4.53 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture();
  assertM453ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'module:number'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'number'; },
    ({ root }) => { root.props.export = 'false'; },
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
    assert.throws(() => assertM453ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.53 generated consumers reproduce only from repository writers', () => {
  const checkerMain = readFileSync(
    new URL('../../examples/capstone-checker-subset/main.kern', import.meta.url),
  );
  const numericMain = readFileSync(
    new URL('../../examples/capstone-checker-subset/numeric-main.kern', import.meta.url),
  );
  assert.equal(checkerMain.toString('utf8'), generateCheckerMainKern());
  assert.equal(numericMain.toString('utf8'), generateNumericMainKern());
  assert.match(sha256(checkerMain), /^[0-9a-f]{64}$/u);
  assert.equal(sha256(numericMain), '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a');
});

test('M4.52 prerequisite handoff remains exact and rejects hidden drift', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM452();
  assert.equal(handoff.digest, '220becc58afa59bb35f1fef2246038d7c7763b49db65d615f6c5725c87659c76');
  assert.equal(handoff.sourceCommit, '99905b044c3d981998a3beef846da283dac4a94c');
  assert.equal(handoff.record.baseline.baseCompleteFunctions, 64);
  assert.equal(handoff.record.baseline.legacyParameterBlockers, 39);
  assert.equal(handoff.record.exhaustion.residualFunctionCount, 38);
  assert.deepEqual(handoff.record.parameterMigration.witnesses.map(({ id }) => id), [
    M453_PARAMETER_MIGRATION_TARGET.id,
  ]);

  for (const mutate of [
    (copy) => { copy.baseline.baseCompleteFunctions = 65; },
    (copy) => { copy.parameterMigration.witnesses = []; },
    (copy) => { copy.exhaustion.residualFunctionCount = 37; },
  ]) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerPrerequisiteM452(copy),
      /coverage M4\.52 prerequisite rejection/u,
    );
  }
  const decorated = structuredClone(handoff.record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM452(decorated),
    /coverage M4\.52 prerequisite rejection/u,
  );
});
