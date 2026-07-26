import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import { currentM493ParameterMigration } from './coverage-current.mjs';
import {
  assertM494ParameterMigration,
  assertM494ParameterTarget,
  M494_PARAMETER_MIGRATION_TARGET,
} from './coverage-m4-94-parameter-migration.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import {
  loadCanonicalizerRuntimeCostM493,
  validateCanonicalizerRuntimeCostM493,
} from './runtime-cost-m4-93.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function targetFixture() {
  const target = M494_PARAMETER_MIGRATION_TARGET;
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children.filter(({ type }) => type === 'fn')[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  return { fact, root, target };
}

test('M4.93 publishes the exact immutable tablesok handoff', () => {
  const target = M494_PARAMETER_MIGRATION_TARGET;
  assert.deepEqual(currentM493ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 12,
    witnesses: [{
      id: target.id,
      parameterRows: target.parameters.length,
      profileRows: target.profileRows,
      tool: target.tool,
    }],
  });
});

test('M4.94 preserves exact M4.93 evidence after source migration', () => {
  const receiptBytes = readFileSync(
    new URL('./runtime-cost-m4-93.json', import.meta.url),
  );
  const receipt = loadCanonicalizerRuntimeCostM493();
  assert.equal(
    sha256(receiptBytes),
    '62631ce9d2c97e80b6187c0d75bcb878a610ab1076ab8df71a46d53c0e51b3f3',
  );
  assert.notEqual(
    receipt.source.canonicalizerMainSha256,
    sha256(readFileSync(new URL('../../examples/kern-canonicalizer/canonicalizer.kern', import.meta.url))),
  );
  const mutated = structuredClone(receipt);
  mutated.promotion.nextMilestone = 'M4.95';
  assert.throws(
    () => validateCanonicalizerRuntimeCostM493(mutated),
    /coverage M4\.93 runtime-cost rejection/u,
  );
});

test('M4.94 migrates the exact tablesok 12-row parameter queue', () => {
  const coverage = measureCanonicalizerCoverage();
  const prerequisite = measureCanonicalizerPrerequisite();
  const fixture = targetFixture();
  assertM494ParameterMigration(coverage, prerequisite, loadCanonicalizerPolicy());
  assertM494ParameterTarget(fixture.root, fixture.fact, fixture.target);
});

test('M4.94 target guard rejects signature, body, identity, fact, and profile drift', () => {
  const fixture = targetFixture();
  assertM494ParameterTarget(fixture.root, fixture.fact, fixture.target);
  const mutations = [
    ({ root }) => { root.props.params = 'nodeKind:string[]'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'string'; },
    ({ root }) => { root.props.export = undefined; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'number[]'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => {
      root.children.find(({ type }) => type === 'handler').children[0].props.cond = 'false';
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
    assert.throws(() => assertM494ParameterTarget(copy.root, copy.fact, copy.target));
  }
});
