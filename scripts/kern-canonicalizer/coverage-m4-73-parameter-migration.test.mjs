import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { createCanonicalizerComposition, verifyCanonicalizerComposition } from './composition.mjs';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM473ParameterMigration,
  assertM473ParameterTarget,
  M473_PARAMETER_MIGRATION_TARGET,
} from './coverage-m4-73-parameter-migration.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM472,
  validatePublishedCanonicalizerPrerequisiteM472,
} from './coverage-prerequisite-m4-72.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function targetFixture() {
  const target = M473_PARAMETER_MIGRATION_TARGET;
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children.filter(({ type }) => type === 'fn')[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.73 migrates the exact validstatementlist parameter queue', () => {
  const fixture = targetFixture();
  assertM473ParameterMigration(measureCanonicalizerCoverage());
  assertM473ParameterTarget(fixture.root, fixture.fact, fixture.target);
});

test('M4.73 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture();
  assertM473ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'parent:number'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'string'; },
    ({ root }) => { root.props.export = undefined; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'string'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => { root.children.find(({ type }) => type === 'handler').props.lang = 'typescript'; },
    ({ root }) => {
      root.children.find(({ type }) => type === 'handler').children[0].props.value = '"changed"';
    },
    ({ fact }) => { fact.id = `${fact.id}-substituted`; },
    ({ fact }) => { fact.excludedProperties.push('fn.params'); },
    ({ fact }) => { fact.profileBlockers.push('profile.rows.nodes'); },
    ({ fact }) => { fact.profileRows.properties += 1; },
    ({ fact }) => { fact.nodeOccurrences.splice(fact.nodeOccurrences.indexOf('param'), 1); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => assertM473ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.72 publishes the immutable validstatementlist migration handoff', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM472();
  assert.equal(
    handoff.digest,
    '617e5e0dc200d8f931d94ab9d6b09e6c7080f6216d40918927d340b339c27461',
  );
  assert.equal(handoff.sourceCommit, '8d8326ed3071db4968e65bac29c067e1426c220b');
  assert.equal(
    sha256(readFileSync(new URL('./coverage-prerequisite-m4-72.json', import.meta.url))),
    handoff.digest,
  );
  assert.deepEqual(handoff.record.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 14,
    witnesses: [{
      id: M473_PARAMETER_MIGRATION_TARGET.id,
      parameterRows: M473_PARAMETER_MIGRATION_TARGET.parameters.length,
      profileRows: M473_PARAMETER_MIGRATION_TARGET.profileRows,
      tool: 'canonicalizer',
    }],
  });
  assert.equal(handoff.record.baseline.baseCompleteFunctions, 78);
  assert.equal(handoff.record.baseline.legacyParameterBlockers, 25);
  assert.equal(handoff.record.exhaustion.residualFunctionCount, 24);

  for (const mutate of [
    (copy) => { copy.baseline.baseCompleteFunctions = 79; },
    (copy) => { copy.parameterMigration.witnesses = []; },
    (copy) => { copy.exhaustion.residualFunctionCount = 23; },
  ]) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerPrerequisiteM472(copy),
      /coverage M4\.72 prerequisite rejection/u,
    );
  }
  const decorated = structuredClone(handoff.record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM472(decorated),
    /coverage M4\.72 prerequisite rejection/u,
  );
  const shared = structuredClone(handoff.record);
  shared.ranking = shared.prerequisiteRanking;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM472(shared),
    /coverage M4\.72 prerequisite rejection/u,
  );
});

test('M4.73 consumes the queue without changing policy or bounded exhaustion', () => {
  const coverage = measureCanonicalizerCoverage();
  assert.equal(coverage.baseCompleteFunctions, 79);
  assert.equal(coverage.functions.length, 104);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) =>
      excludedProperties.includes('fn.params')).length,
    24,
  );
  assert.deepEqual(loadCanonicalizerPolicy().profileLimits, {
    maxNodeRows: 31,
    maxPropertyRows: 53,
    maxValueRows: 388,
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
  assert.equal(prerequisite.exhaustion.residualFunctionCount, 24);
  assert.equal(
    prerequisite.exhaustion.reasonAssignmentsDigest,
    'bc209e6142330b70cac9499b3cc66a6750bdf3baabe6763a9f6b847995c21831',
  );
});

test('M4.73 generated consumers reproduce only from repository writers', () => {
  const built = createCanonicalizerComposition();
  const verified = verifyCanonicalizerComposition();
  assert.ok(built.compositeBytes.equals(verified.compositeBytes));
  assert.deepEqual(built.record, verified.record);
});
