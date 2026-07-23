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
    '68b80ab1a720bc2de985fb624ce6f5d543c981d56fcd78816bc44b860a128020'],
  ['examples/capstone-checker-subset/numeric-main.kern',
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a'],
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

export function assertM461ParameterMigration(receipt) {
  const target = M461_PARAMETER_MIGRATION_TARGET;
  const sourceBytes = readFileSync(new URL(`../../${target.path}`, import.meta.url));
  const source = sourceBytes.toString('utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  assert.equal(sha256(sourceBytes), '99717668519d853fa83805189626957c1565a415dbfd135c9fe3b1abccfb46a4');
  assert.equal(source.split('\n').length - 1, 514);
  const roots = document.root.children.filter(({ type }) => type === 'fn');
  assert.equal(roots.length, 21);
  assert.deepEqual(
    roots.filter(({ props }) => typeof props.params === 'string').map(({ props }) => props.name),
    ['isreserved', 'fnokat', 'ownexportkind', 'exportkind', 'validate'],
  );
  const fact = receipt.functions.find(({ id }) => id === target.id);
  assertM461ParameterTarget(roots[target.functionOrdinal], fact, target);

  for (const [path, digest] of GENERATED_ARTIFACTS) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), digest);
  }
}
