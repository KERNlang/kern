import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { createCanonicalizerComposition, verifyCanonicalizerComposition } from './composition.mjs';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertCurrentCanonicalizerFrontier,
  assertCurrentCanonicalizerPolicy,
} from './coverage-current.mjs';
import {
  assertM4108ParameterMigration,
  assertM4108ParameterTarget,
  M4108_PARAMETER_MIGRATION_TARGET,
} from './coverage-m4-108-parameter-migration.mjs';
import { m4107ParameterMigration } from './coverage-m4-107-triple-row-promotion.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

function targetFixture() {
  const target = M4108_PARAMETER_MIGRATION_TARGET;
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), target.sourceSha256);
  const document = parseDocumentWithDiagnostics(source.toString('utf8'));
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children
    .filter(({ type }) => type === 'fn')[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.108 consumes the exact immutable M4.107 parameter queue', () => {
  const target = M4108_PARAMETER_MIGRATION_TARGET;
  assert.deepEqual(m4107ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 14,
    witnesses: [{
      id: target.id,
      parameterRows: target.parameters.length,
      profileRows: target.profileRows,
      tool: target.tool,
    }],
  });
});

test('M4.108 migrates only validstatement to 14 direct parameters', () => {
  const coverage = measureCanonicalizerCoverage();
  const prerequisite = measureCanonicalizerPrerequisite();
  const fixture = targetFixture();
  assertM4108ParameterMigration(coverage, prerequisite);
  assertM4108ParameterTarget(fixture.root, fixture.fact, fixture.target);
  assertCurrentCanonicalizerPolicy(loadCanonicalizerPolicy());
  assertCurrentCanonicalizerFrontier(coverage, prerequisite);
});

test('M4.108 target rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture();
  assertM4108ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'id:number'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'string'; },
    ({ root }) => { root.props.export = undefined; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'string'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => {
      root.children.find(({ type }) => type === 'handler').children[0].props.value = '"changed"';
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
    assert.throws(() => assertM4108ParameterTarget(copy.root, copy.fact, copy.target));
  }
});

test('M4.108 generated canonicalizer reproduces only from repository writers', () => {
  const built = createCanonicalizerComposition();
  const verified = verifyCanonicalizerComposition();
  assert.ok(built.compositeBytes.equals(verified.compositeBytes));
  assert.deepEqual(built.record, verified.record);
});
