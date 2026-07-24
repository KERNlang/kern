import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';

import {
  assertDirectParameterPrefix,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M477_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '5284b5dc166f0bdd4ad020615e2ad8e6077689dfb316a4fe00fd5a202e4882dc',
  exported: true,
  functionOrdinal: 0,
  id: 'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
  name: 'typesource',
  parameters: [
    ['id', 'number'],
    ['allowVoid', 'boolean'],
    ['valueTag', 'string[]'],
    ['valueParent', 'number[]'],
    ['valueRole', 'string[]'],
    ['valueText', 'string[]'],
  ],
  path: 'examples/kern-canonicalizer/canonicalizer.kern',
  profileRows: { nodes: 38, properties: 51, values: 455 },
  quotedReturns: false,
  returns: 'string',
};

const SOURCE_SHA256 = 'de5eb248401e933a05c7f55789a872f07c084c28e140f6561dd4205b71c57e00';
const GENERATED_ARTIFACTS = new Map([
  ['examples/kern-canonicalizer/canonicalizer.composed.kern',
    'fe5087dfcb79898a4b5d46cd233a2bbbeea156417f18ac314e87330172e31b28'],
  ['scripts/kern-canonicalizer/composition.json',
    '894cf14bc391d3109a20fb6abef8d1c98cab426e2ed6d238d414c8aee46cff3b'],
  ['examples/capstone-checker-subset/main.kern',
    'c73f0356534ee83eac5d81609d178fcbc67709a0c3ca291a62f79eeb9ad19c2e'],
  ['examples/capstone-checker-subset/numeric-main.kern',
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a'],
  ['examples/capstone-assertion-engine/main.kern',
    'a9df3dca6aa1eb6aa705446e4bb37ee7934ce507fb059e791ca42ed624cc9a03'],
  ['examples/selfhost-validator/main.kern',
    '9ac7774a50ad9bcb7852340baf6844f130066f7eb004aa3b56e1974ce2a469b7'],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertM477ParameterTarget(
  root,
  fact,
  target = M477_PARAMETER_MIGRATION_TARGET,
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

export function assertM477ParameterMigration(receipt) {
  const target = M477_PARAMETER_MIGRATION_TARGET;
  const sourceBytes = readFileSync(new URL(`../../${target.path}`, import.meta.url));
  const source = sourceBytes.toString('utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  assert.equal(sha256(sourceBytes), SOURCE_SHA256);
  assert.equal(source.split('\n').length - 1, 449);
  const roots = document.root.children.filter(({ type }) => type === 'fn');
  assert.equal(roots.length, 5);
  assert.deepEqual(
    roots.filter(({ props }) => typeof props.params === 'string').map(({ props }) => props.name),
    ['exprsource', 'tablesok', 'canonicalize'],
  );
  const fact = receipt.functions.find(({ id }) => id === target.id);
  assertM477ParameterTarget(roots[target.functionOrdinal], fact, target);

  for (const [path, digest] of GENERATED_ARTIFACTS) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), digest);
  }
}
