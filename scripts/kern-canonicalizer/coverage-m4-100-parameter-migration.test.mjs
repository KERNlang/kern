import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { generateCheckerMainKern } from '../capstone-checker-subset/gen-fixtures-kern.mjs';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertCurrentCanonicalizerFrontier,
  assertCurrentCanonicalizerPolicy,
} from './coverage-current.mjs';
import {
  assertM4100ParameterMigration,
  assertM4100ParameterTarget,
  M4100_PARAMETER_MIGRATION_TARGET,
} from './coverage-m4-100-parameter-migration.mjs';
import { m499ParameterMigration } from './coverage-m4-99-dual-row-promotion.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function targetFixture() {
  const target = M4100_PARAMETER_MIGRATION_TARGET;
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children
    .filter(({ type }) => type === 'fn')[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.100 consumes the exact immutable M4.99 parameter queue', () => {
  const target = M4100_PARAMETER_MIGRATION_TARGET;
  assert.deepEqual(m499ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 24,
    witnesses: [{
      id: target.id,
      parameterRows: target.parameters.length,
      profileRows: target.profileRows,
      tool: target.tool,
    }],
  });
});

test('M4.100 migrates only comparisonOperandsOk to 24 direct parameters', () => {
  const coverage = measureCanonicalizerCoverage();
  const prerequisite = measureCanonicalizerPrerequisite();
  const fixture = targetFixture();
  assertM4100ParameterMigration(coverage, prerequisite);
  assertM4100ParameterTarget(fixture.root, fixture.fact, fixture.target);
  assertCurrentCanonicalizerPolicy(loadCanonicalizerPolicy());
  assertCurrentCanonicalizerFrontier(coverage, prerequisite);
});

test('M4.100 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture();
  assertM4100ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'row:number'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'string'; },
    ({ root }) => { root.props.export = 'true'; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'string'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => {
      root.children.find(({ type }) => type === 'handler').children[0].props.value = 'false';
    },
    ({ fact }) => { fact.id = `${fact.id}-substituted`; },
    ({ fact }) => { fact.excludedProperties.push('fn.params'); },
    ({ fact }) => { fact.profileBlockers.push('profile.rows.values'); },
    ({ fact }) => { fact.profileRows.values -= 1; },
    ({ fact }) => { fact.nodeOccurrences.splice(fact.nodeOccurrences.indexOf('param'), 1); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => assertM4100ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.100 generated checker fixture reproduces from the repository writer', () => {
  const main = readFileSync(
    new URL('../../examples/capstone-checker-subset/main.kern', import.meta.url),
  );
  assert.equal(main.toString('utf8'), generateCheckerMainKern());
  assert.equal(sha256(main), M4100_PARAMETER_MIGRATION_TARGET.generatedMainSha256);
});
