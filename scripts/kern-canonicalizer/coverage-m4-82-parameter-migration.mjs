import assert from 'node:assert/strict';
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
  const roots = document.root.children.filter(({ type }) => type === 'fn');
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM482ParameterTarget(roots[target.functionOrdinal], fact, target);
  assert.equal(roots.length, 18);
  return fact;
}
