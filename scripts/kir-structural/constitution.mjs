export const STRUCTURAL_KIR_FORMAT = 'kern.kir.structural.r1.5h.1';

const PROPERTY_POLICIES = Object.freeze({
  identifier: ['included-value', 'portable-identifier'],
  string: ['included-value', 'portable-text'],
  boolean: ['included-value', 'portable-boolean'],
  number: ['included-value', 'portable-number-text'],
  importPath: ['lowered-import-path', 'normalized-import-path'],
  expression: ['lowered-expression', 'portable-expression-required'],
  rawExpr: ['excluded-host-expression', 'opaque-host-expression-forbidden'],
  typeAnnotation: ['excluded-host-type', 'portable-type-grammar-required'],
  rawBlock: ['excluded-raw-block', 'opaque-host-block-forbidden'],
});

const PROPERTY_POLICY_OVERRIDE_ROWS = Object.freeze([
  Object.freeze({
    key: 'branch.on',
    schemaKind: 'rawExpr',
    disposition: 'lowered-expression',
    reasonId: 'portable-expression-required',
  }),
  Object.freeze({
    key: 'each.in',
    schemaKind: 'rawExpr',
    disposition: 'lowered-each-collection-reference',
    reasonId: 'portable-each-collection-reference-required',
  }),
  Object.freeze({
    key: 'expression-v1.expr',
    schemaKind: 'rawExpr',
    disposition: 'lowered-expression',
    reasonId: 'portable-expression-required',
  }),
  Object.freeze({
    key: 'path.value',
    schemaKind: 'string',
    disposition: 'lowered-branch-path-value',
    reasonId: 'portable-branch-path-value',
  }),
]);

function compareCodePoints(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function buildPropertyPolicyOverrideMap(rows, nodeTypes, nodeSchemas) {
  const catalog = new Set(nodeTypes);
  const overrides = new Map();
  for (const row of rows) {
    if (overrides.has(row.key)) throw new Error(`duplicate property policy override at ${row.key}`);
    const separator = row.key.indexOf('.');
    const nodeKind = row.key.slice(0, separator);
    const propertyName = row.key.slice(separator + 1);
    const schema = nodeSchemas[nodeKind]?.props[propertyName];
    if (separator <= 0 || separator !== row.key.lastIndexOf('.') || !catalog.has(nodeKind) || schema === undefined) {
      throw new Error(`property policy override target drift at ${row.key}`);
    }
    if (schema.kind !== row.schemaKind) {
      throw new Error(`property policy override schema drift at ${row.key}`);
    }
    overrides.set(row.key, row);
  }
  return overrides;
}

function propertyRow(nodeKind, propertyName, schema, overrides) {
  const override = overrides.get(`${nodeKind}.${propertyName}`);
  if (override !== undefined && schema.kind !== override.schemaKind) {
    throw new Error(`property policy override schema drift at ${nodeKind}.${propertyName}`);
  }
  const policy =
    override === undefined ? (nodeKind === 'fn' && propertyName === 'returns'
      ? ['lowered-type', 'portable-handler-return-type']
      : nodeKind === 'param' && propertyName === 'type'
        ? ['lowered-type', 'portable-handler-parameter-type']
        : nodeKind === 'fn' && propertyName === 'params'
          ? ['excluded-host-type', 'structured-handler-parameters-required']
          : PROPERTY_POLICIES[schema.kind]) : [override.disposition, override.reasonId];
  if (policy === undefined) throw new Error(`unknown property kind ${schema.kind} at ${nodeKind}.${propertyName}`);
  return {
    nodeKind,
    propertyName,
    schemaKind: schema.kind,
    required: schema.required === true,
    values: schema.values === undefined ? null : [...schema.values],
    disposition: policy[0],
    reasonId: policy[1],
  };
}

export function buildStructuralConstitution(nodeTypes, nodeSchemas) {
  const catalog = new Set(nodeTypes);
  const overrides = buildPropertyPolicyOverrideMap(PROPERTY_POLICY_OVERRIDE_ROWS, nodeTypes, nodeSchemas);
  const nodes = [];
  const properties = [];
  for (const nodeKind of nodeTypes) {
    const schema = nodeSchemas[nodeKind];
    if (schema === undefined) {
      nodes.push({
        id: nodeKind,
        schemaStatus: 'missing',
        allowedChildren: null,
        disposition: 'excluded-explicit',
        reasonId: 'missing-node-schema',
      });
      continue;
    }
    nodes.push({
      id: nodeKind,
      schemaStatus: 'bound',
      allowedChildren: schema.allowedChildren === undefined ? null : [...schema.allowedChildren],
      disposition: 'structural-candidate',
      reasonId: 'schema-bound',
    });
    for (const [propertyName, propertySchema] of Object.entries(schema.props).sort(([left], [right]) => compareCodePoints(left, right))) {
      properties.push(propertyRow(nodeKind, propertyName, propertySchema, overrides));
    }
  }
  const nonCatalogSchemas = Object.keys(nodeSchemas)
    .filter((nodeKind) => !catalog.has(nodeKind))
    .sort(compareCodePoints)
    .map((id) => {
      const schema = nodeSchemas[id];
      return {
        id,
        reasonId: 'outside-source-catalog',
        allowedChildren: schema.allowedChildren === undefined ? null : [...schema.allowedChildren],
        properties: Object.entries(schema.props)
          .sort(([left], [right]) => compareCodePoints(left, right))
          .map(([propertyName, propertySchema]) => ({
            propertyName,
            schemaKind: propertySchema.kind,
            required: propertySchema.required === true,
            values: propertySchema.values === undefined ? null : [...propertySchema.values],
          })),
      };
    });
  return {
    schemaVersion: 1,
    format: STRUCTURAL_KIR_FORMAT,
    proofLabel: 'ALPHA-NO-GO',
    counts: {
      sourceNodes: nodes.length,
      boundNodes: nodes.filter((node) => node.schemaStatus === 'bound').length,
      missingSchemas: nodes.filter((node) => node.schemaStatus === 'missing').length,
      properties: properties.length,
      nonCatalogSchemas: nonCatalogSchemas.length,
    },
    nodes,
    properties,
    nonCatalogSchemas,
  };
}

export function validateStructuralConstitution(actual, nodeTypes, nodeSchemas) {
  const expected = buildStructuralConstitution(nodeTypes, nodeSchemas);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('structural KIR constitution drifted from NODE_TYPES or NODE_SCHEMAS');
  }
  return expected.counts;
}

export function renderStructuralRuntimeCatalog(constitution) {
  const propertiesByNode = new Map();
  for (const property of constitution.properties) {
    const properties = propertiesByNode.get(property.nodeKind) ?? {};
    properties[property.propertyName] = {
      schemaKind: property.schemaKind,
      required: property.required,
      values: property.values,
      disposition: property.disposition,
      reasonId: property.reasonId,
    };
    propertiesByNode.set(property.nodeKind, properties);
  }
  const catalog = constitution.nodes.map((node) => [node.id, {
      schemaStatus: node.schemaStatus,
      allowedChildren: node.allowedChildren,
      disposition: node.disposition,
      reasonId: node.reasonId,
      properties: propertiesByNode.get(node.id) ?? {},
    }]);
  return [
    '// Generated by scripts/kir-structural/generate-constitution.mjs. Do not edit.',
    "import type { StructuralNodeContract } from './types.js';",
    '',
    `export const STRUCTURAL_KIR_CONSTITUTION_FORMAT = '${constitution.format}' as const;`,
    `export const STRUCTURAL_KIR_PROOF_LABEL = '${constitution.proofLabel}' as const;`,
    '// biome-ignore format: generated catalog is byte-bound to the source constitution',
    'export const STRUCTURAL_KIR_NODE_CATALOG = new Map(',
    `  ${JSON.stringify(catalog, null, 2)}`,
    ') as unknown as ReadonlyMap<string, StructuralNodeContract>;',
    '',
  ].join('\n');
}
