import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';

import {
  assertDirectParameterPrefix,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M469_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '991be5df8acc62f68778b8c74efe2013b2d621cbe6c5423dbfdff60e28797e34',
  exported: false,
  functionOrdinal: 2,
  id: 'examples/capstone-checker-subset/checker.kern#3:isSurfaceKind',
  name: 'isSurfaceKind',
  parameters: [['kind', 'string']],
  path: 'examples/capstone-checker-subset/checker.kern',
  profileRows: { nodes: 30, properties: 32, values: 219 },
  quotedReturns: false,
  returns: 'boolean',
};

const SOURCE_SHA256 = 'a703952e717a77015179987a4e5a6940b0b16846a9c122810e959a595eee5017';
const GENERATED_ARTIFACTS = new Map([
  ['examples/capstone-checker-subset/main.kern',
    'c73f0356534ee83eac5d81609d178fcbc67709a0c3ca291a62f79eeb9ad19c2e'],
  ['examples/capstone-checker-subset/numeric-main.kern',
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a'],
  ['examples/capstone-assertion-engine/main.kern',
    'a9df3dca6aa1eb6aa705446e4bb37ee7934ce507fb059e791ca42ed624cc9a03'],
  ['examples/selfhost-validator/main.kern',
    '9ac7774a50ad9bcb7852340baf6844f130066f7eb004aa3b56e1974ce2a469b7'],
  ['examples/kern-canonicalizer/canonicalizer.composed.kern',
    '94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56'],
  ['scripts/kern-canonicalizer/composition.json',
    'cab6c1e38591e0a75cf717691c9d7247b623ddc849bc65bdf021cdcd3b914995'],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertM469ParameterTarget(
  root,
  fact,
  target = M469_PARAMETER_MIGRATION_TARGET,
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

export function assertM469ParameterMigration(receipt) {
  const target = M469_PARAMETER_MIGRATION_TARGET;
  const sourceBytes = readFileSync(new URL(`../../${target.path}`, import.meta.url));
  const source = sourceBytes.toString('utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  assert.equal(sha256(sourceBytes), SOURCE_SHA256);
  assert.equal(source.split('\n').length - 1, 448);
  const roots = document.root.children.filter(({ type }) => type === 'fn');
  assert.equal(roots.length, 24);
  assert.deepEqual(
    roots.filter(({ props }) => typeof props.params === 'string').map(({ props }) => props.name),
    [
      'rejectLine', 'argProvenanced', 'paramCallsitesOk', 'indexRejectDetail',
      'mapKeyToken', 'mapKnownBefore', 'callRejectCode', 'checkModule',
    ],
  );
  const fact = receipt.functions.find(({ id }) => id === target.id);
  assertM469ParameterTarget(roots[target.functionOrdinal], fact, target);

  for (const [path, digest] of GENERATED_ARTIFACTS) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), digest);
  }
}
