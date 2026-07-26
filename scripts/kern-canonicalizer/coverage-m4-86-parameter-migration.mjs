import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  m485ActiveProfile,
  m485ParameterMigration,
} from './coverage-m4-85-value-row-promotion.mjs';
import {
  assertDirectParameterPrefix,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';
import { loadCanonicalizerValueRowHeadroomM484 } from './value-row-headroom-m4-84.mjs';

export const M486_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: 'a5f4c679b2db4d48ab8f3779bc6e02285c730be9c2497a36bada5d3321532915',
  exported: false,
  functionOrdinal: 15,
  id: 'examples/capstone-checker-subset/checker.kern#16:argProvenanced',
  name: 'argProvenanced',
  parameters: [
    ['fnName', 'string'],
    ['argId', 'number'],
    ['argKind', 'string[]'],
    ['argName', 'string[]'],
    ['argNum', 'string[]'],
    ['argOp', 'string[]'],
    ['argLeftKind', 'string[]'],
    ['argLeftName', 'string[]'],
    ['argLeftNum', 'string[]'],
    ['argRightKind', 'string[]'],
    ['argRightName', 'string[]'],
    ['argRightNum', 'string[]'],
    ['stmtKind', 'string[]'],
    ['stmtFn', 'string[]'],
    ['stmtName', 'string[]'],
    ['stmtTarget', 'string[]'],
    ['paramFn', 'string[]'],
    ['paramName', 'string[]'],
    ['paramOrdinal', 'number[]'],
  ],
  path: 'examples/capstone-checker-subset/checker.kern',
  profileRows: { nodes: 35, properties: 55, values: 580 },
  quotedReturns: false,
  returns: 'boolean',
};

const SOURCE_SHA256 = 'a04a2242cb7762b9753f16e49cc0b849eadd736d2d1667d691d267603394ad59';
const GENERATED_ARTIFACTS = new Map([
  ['examples/capstone-checker-subset/main.kern',
    'fe870142a814fc82e6bbb25c1bc8395d97a228e87d8ad175ed6794490305cc41'],
  ['examples/capstone-checker-subset/numeric-main.kern',
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a'],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertM486ParameterTarget(
  root,
  fact,
  target = M486_PARAMETER_MIGRATION_TARGET,
) {
  assert.ok(root);
  assert.equal(root.props.name, target.name);
  assert.equal(root.props.params, undefined);
  assert.equal(root.props.returns, target.returns);
  assert.equal(root.props.export, target.exported ? 'true' : undefined);
  assert.equal(root.__quotedProps?.includes('params') ?? false, false);
  assert.equal(root.__quotedProps?.includes('returns') ?? false, target.quotedReturns);
  assertDirectParameterPrefix(root, target.parameters);
  assert.equal(semanticBodyDigest(root), target.bodyDigest);

  assert.ok(fact);
  assert.equal(fact.id, target.id);
  assert.equal(fact.excludedProperties.includes('fn.params'), false);
  assert.deepEqual(fact.profileBlockers, []);
  assert.deepEqual(fact.profileRows, target.profileRows);
  assert.equal(
    fact.nodeOccurrences.filter((kind) => kind === 'param').length,
    target.parameters.length,
  );
}

export function assertM486ParameterMigration(coverage, prerequisite, policy) {
  const target = M486_PARAMETER_MIGRATION_TARGET;
  const publishedQueue = m485ParameterMigration();
  const headroom = loadCanonicalizerValueRowHeadroomM484();
  assert.deepEqual(policy.profileLimits, m485ActiveProfile());
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.kirLimits.maxDepth, 64);
  assert.deepEqual(publishedQueue, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: target.parameters.length,
    witnesses: [{
      id: target.id,
      parameterRows: target.parameters.length,
      profileRows: target.profileRows,
      tool: 'checker',
    }],
  }, 'M4.86 must consume the exact M4.85 parameter queue');
  assert.deepEqual(headroom.promotion, { disposition: 'approved', nextMilestone: 'M4.85' });
  assert.deepEqual(headroom.limits.candidateProfile, m485ActiveProfile());

  const sourceBytes = readFileSync(new URL(`../../${target.path}`, import.meta.url));
  const source = sourceBytes.toString('utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  assert.equal(sha256(sourceBytes), SOURCE_SHA256);
  const roots = document.root.children.filter(({ type }) => type === 'fn');
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM486ParameterTarget(roots[target.functionOrdinal], fact, target);
  assert.equal(source.split('\n').length - 1, 467);
  assert.equal(roots.length, 24);
  assert.deepEqual(
    roots.filter(({ props }) => typeof props.params === 'string').map(({ props }) => props.name),
    [
      'rejectLine',
      'paramCallsitesOk',
      'indexRejectDetail',
      'mapKeyToken',
      'mapKnownBefore',
      'callRejectCode',
      'checkModule',
    ],
  );
  for (const [path, digest] of GENERATED_ARTIFACTS) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), digest);
  }

  assert.equal(coverage.baseCompleteFunctions, 84);
  assert.equal(coverage.functions.length, 106);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) => excludedProperties.includes('fn.params')).length,
    22,
  );
  assert.deepEqual(prerequisite.parameterMigration, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 7,
    witnesses: [{
      id: 'examples/kern-canonicalizer/canonicalizer.kern#2:exprsource',
      parameterRows: 7,
      profileRows: { nodes: 13, properties: 23, values: 175 },
      tool: 'canonicalizer',
    }],
  });
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 21);
  assert.equal(
    prerequisite.exhaustion?.reasonAssignmentsDigest,
    'c032952ceee69b3b1d8126b1c2bd4f4af301f7652ed33b1fc039f631377939b2',
  );
  return fact;
}
