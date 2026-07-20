import { readFileSync } from 'node:fs';

import { STRUCTURAL_KIR_NODE_CATALOG } from '../../packages/core/dist/kir-structural/catalog.generated.js';

const FAMILY_REGISTRY_FORMAT = 'kern.kir-canonicalizer.coverage-family-registry.1';
const FAMILY_REGISTRY_SOURCE = readFileSync(new URL('./coverage-family-registry.json', import.meta.url));
export const STRUCTURAL_EXPRESSION_KINDS = new Set([
  'binary', 'boolean', 'call', 'conditional', 'decimal', 'identifier', 'index',
  'integer', 'lambda', 'list', 'member', 'null', 'record', 'text', 'unary',
]);

function fail(message) {
  throw new TypeError(`coverage policy rejection: ${message}`);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain record`);
  const actual = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    actual.some((key) => typeof key !== 'string') ||
    actual.some((key) => descriptors[key].get || descriptors[key].set || !descriptors[key].enumerable)
  ) {
    fail(`${label} must be inspectable plain data`);
  }
  const sorted = [...actual].sort();
  if (sorted.length !== keys.length || sorted.some((key, index) => key !== keys[index])) {
    fail(`${label} must contain exactly ${keys.join(',')}`);
  }
  return value;
}

function sortedUniqueText(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) fail(`${label}[${index}] must be non-empty text`);
    return entry;
  });
  const sorted = [...new Set(result)].sort(compareText);
  if (sorted.length !== result.length || sorted.some((entry, index) => entry !== result[index])) {
    fail(`${label} must be sorted and unique`);
  }
  return result;
}

function sameText(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isCatalogExcludedProperty(identity) {
  const separator = identity.indexOf('.');
  const contract = STRUCTURAL_KIR_NODE_CATALOG.get(identity.slice(0, separator));
  const name = identity.slice(separator + 1);
  return separator > 0 && contract?.properties[name]?.disposition.startsWith('excluded-') === true;
}

function loadFamilyRegistry() {
  const input = JSON.parse(FAMILY_REGISTRY_SOURCE.toString('utf8'));
  const registry = record(input, ['families', 'format'], 'family registry');
  if (registry.format !== FAMILY_REGISTRY_FORMAT) fail(`family registry format must be ${FAMILY_REGISTRY_FORMAT}`);
  if (!Array.isArray(registry.families) || registry.families.length === 0) fail('family registry cannot be empty');
  const result = new Map();
  const claimedNodes = new Set();
  const claimedExpressions = new Set();
  const claimedProperties = new Set();
  for (const [index, entry] of registry.families.entries()) {
    const family = record(
      entry,
      ['expressionKinds', 'id', 'nodeKinds', 'propertyKeys'],
      `family registry[${index}]`,
    );
    const id = family.id;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/u.test(id) || result.has(id)) {
      fail(`invalid duplicate family registry id ${String(id)}`);
    }
    const nodeKinds = sortedUniqueText(family.nodeKinds, `family registry[${index}].nodeKinds`);
    const expressionKinds = sortedUniqueText(family.expressionKinds, `family registry[${index}].expressionKinds`);
    const propertyKeys = sortedUniqueText(family.propertyKeys, `family registry[${index}].propertyKeys`);
    if (nodeKinds.length + expressionKinds.length + propertyKeys.length === 0) {
      fail(`family registry ${id} cannot be empty`);
    }
    for (const kind of nodeKinds) {
      if (STRUCTURAL_KIR_NODE_CATALOG.get(kind)?.disposition !== 'structural-candidate') {
        fail(`family registry ${id} invents node kind ${kind}`);
      }
      if (claimedNodes.has(kind)) fail(`family registry duplicates node kind ${kind}`);
      claimedNodes.add(kind);
    }
    for (const kind of expressionKinds) {
      if (!STRUCTURAL_EXPRESSION_KINDS.has(kind)) fail(`family registry ${id} invents expression kind ${kind}`);
      if (claimedExpressions.has(kind)) fail(`family registry duplicates expression kind ${kind}`);
      claimedExpressions.add(kind);
    }
    for (const propertyKey of propertyKeys) {
      const separator = propertyKey.indexOf('.');
      const nodeKind = propertyKey.slice(0, separator);
      const properties = STRUCTURAL_KIR_NODE_CATALOG.get(nodeKind)?.properties ?? {};
      const propertyName = propertyKey.slice(separator + 1);
      const property = Object.hasOwn(properties, propertyName) ? properties[propertyName] : undefined;
      if (
        separator <= 0 ||
        !nodeKinds.includes(nodeKind) ||
        property === undefined ||
        property.disposition.startsWith('excluded-')
      ) {
        fail(`family registry ${id} invents property key ${propertyKey}`);
      }
      if (claimedProperties.has(propertyKey)) fail(`family registry duplicates property key ${propertyKey}`);
      claimedProperties.add(propertyKey);
    }
    result.set(id, { expressionKinds, id, nodeKinds, propertyKeys });
  }
  const ids = [...result.keys()];
  if (!sameText(ids, [...ids].sort(compareText))) fail('family registry ids must be sorted');
  return result;
}

export function coverageFamilyRegistrySource() {
  return Buffer.from(FAMILY_REGISTRY_SOURCE);
}

export function validateCoverageFamilies(families, base) {
  if (!Array.isArray(families) || families.length === 0) fail('families must be a non-empty array');
  const registry = loadFamilyRegistry();
  const claimedNodes = new Set(base.nodeKinds);
  const claimedExpressions = new Set(base.expressionKinds);
  const claimedProperties = new Set(base.propertyKeys);
  const ids = [];
  const result = families.map((entry, index) => {
    const family = record(entry, ['expressionKinds', 'id', 'nodeKinds', 'propertyKeys'], `families[${index}]`);
    const id = family.id;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/u.test(id)) fail(`families[${index}].id must be stable`);
    const nodeKinds = sortedUniqueText(family.nodeKinds, `families[${index}].nodeKinds`);
    const expressionKinds = sortedUniqueText(family.expressionKinds, `families[${index}].expressionKinds`);
    const propertyKeys = sortedUniqueText(family.propertyKeys, `families[${index}].propertyKeys`);
    const registered = registry.get(id);
    if (
      registered === undefined ||
      !sameText(nodeKinds, registered.nodeKinds) ||
      !sameText(expressionKinds, registered.expressionKinds) ||
      !sameText(propertyKeys, registered.propertyKeys)
    ) {
      fail(`family ${id} must exactly match the frozen family registry`);
    }
    for (const kind of nodeKinds) {
      if (claimedNodes.has(kind)) fail(`node kind ${kind} is claimed by multiple profiles`);
      claimedNodes.add(kind);
    }
    for (const kind of expressionKinds) {
      if (claimedExpressions.has(kind)) fail(`expression kind ${kind} is claimed by multiple profiles`);
      claimedExpressions.add(kind);
    }
    for (const propertyKey of propertyKeys) {
      if (claimedProperties.has(propertyKey)) fail(`property key ${propertyKey} is claimed by multiple profiles`);
      claimedProperties.add(propertyKey);
    }
    ids.push(id);
    return { expressionKinds, id, nodeKinds, propertyKeys };
  });
  if (!sameText(ids, [...new Set(ids)].sort(compareText))) fail('family ids must be sorted and unique');
  return result;
}

export function assertFamiliesCoverageClosed(policy, functions) {
  const claims = {
    expressions: new Set(policy.families.flatMap(({ expressionKinds }) => expressionKinds)),
    nodes: new Set(policy.families.flatMap(({ nodeKinds }) => nodeKinds)),
    properties: new Set(policy.families.flatMap(({ propertyKeys }) => propertyKeys)),
  };
  const observed = {
    expressions: new Set(functions.flatMap(({ expressionKinds }) => expressionKinds)
      .filter((kind) => !policy.base.expressionKinds.includes(kind))),
    nodes: new Set(functions.flatMap(({ nodeKinds }) => nodeKinds)
      .filter((kind) => !policy.base.nodeKinds.includes(kind))),
    properties: new Set(functions.flatMap(({ propertyKeys = [] }) => propertyKeys)
      .filter((key) => !policy.base.propertyKeys.includes(key) && !isCatalogExcludedProperty(key))),
  };
  for (const category of ['nodes', 'expressions', 'properties']) {
    const singular = category === 'nodes' ? 'node kind' : category === 'expressions' ? 'expression kind' : 'property';
    for (const fact of [...observed[category]].sort(compareText)) {
      if (!claims[category].has(fact)) fail(`unclaimed ${singular} ${fact}`);
    }
    for (const fact of [...claims[category]].sort(compareText)) {
      if (!observed[category].has(fact)) fail(`unobserved ${singular} ${fact}`);
    }
  }
  return policy;
}
