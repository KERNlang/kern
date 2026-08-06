import { readFileSync } from 'node:fs';

import {
  STRUCTURAL_KIR_CONSTITUTION_FORMAT,
  STRUCTURAL_KIR_NODE_CATALOG,
  STRUCTURAL_KIR_PROOF_LABEL,
} from '../../packages/core/dist/kir-structural/catalog.generated.js';
import { reconstructHistoricalSource } from './historical-source.mjs';
import {
  PRE_BRANCH_CONSTITUTION_SOURCE_DIGEST,
  PRE_BRANCH_CONSTITUTION_SOURCE_REPLACEMENTS,
} from './branch-path-structural-target.mjs';
import {
  PRE_EACH_CONSTITUTION_SOURCE_DIGEST,
  PRE_EACH_CONSTITUTION_SOURCE_REPLACEMENTS,
} from './each-collection-structural-target.mjs';
import {
  PRE_EXPRESSION_V1_CONSTITUTION_SOURCE_DIGEST,
  PRE_EXPRESSION_V1_CONSTITUTION_SOURCE_REPLACEMENTS,
} from './new-expression-structural-target.mjs';

const CONSTITUTION_SOURCE = readFileSync(new URL('../kir-structural/constitution.json', import.meta.url));
const CONSTITUTION_KEYS = ['counts', 'format', 'nodes', 'nonCatalogSchemas', 'proofLabel', 'properties', 'schemaVersion'];
const COUNT_KEYS = ['boundNodes', 'missingSchemas', 'nonCatalogSchemas', 'properties', 'sourceNodes'];
const NODE_KEYS = ['allowedChildren', 'disposition', 'id', 'reasonId', 'schemaStatus'];
const PROPERTY_KEYS = ['disposition', 'nodeKind', 'propertyName', 'reasonId', 'required', 'schemaKind', 'values'];
const NON_CATALOG_KEYS = ['allowedChildren', 'id', 'properties', 'reasonId'];
const NON_CATALOG_PROPERTY_KEYS = ['propertyName', 'required', 'schemaKind', 'values'];

function fail() {
  throw new TypeError(
    'coverage catalog rejection: runtime catalog does not match the structural constitution',
  );
}

function exactRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  const actual = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    actual.some((key) => typeof key !== 'string') ||
    actual.some((key) => descriptors[key].get || descriptors[key].set || !descriptors[key].enumerable) ||
    actual.length !== keys.length ||
    actual.toSorted().some((key, index) => key !== keys[index])
  ) fail();
  return value;
}

function text(value) {
  if (typeof value !== 'string' || value.length === 0) fail();
  return value;
}

function optionalTextArray(value) {
  if (value === null) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) fail();
}

function validatePropertyRow(property, keys = PROPERTY_KEYS) {
  exactRecord(property, keys);
  text(property.propertyName);
  text(property.schemaKind);
  if (Object.hasOwn(property, 'disposition')) text(property.disposition);
  if (Object.hasOwn(property, 'reasonId')) text(property.reasonId);
  if (typeof property.required !== 'boolean') fail();
  optionalTextArray(property.values);
}

function validateConstitutionShape(constitution) {
  exactRecord(constitution, CONSTITUTION_KEYS);
  exactRecord(constitution.counts, COUNT_KEYS);
  if (constitution.schemaVersion !== 1) fail();
  for (const key of COUNT_KEYS) {
    if (!Number.isSafeInteger(constitution.counts[key]) || constitution.counts[key] < 0) fail();
  }
  if (
    !Array.isArray(constitution.nodes) ||
    !Array.isArray(constitution.properties) ||
    !Array.isArray(constitution.nonCatalogSchemas)
  ) fail();
  const nodeIds = new Set();
  for (const node of constitution.nodes) {
    exactRecord(node, NODE_KEYS);
    text(node.id);
    text(node.schemaStatus);
    text(node.disposition);
    text(node.reasonId);
    optionalTextArray(node.allowedChildren);
    if (nodeIds.has(node.id)) fail();
    nodeIds.add(node.id);
  }
  const propertyIds = new Set();
  for (const property of constitution.properties) {
    validatePropertyRow(property);
    text(property.nodeKind);
    const id = `${property.nodeKind}\u0000${property.propertyName}`;
    if (!nodeIds.has(property.nodeKind) || propertyIds.has(id)) fail();
    propertyIds.add(id);
  }
  const nonCatalogIds = new Set();
  for (const schema of constitution.nonCatalogSchemas) {
    exactRecord(schema, NON_CATALOG_KEYS);
    text(schema.id);
    text(schema.reasonId);
    optionalTextArray(schema.allowedChildren);
    if (!Array.isArray(schema.properties) || nodeIds.has(schema.id) || nonCatalogIds.has(schema.id)) fail();
    nonCatalogIds.add(schema.id);
    const names = new Set();
    for (const property of schema.properties) {
      validatePropertyRow(property, NON_CATALOG_PROPERTY_KEYS);
      if (names.has(property.propertyName)) fail();
      names.add(property.propertyName);
    }
  }
  if (
    constitution.counts.sourceNodes !== constitution.nodes.length ||
    constitution.counts.boundNodes !== constitution.nodes.filter(({ schemaStatus }) => schemaStatus === 'bound').length ||
    constitution.counts.missingSchemas !== constitution.nodes.filter(({ schemaStatus }) => schemaStatus === 'missing').length ||
    constitution.counts.properties !== constitution.properties.length ||
    constitution.counts.nonCatalogSchemas !== constitution.nonCatalogSchemas.length
  ) fail();
  return constitution;
}

function expectedCatalog(constitution) {
  validateConstitutionShape(constitution);
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
  return constitution.nodes.map((node) => [node.id, {
    schemaStatus: node.schemaStatus,
    allowedChildren: node.allowedChildren,
    disposition: node.disposition,
    reasonId: node.reasonId,
    properties: propertiesByNode.get(node.id) ?? {},
  }]);
}

export function validateRuntimeCatalogConstitution(
  constitution,
  runtimeCatalog = STRUCTURAL_KIR_NODE_CATALOG,
) {
  validateConstitutionShape(constitution);
  if (
    constitution.format !== STRUCTURAL_KIR_CONSTITUTION_FORMAT ||
    constitution.proofLabel !== STRUCTURAL_KIR_PROOF_LABEL ||
    !(runtimeCatalog instanceof Map) ||
    JSON.stringify([...runtimeCatalog.entries()]) !== JSON.stringify(expectedCatalog(constitution))
  ) fail();
  return constitution;
}

export function loadValidatedRuntimeConstitutionSource() {
  validateRuntimeCatalogConstitution(JSON.parse(CONSTITUTION_SOURCE.toString('utf8')));
  return Buffer.from(CONSTITUTION_SOURCE);
}

export function resolveRuntimeConstitutionSource(source) {
  if (source === undefined) return loadValidatedRuntimeConstitutionSource();
  if (!(source instanceof Uint8Array)) fail();
  const bytes = Buffer.from(source);
  if (bytes.equals(loadValidatedRuntimeConstitutionSource())) return bytes;
  if (bytes.equals(loadPreEachRuntimeConstitutionSource())) return bytes;
  if (bytes.equals(loadPreBranchRuntimeConstitutionSource())) return bytes;
  if (bytes.equals(loadPreExpressionV1RuntimeConstitutionSource())) return bytes;
  fail();
}

export function loadPreEachRuntimeConstitutionSource() {
  return reconstructHistoricalSource({
    currentSource: loadValidatedRuntimeConstitutionSource(),
    expectedDigest: PRE_EACH_CONSTITUTION_SOURCE_DIGEST,
    milestone: 'pre-each structural constitution',
    replacements: PRE_EACH_CONSTITUTION_SOURCE_REPLACEMENTS,
  });
}

export function loadPreBranchRuntimeConstitutionSource() {
  return reconstructHistoricalSource({
    currentSource: loadPreEachRuntimeConstitutionSource(),
    expectedDigest: PRE_BRANCH_CONSTITUTION_SOURCE_DIGEST,
    milestone: 'pre-branch structural constitution',
    replacements: PRE_BRANCH_CONSTITUTION_SOURCE_REPLACEMENTS,
  });
}

export function loadPreExpressionV1RuntimeConstitutionSource() {
  return reconstructHistoricalSource({
    currentSource: loadPreBranchRuntimeConstitutionSource(),
    expectedDigest: PRE_EXPRESSION_V1_CONSTITUTION_SOURCE_DIGEST,
    milestone: 'pre-expression-v1 structural constitution',
    replacements: PRE_EXPRESSION_V1_CONSTITUTION_SOURCE_REPLACEMENTS,
  });
}
