import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  assertDirectParameterPrefix,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M482_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '89bda0c358c1a825dd05d9843fc436f2cfa8e061181315a29fa1365b7a1ed7a0',
  exported: false,
  functionOrdinal: 16,
  id: 'examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore',
  name: 'checkWhileCore',
  parameters: [
    ['row', 'number'],
    ['stmtKind', 'string[]'],
    ['stmtFn', 'string[]'],
    ['stmtParent', 'number[]'],
    ['stmtName', 'string[]'],
    ['stmtTarget', 'string[]'],
    ['stmtExprKind', 'string[]'],
    ['stmtExprName', 'string[]'],
    ['stmtExprNum', 'string[]'],
    ['stmtExprLeftKind', 'string[]'],
    ['stmtExprLeftName', 'string[]'],
    ['stmtExprLeftNum', 'string[]'],
    ['stmtExprLeftMemberObject', 'string[]'],
    ['stmtExprLeftMemberProp', 'string[]'],
    ['stmtExprRightKind', 'string[]'],
    ['stmtExprRightName', 'string[]'],
    ['stmtExprRightNum', 'string[]'],
    ['stmtExprRightMemberObject', 'string[]'],
    ['stmtExprRightMemberProp', 'string[]'],
    ['paramFn', 'string[]'],
    ['paramName', 'string[]'],
    ['paramType', 'string[]'],
  ],
  path: 'examples/capstone-checker-subset/checker-while.kern',
  profileRows: { nodes: 38, properties: 61, values: 460 },
  quotedReturns: false,
  returns: 'string',
};

const SOURCE_SHA256 = '525d929ef2f52482b27128b0a936f4b3e491e949b404d7bb0ca33658f95daef7';
const GENERATED_ARTIFACTS = new Map([
  ['examples/capstone-checker-subset/main.kern',
    '80bf569b3114daa205f9df594a9a796ec04be92a59be8c27ddb2594fd03667cf'],
  ['examples/capstone-checker-subset/numeric-main.kern',
    '4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a'],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertM482ParameterTarget(
  root,
  fact,
  target = M482_PARAMETER_MIGRATION_TARGET,
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

export function assertM482ParameterMigration(coverage) {
  const target = M482_PARAMETER_MIGRATION_TARGET;
  const sourceBytes = readFileSync(new URL(`../../${target.path}`, import.meta.url));
  const source = sourceBytes.toString('utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  assert.equal(sha256(sourceBytes), SOURCE_SHA256);
  const roots = document.root.children.filter(({ type }) => type === 'fn');
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM482ParameterTarget(roots[target.functionOrdinal], fact, target);
  assert.equal(source.split('\n').length - 1, 325);
  assert.equal(roots.length, 18);
  assert.deepEqual(
    roots.filter(({ props }) => typeof props.params === 'string').map(({ props }) => props.name),
    ['numericBindingProven', 'lengthReceiverProven', 'comparisonOperandsOk'],
  );
  for (const [path, digest] of GENERATED_ARTIFACTS) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), digest);
  }
  return fact;
}
