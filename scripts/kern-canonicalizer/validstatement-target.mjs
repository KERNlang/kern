import assert from 'node:assert/strict';

import {
  assertDirectParameterPrefix,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const VALIDSTATEMENT_DIRECT_TARGET = {
  bodyDigest: 'd9eff1b46ed9e8a9df69c05b4274ec98e09ed8f0401165a6bb75da88df0e6243',
  exported: true,
  functionOrdinal: 2,
  id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement',
  name: 'validstatement',
  parameters: [
    ['id', 'number'],
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
  profileRows: { nodes: 89, properties: 125, values: 1873 },
  quotedReturns: false,
  returns: 'boolean',
  sourceSha256: '11485f2b657a002e8ff4ca93db7b0122768163c65edecb3a1f13da4906569d75',
  tool: 'canonicalizer',
};

export const CURRENT_VALIDSTATEMENT_TARGET_M4129 = {
  ...VALIDSTATEMENT_DIRECT_TARGET,
  bodyDigest: '2ca0aef35e4ed0d77224a92c05dc7b2836fc84d2ad19230f45b09042804912a9',
  profileRows: { nodes: 90, properties: 127, values: 1882 },
  sourceSha256: '67af44e97b0e874295f312e4c8033a13c57045a38ca2179c6c00b53abb68b5ce',
};

export function assertValidstatementDirectRoot(
  root,
  target = VALIDSTATEMENT_DIRECT_TARGET,
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
  return root;
}
