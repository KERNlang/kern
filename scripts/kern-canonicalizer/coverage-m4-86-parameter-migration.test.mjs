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
  m485ActiveProfile,
  m485ParameterMigration,
} from './coverage-m4-85-value-row-promotion.mjs';
import {
  assertM486ParameterMigration,
  assertM486ParameterTarget,
  M486_PARAMETER_MIGRATION_TARGET,
} from './coverage-m4-86-parameter-migration.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import {
  loadCanonicalizerValueRowHeadroomM484,
  validateCanonicalizerValueRowHeadroomM484,
} from './value-row-headroom-m4-84.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function targetFixture() {
  const target = M486_PARAMETER_MIGRATION_TARGET;
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children.filter(({ type }) => type === 'fn')[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.85 publishes the exact immutable argProvenanced handoff', () => {
  assert.deepEqual(m485ActiveProfile(), {
    maxNodeRows: 38,
    maxPropertyRows: 61,
    maxValueRows: 580,
  });
  assert.deepEqual(m485ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 19,
    witnesses: [{
      id: M486_PARAMETER_MIGRATION_TARGET.id,
      parameterRows: M486_PARAMETER_MIGRATION_TARGET.parameters.length,
      profileRows: M486_PARAMETER_MIGRATION_TARGET.profileRows,
      tool: 'checker',
    }],
  });
  const receipt = loadCanonicalizerValueRowHeadroomM484();
  assert.equal(
    sha256(readFileSync(new URL('./value-row-headroom-m4-84.json', import.meta.url))),
    '4b92ced7a43f4aa938a9fe303edcd5fb17b423a61d99b9a8c476ccdc653b8065',
  );
  assert.deepEqual(receipt.promotion, { disposition: 'approved', nextMilestone: 'M4.85' });
});

test('M4.86 migrates the exact argProvenanced parameter queue', () => {
  const coverage = measureCanonicalizerCoverage();
  const prerequisite = measureCanonicalizerPrerequisite();
  const fixture = targetFixture();
  assertM486ParameterMigration(coverage, prerequisite, loadCanonicalizerPolicy());
  assertM486ParameterTarget(fixture.root, fixture.fact, fixture.target);
});

test('M4.86 generated checker consumers reproduce only from repository writers', () => {
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
});

test('M4.86 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture();
  assertM486ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'fnName:string'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'string'; },
    ({ root }) => { root.props.export = 'true'; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'number'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => { root.children.find(({ type }) => type === 'handler').props.lang = 'typescript'; },
    ({ fact }) => { fact.id = `${fact.id}-substituted`; },
    ({ fact }) => { fact.excludedProperties.push('fn.params'); },
    ({ fact }) => { fact.profileBlockers.push('profile.rows.values'); },
    ({ fact }) => { fact.profileRows.values -= 1; },
    ({ fact }) => { fact.nodeOccurrences.splice(fact.nodeOccurrences.indexOf('param'), 1); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => assertM486ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.86 preserves immutable M4.84 evidence after queue consumption', () => {
  const receipt = loadCanonicalizerValueRowHeadroomM484();
  for (const mutate of [
    (copy) => { copy.limits.candidateProfile.maxValueRows += 1; },
    (copy) => { copy.witnesses[0].parameterRows -= 1; },
    (copy) => { copy.promotion.nextMilestone = 'M4.86'; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerValueRowHeadroomM484(copy),
      /coverage M4\.84 value-row headroom rejection/u,
    );
  }
});
