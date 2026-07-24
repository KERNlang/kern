import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { createCanonicalizerComposition, verifyCanonicalizerComposition } from './composition.mjs';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM477ParameterMigration,
  assertM477ParameterTarget,
  M477_PARAMETER_MIGRATION_TARGET,
} from './coverage-m4-77-parameter-migration.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM476,
  validatePublishedCanonicalizerPrerequisiteM476,
} from './coverage-prerequisite-m4-76.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function targetFixture() {
  const target = M477_PARAMETER_MIGRATION_TARGET;
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children.filter(({ type }) => type === 'fn')[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.77 migrates the exact typesource parameter queue', () => {
  const fixture = targetFixture();
  assertM477ParameterMigration(measureCanonicalizerCoverage());
  assertM477ParameterTarget(fixture.root, fixture.fact, fixture.target);
});

test('M4.77 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture();
  assertM477ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'id:number'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'boolean'; },
    ({ root }) => { root.props.export = undefined; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'string'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => { root.children.find(({ type }) => type === 'handler').props.lang = 'typescript'; },
    ({ root }) => {
      root.children.find(({ type }) => type === 'handler').children[0].props.cond = 'id == 0';
    },
    ({ fact }) => { fact.id = `${fact.id}-substituted`; },
    ({ fact }) => { fact.excludedProperties.push('fn.params'); },
    ({ fact }) => { fact.profileBlockers.push('profile.rows.values'); },
    ({ fact }) => { fact.profileRows.values += 1; },
    ({ fact }) => { fact.nodeOccurrences.splice(fact.nodeOccurrences.indexOf('param'), 1); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => assertM477ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.76 publishes the immutable typesource migration handoff', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM476();
  assert.equal(
    handoff.digest,
    'a963c0df94b563eb7df5e50eba68faf12cd607f92229ab0c748c412eaa3e88ca',
  );
  assert.equal(handoff.sourceCommit, 'f198ec30b8b00c2cdb9aca2b9aeb7a2e38a5e1df');
  assert.equal(
    sha256(readFileSync(new URL('./coverage-prerequisite-m4-76.json', import.meta.url))),
    handoff.digest,
  );
  assert.deepEqual(handoff.record.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 6,
    witnesses: [{
      id: M477_PARAMETER_MIGRATION_TARGET.id,
      parameterRows: M477_PARAMETER_MIGRATION_TARGET.parameters.length,
      profileRows: { nodes: 38, properties: 51, values: 461 },
      tool: 'canonicalizer',
    }],
  });
  assert.equal(handoff.record.baseline.baseCompleteFunctions, 79);
  assert.equal(handoff.record.baseline.legacyParameterBlockers, 24);
  assert.equal(handoff.record.exhaustion.residualFunctionCount, 23);

  for (const mutate of [
    (copy) => { copy.baseline.baseCompleteFunctions = 80; },
    (copy) => { copy.parameterMigration.witnesses = []; },
    (copy) => { copy.exhaustion.residualFunctionCount = 22; },
  ]) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerPrerequisiteM476(copy),
      /coverage M4\.76 prerequisite rejection/u,
    );
  }
  const decorated = structuredClone(handoff.record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM476(decorated),
    /coverage M4\.76 prerequisite rejection/u,
  );
  const shared = structuredClone(handoff.record);
  shared.ranking = shared.prerequisiteRanking;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM476(shared),
    /coverage M4\.76 prerequisite rejection/u,
  );
});

test('M4.77 consumes the exact queue without changing the active profile', () => {
  const coverage = measureCanonicalizerCoverage();
  assert.equal(coverage.baseCompleteFunctions, 81);
  assert.equal(coverage.functions.length, 105);
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
  assert.deepEqual(prerequisite.parameterMigration, {
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
  assert.equal(
    prerequisite.exhaustion.reasonAssignmentsDigest,
    '0abacdcff2a8ee7dfd977de09a3af2488350a383347b226a0afe36b8ca786ae7',
  );
});

test('M4.77 generated consumers reproduce only from repository writers', () => {
  const built = createCanonicalizerComposition();
  const verified = verifyCanonicalizerComposition();
  assert.ok(built.compositeBytes.equals(verified.compositeBytes));
  assert.deepEqual(built.record, verified.record);
});
