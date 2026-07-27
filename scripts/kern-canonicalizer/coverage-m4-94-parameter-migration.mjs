import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { currentM493ParameterMigration } from './coverage-current.mjs';
import {
  assertDirectParameterPrefix,
  semanticBodyDigest,
} from './coverage-value-band-parameter-migrations.mjs';

export const M494_PARAMETER_MIGRATION_TARGET = {
  bodyDigest: '796d3e287b0cb3e4dd7e534309dffabdb49ffcf7e1a560ad953c0767228f9203',
  exported: true,
  functionOrdinal: 4,
  id: 'examples/kern-canonicalizer/canonicalizer.kern#4:tablesok',
  name: 'tablesok',
  parameters: [
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
  path: 'examples/kern-canonicalizer/canonicalizer.kern',
  profileRows: { nodes: 19, properties: 33, values: 156 },
  quotedReturns: false,
  returns: 'boolean',
  tool: 'canonicalizer',
};

export function assertM494ParameterTarget(
  root,
  fact,
  target = M494_PARAMETER_MIGRATION_TARGET,
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

export function assertM494ParameterMigration(coverage, prerequisite) {
  const target = M494_PARAMETER_MIGRATION_TARGET;
  assert.deepEqual(
    currentM493ParameterMigration(),
    {
      completeFunctions: 1,
      completeTools: 1,
      migratedParameterRows: target.parameters.length,
      witnesses: [{
        id: target.id,
        parameterRows: target.parameters.length,
        profileRows: target.profileRows,
        tool: target.tool,
      }],
    },
    'M4.94 must consume the exact M4.93 parameter queue',
  );
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const roots = document.root.children.filter(({ type }) => type === 'fn');
  const root = roots[target.functionOrdinal];
  const fact = coverage.functions.find(({ id }) => id === target.id);
  assertM494ParameterTarget(root, fact, target);

  assert.equal(coverage.baseCompleteFunctions, 89);
  assert.equal(coverage.functions.length, 109);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) =>
      excludedProperties.includes('fn.params')).length,
    17,
  );
  assert.equal(
    prerequisite.parameterMigration.witnesses.some(({ id }) => id === target.id),
    false,
    'M4.94 migrated tablesok must never re-enter a later parameter queue',
  );
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  return fact;
}
