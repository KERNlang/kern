import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { generateCheckerMainKern } from '../capstone-checker-subset/gen-fixtures-kern.mjs';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM445ParameterMigrations,
  assertM445ParameterTarget,
  M445_PARAMETER_MIGRATION_TARGETS,
} from './coverage-m4-45-parameter-migrations.mjs';
import {
  loadPublishedCanonicalizerPrerequisiteM444,
  validatePublishedCanonicalizerPrerequisiteM444,
} from './coverage-prerequisite-m4-44.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { createCanonicalizerComposition, verifyCanonicalizerComposition } from './composition.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function targetFixture(name) {
  const target = M445_PARAMETER_MIGRATION_TARGETS.find((entry) => entry.name === name);
  assert.ok(target);
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children.filter(({ type }) => type === 'fn')[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.45 consumes exactly the frozen 388-row parameter queue', () => {
  const coverage = measureCanonicalizerCoverage();
  assertM445ParameterMigrations(coverage);
  assert.equal(coverage.baseCompleteFunctions, 65);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) => excludedProperties.includes('fn.params')).length,
    38,
  );
  assert.deepEqual(loadCanonicalizerPolicy().profileLimits, {
    maxNodeRows: 19,
    maxPropertyRows: 31,
    maxValueRows: 388,
  });

  const prerequisite = measureCanonicalizerPrerequisite();
  assert.equal(prerequisite.parameterMigration.completeFunctions, 0);
  assert.equal(prerequisite.parameterMigration.completeTools, 0);
  assert.equal(prerequisite.parameterMigration.migratedParameterRows, 0);
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 38);
});

test('M4.45 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture('validbinaryop');
  assertM445ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'op:string'; },
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
    assert.throws(() => assertM445ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.45 generated consumers reproduce only from repository writers', () => {
  const checkerMain = readFileSync(
    new URL('../../examples/capstone-checker-subset/main.kern', import.meta.url),
  );
  assert.equal(
    checkerMain.toString('utf8'),
    generateCheckerMainKern(),
  );
  assert.equal(sha256(checkerMain), 'ff961e9e6c3796f8b21ae0622f8fe8c779f4734603e3a31db2b02b2f155aaea2');
  const built = createCanonicalizerComposition();
  const verified = verifyCanonicalizerComposition();
  assert.equal(built.compositeBytes.length, 49_418);
  assert.equal(
    sha256(built.compositeBytes),
    '9ef2e9f787f91efec3deb06ff07b11bf2093a07aa1301d59fda3551dc80d4bb5',
  );
  assert.ok(built.compositeBytes.equals(verified.compositeBytes));
  assert.deepEqual(built.record, verified.record);
});

test('M4.44 prerequisite handoff remains exact and rejects hidden drift', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM444();
  assert.equal(handoff.digest, '9741650d8567016fb029a8e51b4706da1da131d9870c94a3221b4550792dee01');
  assert.equal(handoff.sourceCommit, 'dd977ff493250127e2e416ffb4e3ab68985a61dc');
  assert.equal(handoff.record.baseline.baseCompleteFunctions, 58);
  assert.equal(handoff.record.baseline.legacyParameterBlockers, 45);
  assert.equal(handoff.record.exhaustion.residualFunctionCount, 43);
  assert.deepEqual(handoff.record.parameterMigration, {
    completeFunctions: 2,
    completeTools: 2,
    migratedParameterRows: 2,
    witnesses: M445_PARAMETER_MIGRATION_TARGETS.map(({ id, profileRows, parameters, path }) => ({
      id,
      parameterRows: parameters.length,
      profileRows,
      tool: path.includes('checker') ? 'checker' : 'canonicalizer',
    })),
  });

  for (const mutate of [
    (copy) => { copy.baseline.baseCompleteFunctions = 60; },
    (copy) => { copy.parameterMigration.witnesses.reverse(); },
    (copy) => { copy.exhaustion.residualFunctionCount = 42; },
  ]) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerPrerequisiteM444(copy),
      /coverage M4\.44 prerequisite rejection/u,
    );
  }
  const decorated = structuredClone(handoff.record);
  decorated[Symbol('hidden')] = true;
  assert.throws(
    () => validatePublishedCanonicalizerPrerequisiteM444(decorated),
    /coverage M4\.44 prerequisite rejection/u,
  );
});
