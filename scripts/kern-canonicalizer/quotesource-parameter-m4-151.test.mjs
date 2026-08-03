import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadCoveragePolicy, measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM4151QuotesourceParameterMigration,
  assertM4151QuotesourceParameterTarget,
} from './coverage-m4-151-parameter-migration.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import {
  assertDirectParameterPrefix,
  parameterMigrationRoots,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';
import { assertM4150QuotesourceRewrite } from './quotesource-rewrite-m4-150.mjs';
import {
  M4151_COVERAGE_POLICY_DIGEST,
  M4151_EXPRESSION_HELPERS_DIGEST,
  PRE_M4151_COVERAGE_POLICY_DIGEST,
  PRE_M4151_EXPRESSION_HELPERS_DIGEST,
  QUOTESOURCE_PARAMETER_TARGET_M4151 as TARGET,
  readExactM4151ExpressionHelpers,
  reconstructPreM4151CoverageInputs,
  reconstructPreM4151ExpressionHelpers,
} from './quotesource-parameter-m4-151-target.mjs';

const EMPTY_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

test('M4.151 consumes only the exact M4.150 quotesource parameter queue', () => {
  const handoff = assertM4150QuotesourceRewrite();
  assert.deepEqual(handoff.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 2,
    witnesses: [{
      id: TARGET.id,
      parameterRows: 2,
      profileRows: TARGET.profileRows,
      tool: TARGET.tool,
    }],
  });
  assert.deepEqual(handoff.selectedNextAction, {
    action: 'consume-exact-parameter-queue',
    milestone: 'M4.151',
    witness: TARGET.id,
  });

  const root = parameterMigrationRoots([TARGET]).get(TARGET.path)?.[TARGET.functionOrdinal];
  assert.ok(root);
  assert.deepEqual(Reflect.ownKeys(root.props).toSorted(), ['export', 'name', 'returns']);
  assert.equal(root.props.name, TARGET.name);
  assert.equal(root.props.params, undefined);
  assert.equal(root.props.returns, TARGET.returns);
  assert.equal(root.props.export === 'true', TARGET.exported);
  assertDirectParameterPrefix(root, TARGET.parameters);
  assert.equal(semanticBodyDigest(root), TARGET.bodyDigest);

  const coverage = measureCanonicalizerCoverage();
  const fact = coverage.functions.find(({ id }) => id === TARGET.id);
  assert.ok(fact);
  assert.equal(coverage.baseCompleteFunctions, 112);
  assert.equal(coverage.functions.length, 112);
  assert.deepEqual(fact.excludedProperties, []);
  assert.equal(fact.firstUnsupported, null);
  assert.deepEqual(fact.profileBlockers, []);
  assert.deepEqual(fact.profileRows, TARGET.profileRows);

  const prerequisite = measureCanonicalizerPrerequisite();
  assert.equal(prerequisite.format, 'kern.kir-canonicalizer.prerequisite-summary.4');
  assert.equal(prerequisite.outcome, 'complete');
  assert.equal(prerequisite.baseline.baseCompleteFunctions, 112);
  assert.equal(prerequisite.baseline.functionCount, 112);
  assert.equal(prerequisite.baseline.legacyParameterBlockers, 0);
  assert.deepEqual(prerequisite.parameterMigration, EMPTY_QUEUE);
  assert.equal(prerequisite.exhaustion, null);
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.prerequisiteRanking, []);
  assert.deepEqual(prerequisite.ranking, []);
  assert.equal(
    assertM4151QuotesourceParameterMigration(coverage, prerequisite),
    'M4.151 consumes the exact M4.150 1-function/2-row quotesource queue and ' +
      'advances the cumulative canonicalizer base to 112/112 with zero legacy-parameter ' +
      'blockers; prerequisite format 4 publishes the terminal complete frontier.',
  );
});

test('M4.151 target is immutable and rejects signature, body, and fact drift', () => {
  assert.equal(Object.isFrozen(TARGET), true);
  assert.equal(Object.isFrozen(TARGET.parameters), true);
  assert.equal(Object.isFrozen(TARGET.profileRows), true);
  assert.equal(TARGET.parameters.every((parameter) => Object.isFrozen(parameter)), true);
  const root = parameterMigrationRoots([TARGET]).get(TARGET.path)?.[TARGET.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === TARGET.id);
  assertM4151QuotesourceParameterTarget(root, fact);
  for (const mutate of [
    (copy) => { copy.root.props.params = 'value:string,validated:boolean'; },
    (copy) => { copy.root.children[0].props.name = 'renamed'; },
    (copy) => { copy.root.children[1].props.type = 'string'; },
    (copy) => { copy.root.children.push(copy.root.children.shift()); },
    (copy) => {
      copy.root.children.find(({ type }) => type === 'handler').children[0].props.value = 'future';
    },
    (copy) => { copy.fact.id = `${copy.fact.id}-future`; },
    (copy) => { copy.fact.excludedProperties.push('fn.params'); },
    (copy) => { copy.fact.profileRows.values += 1; },
  ]) {
    const copy = structuredClone({ fact, root });
    mutate(copy);
    assert.throws(() => assertM4151QuotesourceParameterTarget(copy.root, copy.fact));
  }
});

test('M4.151 authenticates one reversible source and policy transition', () => {
  const source = readExactM4151ExpressionHelpers();
  assert.equal(createHash('sha256').update(source).digest('hex'), M4151_EXPRESSION_HELPERS_DIGEST);
  assert.equal(
    createHash('sha256').update(reconstructPreM4151ExpressionHelpers(source)).digest('hex'),
    PRE_M4151_EXPRESSION_HELPERS_DIGEST,
  );
  const policySource = readFileSync(new URL('./coverage-policy.json', import.meta.url));
  const historical = reconstructPreM4151CoverageInputs(loadCoveragePolicy(), policySource);
  assert.equal(createHash('sha256').update(policySource).digest('hex'), M4151_COVERAGE_POLICY_DIGEST);
  assert.equal(
    createHash('sha256').update(historical.policySource).digest('hex'),
    PRE_M4151_COVERAGE_POLICY_DIGEST,
  );
  assert.throws(
    () => reconstructPreM4151ExpressionHelpers(Buffer.concat([source, Buffer.from('\n')])),
    /pre-M4\.151 expression helpers/u,
  );
  const drifted = structuredClone(loadCoveragePolicy());
  drifted.corpus[0].tool = 'future';
  assert.throws(
    () => reconstructPreM4151CoverageInputs(drifted, policySource),
    /coverage M4\.151 quotesource parameter target rejection/u,
  );
});
