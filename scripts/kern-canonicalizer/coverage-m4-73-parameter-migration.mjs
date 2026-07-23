import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';

import {
  assertDirectParameterPrefix,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M473_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '477cf24c525529da58576d47f0fc00a7d4439ff5653193460f65efea57929b53',
  exported: true,
  functionOrdinal: 1,
  id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#1:validstatementlist',
  name: 'validstatementlist',
  parameters: [
    ['parent', 'number'],
    ['returnType', 'string'],
    ['nodeKind', 'string[]'],
    ['nodeParent', 'number[]'],
    ['nodeOrder', 'number[]'],
    ['propNode', 'number[]'],
    ['propKey', 'string[]'],
    ['propValue', 'number[]'],
    ['valueTag', 'string[]'],
    ['valueParent', 'number[]'],
    ['valueRole', 'string[]'],
    ['valueOrder', 'number[]'],
    ['valueText', 'string[]'],
    ['valueBool', 'number[]'],
  ],
  path: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern',
  profileRows: { nodes: 31, properties: 53, values: 370 },
  quotedReturns: false,
  returns: 'boolean',
};

const SOURCE_SHA256 = '158175ac9404fb93acc5b82fc8b87d10f2946a11b228ce9686f2423f75bcf667';
const GENERATED_ARTIFACTS = new Map([
  ['examples/kern-canonicalizer/canonicalizer.composed.kern',
    'c1b42e6183731a757cdad7150339ec38090c11aeaa6404095ae16f34412a3b89'],
  ['scripts/kern-canonicalizer/composition.json',
    '25303c8fc07467fe5eb20dd0ba4b0e2aa074e4e133ace9919d4a82e8c6c87289'],
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

export function assertM473ParameterTarget(
  root,
  fact,
  target = M473_PARAMETER_MIGRATION_TARGET,
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

export function assertM473ParameterMigration(receipt) {
  const target = M473_PARAMETER_MIGRATION_TARGET;
  const sourceBytes = readFileSync(new URL(`../../${target.path}`, import.meta.url));
  const source = sourceBytes.toString('utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  assert.equal(sha256(sourceBytes), SOURCE_SHA256);
  assert.equal(source.split('\n').length - 1, 196);
  const roots = document.root.children.filter(({ type }) => type === 'fn');
  assert.equal(roots.length, 5);
  assert.deepEqual(
    roots.filter(({ props }) => typeof props.params === 'string').map(({ props }) => props.name),
    ['validstatement', 'emitstatement'],
  );
  const fact = receipt.functions.find(({ id }) => id === target.id);
  assertM473ParameterTarget(roots[target.functionOrdinal], fact, target);

  for (const [path, digest] of GENERATED_ARTIFACTS) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), digest);
  }
}
