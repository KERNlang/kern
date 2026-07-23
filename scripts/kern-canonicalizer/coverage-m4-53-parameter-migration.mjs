import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  assertDirectParameterPrefix,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M453_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '888c6809b7e88542783352ed8001d8617b72af76d3f692ad87789b3a327dec3b',
  functionOrdinal: 17,
  id: 'examples/selfhost-validator/validator.kern#17:classcyclefrom',
  name: 'classcyclefrom',
  parameters: [
    ['module', 'number'], ['name', 'string'], ['classModule', 'number[]'],
    ['className', 'string[]'], ['classExtends', 'string[]'], ['path', 'number[]'],
  ],
  path: 'examples/selfhost-validator/validator.kern',
  profileRows: { nodes: 19, properties: 31, values: 202 },
  returns: 'boolean',
};

const GENERATED_ARTIFACTS = new Map([
  ['examples/capstone-checker-subset/main.kern',
    'efebd94b0fc27368eb9f69ae60491d11d6dc0540937a430f4abdf96db45620bb'],
  ['examples/capstone-checker-subset/numeric-main.kern',
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a'],
  ['examples/selfhost-validator/main.kern',
    '9ac7774a50ad9bcb7852340baf6844f130066f7eb004aa3b56e1974ce2a469b7'],
  ['examples/kern-canonicalizer/canonicalizer.composed.kern',
    'cd182decf48bad672bbae25b8f74aecc13dd7d308379167c42e7230cf8e3cd23'],
  ['scripts/kern-canonicalizer/composition.json',
    '9e4c9d4b57e280c0ff0dc32f92bf6f79f992aaa076e6a6ee34dff8dbd1678d74'],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertM453ParameterTarget(root, fact, target = M453_PARAMETER_MIGRATION_TARGET) {
  assert.ok(root);
  assert.equal(root.props.name, target.name);
  assert.equal(root.props.params, undefined);
  assert.equal(root.props.returns, target.returns);
  assert.equal(root.props.export, 'true');
  assert.equal(root.__quotedProps?.includes('params') ?? false, false);
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

export function assertM453ParameterMigration(receipt) {
  const sourceBytes = readFileSync(new URL('../../examples/selfhost-validator/validator.kern', import.meta.url));
  const source = sourceBytes.toString('utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  assert.equal(sha256(sourceBytes), 'b8f2e779ced7577804686ac953cf555fffbc271b974bb29d64310245aa6270e2');
  assert.equal(source.split('\n').length - 1, 513);
  const roots = document.root.children.filter(({ type }) => type === 'fn');
  assert.equal(roots.length, 21);
  assert.deepEqual(
    roots.filter(({ props }) => typeof props.params === 'string').map(({ props }) => props.name),
    ['isreserved', 'fnokat', 'ownexportkind', 'exportkind', 'sortstrings', 'validate'],
  );
  const fact = receipt.functions.find(({ id }) => id === M453_PARAMETER_MIGRATION_TARGET.id);
  assertM453ParameterTarget(roots[M453_PARAMETER_MIGRATION_TARGET.functionOrdinal], fact);

  for (const [path, digest] of GENERATED_ARTIFACTS) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), digest);
  }
}
