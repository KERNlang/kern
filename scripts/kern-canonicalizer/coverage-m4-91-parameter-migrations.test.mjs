import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  generateCheckerMainKern,
  generateNumericMainKern,
} from '../capstone-checker-subset/gen-fixtures-kern.mjs';
import { generateMainKern as generateValidatorMainKern } from '../selfhost-validator/gen-fixtures-kern.mjs';
import {
  createCanonicalizerComposition,
  verifyCanonicalizerComposition,
} from './composition.mjs';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertCurrentCanonicalizerFrontier,
  assertCurrentCanonicalizerPolicy,
} from './coverage-current.mjs';
import {
  assertM491ParameterMigrations,
  assertM491ParameterTarget,
  M491_PARAMETER_MIGRATION_TARGETS,
} from './coverage-m4-91-parameter-migrations.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function targetFixture(target, coverage = measureCanonicalizerCoverage()) {
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const roots = document.root.children.filter(({ type }) => type === 'fn');
  const root = roots[target.functionOrdinal];
  const fact = coverage.functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.91 migrates the exact four-function 47-row parameter queue', () => {
  const coverage = measureCanonicalizerCoverage();
  assert.equal(M491_PARAMETER_MIGRATION_TARGETS.length, 4);
  assertM491ParameterMigrations(coverage);
  assert.equal(
    M491_PARAMETER_MIGRATION_TARGETS.reduce(
      (sum, { parameters }) => sum + parameters.length,
      0,
    ),
    47,
  );
  for (const target of M491_PARAMETER_MIGRATION_TARGETS) {
    const fixture = targetFixture(target, coverage);
    assertM491ParameterTarget(fixture.root, fixture.fact, fixture.target);
  }
});

test('M4.91 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture(M491_PARAMETER_MIGRATION_TARGETS[0]);
  assertM491ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'fnName:string'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'boolean'; },
    ({ root }) => { root.props.export = 'true'; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'number'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => {
      root.children.find(({ type }) => type === 'handler').children[0].props.cond = 'false';
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
    assert.throws(() => assertM491ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.91 generated consumers reproduce only from repository writers', () => {
  const checkerMain = readFileSync(
    new URL('../../examples/capstone-checker-subset/main.kern', import.meta.url),
  );
  const numericMain = readFileSync(
    new URL('../../examples/capstone-checker-subset/numeric-main.kern', import.meta.url),
  );
  const validatorMain = readFileSync(
    new URL('../../examples/selfhost-validator/main.kern', import.meta.url),
  );
  assert.equal(checkerMain.toString('utf8'), generateCheckerMainKern());
  assert.equal(numericMain.toString('utf8'), generateNumericMainKern());
  assert.equal(validatorMain.toString('utf8'), generateValidatorMainKern());
  assert.equal(sha256(checkerMain), '13c6af59f82c23c122dc8839084e0b0ab870035d9af28a201e03e8ba52c6184c');
  assert.equal(sha256(numericMain), '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a');
  assert.equal(sha256(validatorMain), '9ac7774a50ad9bcb7852340baf6844f130066f7eb004aa3b56e1974ce2a469b7');

  const sources = new Map([
    ['examples/capstone-checker-subset/checker.kern',
      '5bc7cacd87bd1093ecbcd2c6dda6d56ff113a8bcbb9e0a26ca327675a4297bee'],
    ['examples/kern-canonicalizer/canonicalizer.kern',
      '923c1edc4d79bf1c5e16554ddcbc86ad077a9a9ffa591ba2810c775b89fad5be'],
    ['examples/selfhost-validator/validator.kern',
      'db11517fa7804dac32480bc205bd835b631524a00674e1e85f549dc663d5eb5a'],
  ]);
  for (const [path, digest] of sources) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), digest);
  }

  const built = createCanonicalizerComposition();
  const verified = verifyCanonicalizerComposition();
  assert.ok(built.compositeBytes.equals(verified.compositeBytes));
  assert.deepEqual(built.record, verified.record);
  assert.equal(sha256(verified.compositeBytes), 'aff72db1605a0a5cdcbfe34fae65939e4206b659514641b02c2999da3e94b3ab');
});

test('M4.91 advances only the authenticated current frontier', () => {
  const coverage = measureCanonicalizerCoverage();
  const prerequisite = measureCanonicalizerPrerequisite();
  assertCurrentCanonicalizerPolicy(loadCanonicalizerPolicy());
  assertCurrentCanonicalizerFrontier(coverage, prerequisite);
  assertM491ParameterMigrations(coverage);
});
