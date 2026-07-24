import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  assertDirectParameterPrefix,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M461_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '2a5418abe4f41fc08fdf17b6822de65dfd444015884ed9f63093dbb7b1946bdf',
  exported: true,
  functionOrdinal: 19,
  id: 'examples/selfhost-validator/validator.kern#19:sortstrings',
  name: 'sortstrings',
  parameters: [['xs', 'string[]']],
  path: 'examples/selfhost-validator/validator.kern',
  profileRows: { nodes: 25, properties: 43, values: 266 },
  quotedReturns: false,
  returns: 'string[]',
};

export function assertM461ParameterTarget(root, fact, target = M461_PARAMETER_MIGRATION_TARGET) {
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

const GENERATED_ARTIFACTS = new Map([
  ['examples/capstone-assertion-engine/main.kern',
    'a9df3dca6aa1eb6aa705446e4bb37ee7934ce507fb059e791ca42ed624cc9a03'],
  ['examples/capstone-checker-subset/main.kern',
    'c73f0356534ee83eac5d81609d178fcbc67709a0c3ca291a62f79eeb9ad19c2e'],
  ['examples/capstone-checker-subset/numeric-main.kern',
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a'],
  ['examples/selfhost-validator/main.kern',
    '9ac7774a50ad9bcb7852340baf6844f130066f7eb004aa3b56e1974ce2a469b7'],
  ['examples/kern-canonicalizer/canonicalizer.composed.kern',
    '974b8d3ba6fefac4861152be88181c176feda56df9aa820e9f8d3a89e0488f8d'],
  ['scripts/kern-canonicalizer/composition.json',
    '2e8a4f77f6f343e7a16b42522b74afce3fd91272df3261431cb8e8950c17105d'],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertM461ParameterMigration(receipt) {
  const target = M461_PARAMETER_MIGRATION_TARGET;
  const sourceBytes = readFileSync(new URL(`../../${target.path}`, import.meta.url));
  const source = sourceBytes.toString('utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  assert.equal(sha256(sourceBytes), 'a9d278832edf050f3a96699980d88fa740f345d85192222b241bb6cc3ac2a2ee');
  assert.equal(source.split('\n').length - 1, 536);
  const roots = document.root.children.filter(({ type }) => type === 'fn');
  assert.equal(roots.length, 21);
  assert.deepEqual(
    roots.filter(({ props }) => typeof props.params === 'string').map(({ props }) => props.name),
    ['isreserved', 'exportkind', 'validate'],
  );
  const fact = receipt.functions.find(({ id }) => id === target.id);
  assertM461ParameterTarget(roots[target.functionOrdinal], fact, target);

  for (const [path, digest] of GENERATED_ARTIFACTS) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), digest);
  }
}
