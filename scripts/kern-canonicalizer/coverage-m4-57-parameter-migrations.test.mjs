import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { generateMainKern as generateAssertionMainKern } from '../capstone/gen-fixtures-kern.mjs';
import {
  generateCheckerMainKern,
  generateNumericMainKern,
} from '../capstone-checker-subset/gen-fixtures-kern.mjs';
import { generateMainKern as generateValidatorMainKern } from '../selfhost-validator/gen-fixtures-kern.mjs';
import { createCanonicalizerComposition, verifyCanonicalizerComposition } from './composition.mjs';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM457ParameterMigrations,
  assertM457ParameterTarget,
  M457_PARAMETER_MIGRATION_TARGETS,
} from './coverage-m4-57-parameter-migrations.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM456,
  validatePublishedCanonicalizerPrerequisiteM456,
} from './coverage-prerequisite-m4-56.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function targetFixture(name) {
  const target = M457_PARAMETER_MIGRATION_TARGETS.find((entry) => entry.name === name);
  assert.ok(target);
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children.filter(({ type }) => type === 'fn')[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.77 preserves the exact M4.57 parameter migrations after consuming the queue', () => {
  const coverage = measureCanonicalizerCoverage();
  assertM457ParameterMigrations(coverage);
  assert.equal(coverage.baseCompleteFunctions, 80);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) =>
      excludedProperties.includes('fn.params')).length,
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
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.ranking, []);
  assert.deepEqual(prerequisite.exhaustion.activeFamilies, ['exception-flow']);
  assert.equal(prerequisite.exhaustion.residualFunctionCount, 23);
});

test('M4.57 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture('checkerWhileRejectDetail');
  assertM457ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'row:number'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'boolean'; },
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
    assert.throws(() => assertM457ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.57 generated consumers reproduce only from repository writers', () => {
  const checkerMain = readFileSync(
    new URL('../../examples/capstone-checker-subset/main.kern', import.meta.url),
  );
  const numericMain = readFileSync(
    new URL('../../examples/capstone-checker-subset/numeric-main.kern', import.meta.url),
  );
  const validatorMain = readFileSync(
    new URL('../../examples/selfhost-validator/main.kern', import.meta.url),
  );
  const assertionMain = readFileSync(
    new URL('../../examples/capstone-assertion-engine/main.kern', import.meta.url),
  );
  assert.equal(checkerMain.toString('utf8'), generateCheckerMainKern());
  assert.equal(numericMain.toString('utf8'), generateNumericMainKern());
  assert.equal(validatorMain.toString('utf8'), generateValidatorMainKern());
  assert.equal(assertionMain.toString('utf8'), generateAssertionMainKern());
  assert.equal(
    sha256(numericMain),
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a',
  );
  assert.equal(
    sha256(validatorMain),
    '9ac7774a50ad9bcb7852340baf6844f130066f7eb004aa3b56e1974ce2a469b7',
  );
  assert.equal(
    sha256(assertionMain),
    'a9df3dca6aa1eb6aa705446e4bb37ee7934ce507fb059e791ca42ed624cc9a03',
  );

  const built = createCanonicalizerComposition();
  const verified = verifyCanonicalizerComposition();
  assert.ok(built.compositeBytes.equals(verified.compositeBytes));
  assert.deepEqual(built.record, verified.record);
});

test('M4.56 prerequisite handoff remains exact and rejects hidden drift', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM456();
  assert.equal(handoff.digest, '13a420892453e03eed314ddad2f50ceeed4fe0f01e50cc3ee1a72a253caad26b');
  assert.equal(handoff.sourceCommit, '8928684827706b2abac1f4906f785a389afb91c6');
  assert.equal(handoff.record.baseline.baseCompleteFunctions, 65);
  assert.equal(handoff.record.baseline.legacyParameterBlockers, 38);
  assert.equal(handoff.record.exhaustion, null);
  assert.deepEqual(
    handoff.record.parameterMigration.witnesses.map(({ id }) => id),
    M457_PARAMETER_MIGRATION_TARGETS.map(({ id }) => id),
  );
  assert.deepEqual(handoff.record.selectedPrerequisite, {
    catalogFacts: 2,
    family: 'while-iteration',
    occurrences: 2,
  });

  for (const mutate of [
    (copy) => { copy.baseline.baseCompleteFunctions = 72; },
    (copy) => { copy.parameterMigration.witnesses.reverse(); },
    (copy) => { copy.selectedPrerequisite.family = 'call-expression'; },
  ]) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerPrerequisiteM456(copy),
      /coverage M4\.56 prerequisite rejection/u,
    );
  }
  const decorated = structuredClone(handoff.record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM456(decorated),
    /coverage M4\.56 prerequisite rejection/u,
  );
});
