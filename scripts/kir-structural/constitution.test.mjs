import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { NODE_SCHEMAS } from '../../packages/core/dist/schema.js';
import { NODE_TYPES } from '../../packages/core/dist/spec.js';
import {
  buildPropertyPolicyOverrideMap,
  buildRunnerSyntheticConstitution,
  buildStructuralConstitution,
  RUNNER_SYNTHETIC_NODE_SCHEMAS,
  RUNNER_SYNTHETIC_PROPERTY_POLICY_OVERRIDE_ROWS,
  renderStructuralRuntimeCatalog,
  validateStructuralConstitution,
} from './constitution.mjs';

const checkedIn = JSON.parse(readFileSync('scripts/kir-structural/constitution.json', 'utf8'));

function clone(value) {
  return structuredClone(value);
}

test('checked-in constitution binds the complete live source and property catalogs', () => {
  const counts = validateStructuralConstitution(checkedIn, NODE_TYPES, NODE_SCHEMAS);
  assert.deepEqual(counts, {
    sourceNodes: 302,
    boundNodes: 300,
    missingSchemas: 2,
    properties: 1149,
    nonCatalogSchemas: 7,
    runnerSyntheticNodes: 1,
    runnerSyntheticProperties: 1,
  });
});

test('runner-synthetic lambda stays separate from the source catalog', () => {
  assert.equal(checkedIn.nodes.some((node) => node.id === 'lambda'), false);
  assert.equal(checkedIn.properties.some((property) => property.nodeKind === 'lambda'), false);
  assert.deepEqual(checkedIn.runnerSyntheticNodes, [
    {
      id: 'lambda',
      schemaStatus: 'bound',
      allowedChildren: [],
      allowedParents: ['handler'],
      disposition: 'structural-candidate',
      reasonId: 'runner-contract-only',
    },
  ]);
  assert.deepEqual(checkedIn.runnerSyntheticProperties, [
    {
      nodeKind: 'lambda',
      propertyName: 'expr',
      schemaKind: 'rawExpr',
      required: true,
      values: null,
      disposition: 'lowered-expression',
      reasonId: 'portable-expression-required',
    },
  ]);
});

test('generated browser-safe runtime catalog is byte-bound to the constitution', () => {
  const catalog = readFileSync('packages/core/src/kir-structural/catalog.generated.ts', 'utf8');
  assert.equal(catalog, renderStructuralRuntimeCatalog(checkedIn));
});

test('missing schemas and non-catalog schemas remain explicit', () => {
  const missing = checkedIn.nodes.filter((node) => node.schemaStatus === 'missing');
  assert.deepEqual(missing, [
    { id: 'alternate-screen', schemaStatus: 'missing', allowedChildren: null, disposition: 'excluded-explicit', reasonId: 'missing-node-schema' },
    { id: 'scroll-box', schemaStatus: 'missing', allowedChildren: null, disposition: 'excluded-explicit', reasonId: 'missing-node-schema' },
  ]);
  assert.deepEqual(checkedIn.nonCatalogSchemas.map((row) => row.id), [
    'case', 'fixture', 'mock', 'replaceAll', 'replaceFirst', 'split', 'trim',
  ]);
});

test('catalog and schema drift cannot be absorbed silently', () => {
  const deletedNode = clone(checkedIn);
  deletedNode.nodes.pop();
  assert.throws(() => validateStructuralConstitution(deletedNode, NODE_TYPES, NODE_SCHEMAS), /constitution drifted/u);

  const inventedCatalog = [...NODE_TYPES, 'invented-node'];
  assert.throws(() => validateStructuralConstitution(checkedIn, inventedCatalog, NODE_SCHEMAS), /constitution drifted/u);

  const changedSchema = clone(NODE_SCHEMAS);
  changedSchema.fn.props.name.required = false;
  assert.throws(() => validateStructuralConstitution(checkedIn, NODE_TYPES, changedSchema), /constitution drifted/u);

  const changedAlias = clone(NODE_SCHEMAS);
  changedAlias.trim.props.in.kind = 'string';
  assert.throws(() => validateStructuralConstitution(checkedIn, NODE_TYPES, changedAlias), /constitution drifted/u);
});

test('property disposition and ordering mutations fail', () => {
  const disposition = clone(checkedIn);
  disposition.properties[0].disposition = 'excluded-host-type';
  assert.throws(() => validateStructuralConstitution(disposition, NODE_TYPES, NODE_SCHEMAS), /constitution drifted/u);

  const reordered = clone(checkedIn);
  [reordered.properties[0], reordered.properties[1]] = [reordered.properties[1], reordered.properties[0]];
  assert.throws(() => validateStructuralConstitution(reordered, NODE_TYPES, NODE_SCHEMAS), /constitution drifted/u);

  const enumValues = clone(checkedIn);
  const constrained = enumValues.properties.find((row) => row.values !== null);
  constrained.values.reverse();
  assert.throws(() => validateStructuralConstitution(enumValues, NODE_TYPES, NODE_SCHEMAS), /constitution drifted/u);
});

test('only structured runtime-handler type locations are lowered', () => {
  const typeRows = checkedIn.properties.filter((row) => row.schemaKind === 'typeAnnotation');
  assert.equal(typeRows.length, 95);
  assert.deepEqual(
    typeRows
      .filter((row) => row.disposition === 'lowered-type')
      .map((row) => `${row.nodeKind}.${row.propertyName}`),
    ['fn.returns', 'param.type'],
  );
  assert.equal(typeRows.filter((row) => row.disposition === 'excluded-host-type').length, 93);
  assert.deepEqual(
    checkedIn.properties.find((row) => row.nodeKind === 'fn' && row.propertyName === 'params'),
    {
      nodeKind: 'fn',
      propertyName: 'params',
      schemaKind: 'string',
      required: false,
      values: null,
      disposition: 'excluded-host-type',
      reasonId: 'structured-handler-parameters-required',
    },
  );
});

test('source overrides and runner-synthetic overrides remain disjoint', () => {
  assert.equal(checkedIn.format, 'kern.kir.structural.r1.5i.1');
  assert.deepEqual(
    checkedIn.properties
      .filter((row) => row.disposition === 'lowered-each-collection-reference')
      .map((row) => `${row.nodeKind}.${row.propertyName}`),
    ['each.in'],
  );
  assert.deepEqual(
    checkedIn.properties
      .filter((row) => row.schemaKind === 'rawExpr' && row.disposition === 'lowered-expression')
      .map((row) => `${row.nodeKind}.${row.propertyName}`),
    ['branch.on', 'expression-v1.expr'],
  );
  assert.deepEqual(
    checkedIn.properties
      .filter((row) => row.disposition === 'lowered-branch-path-value')
      .map((row) => `${row.nodeKind}.${row.propertyName}`),
    ['path.value'],
  );
  const eachInput = checkedIn.properties.find((row) => row.nodeKind === 'each' && row.propertyName === 'in');
  assert.equal(eachInput.required, true);
  assert.equal(eachInput.disposition, 'lowered-each-collection-reference');
  const type = checkedIn.properties.find(
    (row) => row.nodeKind === 'expression-v1' && row.propertyName === 'type',
  );
  assert.equal(type.required, false);
  assert.equal(type.disposition, 'excluded-host-type');
  assert.deepEqual(
    checkedIn.runnerSyntheticProperties.map((row) => `${row.nodeKind}.${row.propertyName}:${row.disposition}`),
    ['lambda.expr:lowered-expression'],
  );
});

test('property policy overrides fail closed when a source schema drifts', () => {
  const schemas = clone(NODE_SCHEMAS);
  schemas.branch.props.on.kind = 'identifier';
  assert.throws(
    () => buildStructuralConstitution(NODE_TYPES, schemas),
    /property policy override schema drift/u,
  );

  const missingTarget = clone(NODE_SCHEMAS);
  delete missingTarget.path.props.value;
  assert.throws(
    () => buildStructuralConstitution(NODE_TYPES, missingTarget),
    /property policy override target drift/u,
  );
});

test('property policy override rows reject invented and duplicate pairs', () => {
  const row = {
    key: 'expression-v1.expr',
    schemaKind: 'rawExpr',
    disposition: 'lowered-expression',
    reasonId: 'portable-expression-required',
  };
  assert.throws(
    () => buildPropertyPolicyOverrideMap([{ ...row, key: 'expression-v1.invented' }], NODE_TYPES, NODE_SCHEMAS),
    /property policy override target drift/u,
  );
  assert.throws(
    () => buildPropertyPolicyOverrideMap([row, { ...row }], NODE_TYPES, NODE_SCHEMAS),
    /duplicate property policy override/u,
  );
});

test('runner-synthetic authority rejects overlap, invented overrides, duplicates, and schema drift', () => {
  assert.throws(
    () => buildRunnerSyntheticConstitution([...NODE_TYPES, 'lambda']),
    /overlaps the source catalog/u,
  );
  assert.throws(
    () =>
      buildRunnerSyntheticConstitution(
        NODE_TYPES,
        RUNNER_SYNTHETIC_NODE_SCHEMAS,
        [{ ...RUNNER_SYNTHETIC_PROPERTY_POLICY_OVERRIDE_ROWS[0], key: 'lambda.invented' }],
      ),
    /property policy override target drift/u,
  );
  assert.throws(
    () =>
      buildRunnerSyntheticConstitution(
        NODE_TYPES,
        RUNNER_SYNTHETIC_NODE_SCHEMAS,
        [
          RUNNER_SYNTHETIC_PROPERTY_POLICY_OVERRIDE_ROWS[0],
          RUNNER_SYNTHETIC_PROPERTY_POLICY_OVERRIDE_ROWS[0],
        ],
      ),
    /duplicate property policy override/u,
  );
  const schemas = clone(RUNNER_SYNTHETIC_NODE_SCHEMAS);
  schemas.lambda.props.expr.kind = 'identifier';
  assert.throws(
    () => buildRunnerSyntheticConstitution(NODE_TYPES, schemas),
    /property policy override schema drift/u,
  );
});

test('unknown schema property kinds fail constitution generation', () => {
  const schemas = clone(NODE_SCHEMAS);
  schemas.fn.props.name.kind = 'host-mystery';
  assert.throws(() => buildStructuralConstitution(NODE_TYPES, schemas), /unknown property kind/u);
});
