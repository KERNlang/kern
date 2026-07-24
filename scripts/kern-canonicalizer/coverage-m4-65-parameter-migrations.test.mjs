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
  assertM465ParameterMigrations,
  assertM465ParameterTarget,
  M465_PARAMETER_MIGRATION_TARGETS,
} from './coverage-m4-65-parameter-migrations.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM464,
  validatePublishedCanonicalizerPrerequisiteM464,
} from './coverage-prerequisite-m4-64.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function targetFixture(target) {
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children.filter(({ type }) => type === 'fn')[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.65 migrates the exact four-function 37-row parameter queue', () => {
  const coverage = measureCanonicalizerCoverage();
  assertM465ParameterMigrations(coverage);
  let migratedRows = 0;
  for (const target of M465_PARAMETER_MIGRATION_TARGETS) {
    const fixture = targetFixture(target);
    assertM465ParameterTarget(fixture.root, fixture.fact, fixture.target);
    migratedRows += target.parameters.length;
  }
  assert.equal(migratedRows, 37);
});

test('M4.76 preserves the M4.65 corpus while exposing the next parameter queue', () => {
  const coverage = measureCanonicalizerCoverage();
  assert.equal(coverage.baseCompleteFunctions, 79);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) =>
      excludedProperties.includes('fn.params')).length,
    24,
  );
  assert.deepEqual(loadCanonicalizerPolicy().profileLimits, {
    maxNodeRows: 38,
    maxPropertyRows: 53,
    maxValueRows: 461,
  });

  const prerequisite = measureCanonicalizerPrerequisite();
  assert.deepEqual(prerequisite.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 6,
    witnesses: [{
      id: 'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
      parameterRows: 6,
      profileRows: { nodes: 38, properties: 51, values: 461 },
      tool: 'canonicalizer',
    }],
  });
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.ranking, []);
  assert.deepEqual(prerequisite.exhaustion.activeFamilies, ['exception-flow']);
  assert.equal(prerequisite.exhaustion.residualFunctionCount, 23);
  assert.equal(
    prerequisite.exhaustion.reasonAssignmentsDigest,
    '0abacdcff2a8ee7dfd977de09a3af2488350a383347b226a0afe36b8ca786ae7',
  );
});

test('M4.65 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture(M465_PARAMETER_MIGRATION_TARGETS[1]);
  assertM465ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'callId:number'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'boolean'; },
    ({ root }) => { root.props.export = 'true'; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'string'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => { root.children.find(({ type }) => type === 'handler').props.lang = 'typescript'; },
    ({ root }) => { root.children.find(({ type }) => type === 'handler').children[0].props.value = '"changed"'; },
    ({ fact }) => { fact.id = `${fact.id}-substituted`; },
    ({ fact }) => { fact.excludedProperties.push('fn.params'); },
    ({ fact }) => { fact.profileBlockers.push('profile.rows.nodes'); },
    ({ fact }) => { fact.profileRows.nodes += 1; },
    ({ fact }) => { fact.nodeOccurrences.splice(fact.nodeOccurrences.indexOf('param'), 1); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => assertM465ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.64 publishes exactly the immutable four-function 37-row handoff', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM464();
  assert.equal(handoff.digest, '9bba0c10b55e732392fa68dd7f7174135a4ff380875e15ea787e045b46d5610f');
  assert.equal(handoff.sourceCommit, '9f60e3c3a43dd029626466223effbc08b51696b2');
  assert.deepEqual(
    handoff.record.parameterMigration.witnesses.map(({ id, parameterRows }) => ({ id, parameterRows })),
    M465_PARAMETER_MIGRATION_TARGETS.map(({ id, parameters }) => ({
      id,
      parameterRows: parameters.length,
    })),
  );
  assert.equal(handoff.record.parameterMigration.completeFunctions, 4);
  assert.equal(handoff.record.parameterMigration.completeTools, 2);
  assert.equal(handoff.record.parameterMigration.migratedParameterRows, 37);
  assert.equal(handoff.record.exhaustion.residualFunctionCount, 26);

  for (const mutate of [
    (copy) => { copy.baseline.baseCompleteFunctions = 74; },
    (copy) => { copy.parameterMigration.witnesses.reverse(); },
    (copy) => { copy.exhaustion.residualFunctionCount = 25; },
  ]) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerPrerequisiteM464(copy),
      /coverage M4\.64 prerequisite rejection/u,
    );
  }
  const decorated = structuredClone(handoff.record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM464(decorated),
    /coverage M4\.64 prerequisite rejection/u,
  );
});

test('M4.65 generated consumers reproduce only from repository writers', () => {
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
    sha256(checkerMain),
    'c73f0356534ee83eac5d81609d178fcbc67709a0c3ca291a62f79eeb9ad19c2e',
  );

  const built = createCanonicalizerComposition();
  const verified = verifyCanonicalizerComposition();
  assert.ok(built.compositeBytes.equals(verified.compositeBytes));
  assert.deepEqual(built.record, verified.record);
});
