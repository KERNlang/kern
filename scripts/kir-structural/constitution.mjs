export const STRUCTURAL_KIR_FORMAT = 'kern.kir.structural.alpha.1';

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

function compareCodePoints(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function propertyRow(nodeKind, propertyName, schema) {
  const policy = PROPERTY_POLICIES[schema.kind];
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
      properties.push(propertyRow(nodeKind, propertyName, propertySchema));
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
