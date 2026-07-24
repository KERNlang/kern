import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  generateCheckerMainKern,
  generateNumericMainKern,
} from '../capstone-checker-subset/gen-fixtures-kern.mjs';
import { createCanonicalizerComposition, verifyCanonicalizerComposition } from './composition.mjs';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM469ParameterMigration,
  assertM469ParameterTarget,
  M469_PARAMETER_MIGRATION_TARGET,
} from './coverage-m4-69-parameter-migration.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM468,
  validatePublishedCanonicalizerPrerequisiteM468,
} from './coverage-prerequisite-m4-68.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function targetFixture() {
  const target = M469_PARAMETER_MIGRATION_TARGET;
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children.filter(({ type }) => type === 'fn')[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.69 migrates the exact isSurfaceKind parameter row', () => {
  const fixture = targetFixture();
  assertM469ParameterMigration(measureCanonicalizerCoverage());
  assertM469ParameterTarget(fixture.root, fixture.fact, fixture.target);
});

test('M4.69 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture();
  assertM469ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'kind:string'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'string'; },
    ({ root }) => { root.props.export = 'true'; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'number'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => { root.children.find(({ type }) => type === 'handler').props.lang = 'typescript'; },
    ({ root }) => {
      root.children.find(({ type }) => type === 'handler').children[0].props.cond = 'kind == "changed"';
    },
    ({ fact }) => { fact.id = `${fact.id}-substituted`; },
    ({ fact }) => { fact.excludedProperties.push('fn.params'); },
    ({ fact }) => { fact.profileBlockers.push('profile.rows.nodes'); },
    ({ fact }) => { fact.profileRows.nodes += 1; },
    ({ fact }) => { fact.nodeOccurrences.splice(fact.nodeOccurrences.indexOf('param'), 1); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => assertM469ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.68 publishes exactly the immutable one-row isSurfaceKind handoff', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM468();
  assert.equal(handoff.digest, '0038f2a831533a8c6494a56a83cc4af96a50a2416d62de772707624cf634412c');
  assert.equal(handoff.sourceCommit, 'c0a84888c53325a5c7dd6e19ba4f002b6b28d1a4');
  assert.equal(
    sha256(readFileSync(new URL('./coverage-prerequisite-m4-68.json', import.meta.url))),
    handoff.digest,
  );
  assert.deepEqual(handoff.record.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 1,
    witnesses: [{
      id: M469_PARAMETER_MIGRATION_TARGET.id,
      parameterRows: 1,
      profileRows: M469_PARAMETER_MIGRATION_TARGET.profileRows,
      tool: 'checker',
    }],
  });
  assert.equal(handoff.record.baseline.baseCompleteFunctions, 77);
  assert.equal(handoff.record.baseline.legacyParameterBlockers, 26);
  assert.equal(handoff.record.exhaustion.residualFunctionCount, 25);

  for (const mutate of [
    (copy) => { copy.baseline.baseCompleteFunctions = 78; },
    (copy) => { copy.parameterMigration.witnesses = []; },
    (copy) => { copy.exhaustion.residualFunctionCount = 24; },
  ]) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerPrerequisiteM468(copy),
      /coverage M4\.68 prerequisite rejection/u,
    );
  }
  const decorated = structuredClone(handoff.record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM468(decorated),
    /coverage M4\.68 prerequisite rejection/u,
  );
  const shared = structuredClone(handoff.record);
  shared.ranking = shared.prerequisiteRanking;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM468(shared),
    /coverage M4\.68 prerequisite rejection/u,
  );
});

test('M4.77 preserves M4.69 after consuming the next queue', () => {
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

test('M4.69 generated consumers reproduce only from repository writers', () => {
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
  assert.equal(sha256(checkerMain), 'c73f0356534ee83eac5d81609d178fcbc67709a0c3ca291a62f79eeb9ad19c2e');

  const built = createCanonicalizerComposition();
  const verified = verifyCanonicalizerComposition();
  assert.ok(built.compositeBytes.equals(verified.compositeBytes));
  assert.deepEqual(built.record, verified.record);
});
