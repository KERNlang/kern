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
  sourceSha256: '02037b400eb35d2fd61a5eaf06e6b83fbd9bb1c12bbe71da82bc39327169c592',
  tool: 'canonicalizer',
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
