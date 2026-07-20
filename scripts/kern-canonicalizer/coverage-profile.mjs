import { CanonicalValueDecodeError } from '../../packages/core/dist/canonical-value/types.js';
import {
  decodeStructuralKir,
  encodeStructuralKir,
} from '../../packages/core/dist/kir-structural/canonical.js';
import { STRUCTURAL_KIR_NODE_CATALOG } from '../../packages/core/dist/kir-structural/catalog.generated.js';
import {
  projectExpressionText,
  validateExpressionValue,
} from '../../packages/core/dist/kir-structural/expression.js';
import { StructuralKirError } from '../../packages/core/dist/kir-structural/types.js';

import { flattenKirRoots } from './flatten.mjs';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const RESERVED_EXPRESSION_IDENTIFIERS = new Set([
  'await', 'false', 'new', 'none', 'null', 'true', 'typeof', 'undefined',
]);
const PARAMETER_TYPES = new Set([
  'boolean', 'boolean[]', 'number', 'number[]', 'string', 'string[]',
]);
const RETURN_TYPES = new Set([...PARAMETER_TYPES, 'void']);
const BASE_EXPRESSION_KINDS = [
  'binary', 'boolean', 'call', 'identifier', 'integer', 'list', 'null', 'text',
];
const BASE_PROFILE_ID = 'kern.kir-canonicalizer.profile.m4.5c';
const BASE_PROMOTIONS = [
  {
    family: 'binary-expression',
    selectionProvenanceDigest: '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027',
  },
  {
    family: 'conditional',
    selectionProvenanceDigest: 'fe15f0ff4b8b80653ddef7f3b8736f38fa2b34a928d05a32bb9eff4d0f254f2b',
  },
  {
    family: 'call-expression',
    selectionProvenanceDigest: '7eee28b09785d36539e45293afbe0325fe9b50c20ffc7057e0aa3997d9371605',
  },
];
const BASE_NODE_KINDS = ['else', 'fn', 'handler', 'if', 'param', 'return'];
const BASE_PROPERTIES = Object.freeze({
  else: { optional: [], required: [] },
  fn: { optional: ['export'], required: ['name', 'returns'] },
  handler: { optional: [], required: ['lang'] },
  if: { optional: [], required: ['cond'] },
  param: { optional: [], required: ['name', 'type'] },
  return: { optional: ['value'], required: [] },
});
const BASE_PROPERTY_KEYS = BASE_NODE_KINDS.flatMap((kind) =>
  Object.keys(STRUCTURAL_KIR_NODE_CATALOG.get(kind)?.properties ?? {}).map((key) => `${kind}.${key}`)
).sort();
const PROFILE_LIMIT_KEYS = ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'];
const PROFILE_ROW_KEYS = ['nodes', 'properties', 'values'];
const STATEMENT_CONTAINERS = new Set(['else', 'for', 'handler', 'if', 'while']);
const STATEMENT_KINDS = new Set(['assign', 'do', 'else', 'for', 'if', 'let', 'return', 'throw', 'while']);

export function recursiveStatementNodeKinds(nodeKinds) {
  return nodeKinds.filter((kind) => kind !== 'return' && STATEMENT_KINDS.has(kind));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameText(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateCoverageBase(base) {
  if (
    base.id !== BASE_PROFILE_ID ||
    !sameText(base.nodeKinds, BASE_NODE_KINDS) ||
    !sameText(base.expressionKinds, BASE_EXPRESSION_KINDS) ||
    !sameText(base.propertyKeys, BASE_PROPERTY_KEYS) ||
    JSON.stringify(base.promotions) !== JSON.stringify(BASE_PROMOTIONS)
  ) {
    throw new TypeError('coverage policy rejection: base must exactly match the M4.5c cumulative profile');
  }
  return base;
}

function expressionSource(value, path) {
  if (typeof value === 'string') return value;
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.__expr === true &&
    typeof value.code === 'string' &&
    Reflect.ownKeys(value).length === 2
  ) {
    return value.code;
  }
  throw new TypeError(`coverage profile rejection: malformed expression payload at ${path}`);
}

function canonicalRecord(value) {
  if (value?.tag !== 'record') return null;
  return new Map(value.value.map((entry) => [entry.key, entry.value]));
}

function localBaseExpressionBlocker(value) {
  const root = canonicalRecord(value);
  const kind = root?.get('kind');
  const fieldsValue = root?.get('fields');
  const fields = canonicalRecord(fieldsValue);
  if (root?.size !== 2 || kind?.tag !== 'text' || fields === null) return 'expression.shape';
  if (kind.value === 'null') return fields.size === 0 ? null : 'expression.null.shape';
  if (kind.value === 'identifier') {
    const name = fields.get('name');
    if (fields.size !== 1 || name?.tag !== 'text' || !IDENTIFIER.test(name.value)) {
      return 'expression.identifier.shape';
    }
    return RESERVED_EXPRESSION_IDENTIFIERS.has(name.value) ? `expression.identifier.${name.value}` : null;
  }
  if (kind.value === 'boolean') {
    return fields.size === 1 && fields.get('value')?.tag === 'bool' ? null : 'expression.boolean.shape';
  }
  if (kind.value === 'integer') {
    const integer = fields.get('value');
    return fields.size === 1 && integer?.tag === 'int' && INTEGER.test(integer.value)
      ? null
      : `expression.integer.${integer?.tag === 'int' ? integer.value : 'shape'}`;
  }
  if (kind.value === 'text') {
    const text = fields.get('value');
    if (fields.size !== 1 || text?.tag !== 'text') return 'expression.text.shape';
    for (let index = 0; index < text.value.length; index += 1) {
      const code = text.value.charCodeAt(index);
      if (
        (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
        (code >= 0x7f && code <= 0x9f) ||
        code === 0x2028 ||
        code === 0x2029 ||
        code === 0xfeff
      ) {
        return `expression.text.character-u${code.toString(16).padStart(4, '0')}`;
      }
    }
    return null;
  }
  if (kind.value === 'binary') {
    try {
      validateExpressionValue(value, '$.binary');
      return null;
    } catch (error) {
      if (error instanceof StructuralKirError) return 'expression.binary.shape';
      throw error;
    }
  }
  if (kind.value === 'call') {
    try {
      validateExpressionValue(value, '$.call');
    } catch (error) {
      if (error instanceof StructuralKirError) return 'expression.call.shape';
      throw error;
    }
    return fields.get('optional')?.value === false ? null : 'expression.call.optional';
  }
  if (kind.value !== 'list') return `expression.${kind.value}.profile`;
  const items = fields.get('items');
  return fields.size === 1 && items?.tag === 'list' ? null : 'expression.list.shape';
}

export function baseExpressionProfileBlockers(value, base) {
  const blockers = [];
  function visit(current) {
    const root = canonicalRecord(current);
    const kind = root?.get('kind');
    const fields = root?.get('fields');
    if (root?.size === 2 && kind?.tag === 'text' && fields?.tag === 'record') {
      if (base.expressionKinds.includes(kind.value)) {
        const blocker = localBaseExpressionBlocker(current);
        if (blocker !== null) blockers.push(blocker);
      }
      visit(fields);
      return;
    }
    if (current?.tag === 'list') {
      for (const item of current.value) visit(item);
    } else if (current?.tag === 'record') {
      for (const entry of current.value) visit(entry.value);
    } else if (current?.tag === 'map') {
      for (const entry of current.value) {
        visit(entry.key);
        visit(entry.value);
      }
    }
  }
  visit(value);
  return [...new Set(blockers)].sort(compareText);
}

function includedUnexpectedProperties(node, profile) {
  const allowed = new Set([...profile.required, ...profile.optional]);
  const contract = STRUCTURAL_KIR_NODE_CATALOG.get(node.type);
  return Object.keys(node.props ?? {}).filter((key) =>
    !allowed.has(key) &&
    (!Object.hasOwn(contract?.properties ?? {}, key) || !contract.properties[key].disposition.startsWith('excluded-')),
  );
}

function validBoolean(value) {
  return value === true || value === false || value === 'true' || value === 'false';
}

function statementChildrenInvalid(node) {
  const children = node.children ?? [];
  if (!STATEMENT_CONTAINERS.has(node.type)) {
    return STATEMENT_KINDS.has(node.type) && children.length !== 0;
  }
  const kinds = children.map(({ type }) => type);
  if (kinds.some((kind) => !STATEMENT_KINDS.has(kind))) return true;
  const returns = kinds.flatMap((kind, index) => kind === 'return' ? [index] : []);
  if (returns.length > 1 || (returns.length === 1 && returns[0] !== kinds.length - 1)) return true;
  return kinds.some((kind, index) => kind === 'else' && kinds[index - 1] !== 'if');
}

export function canonicalProfileRowsForFunction(root, limits) {
  const artifact = decodeStructuralKir(encodeStructuralKir(root, limits), limits);
  const tables = flattenKirRoots([artifact.root]);
  return {
    nodes: tables.nodeKind.length,
    properties: tables.propNode.length,
    values: tables.valueTag.length,
  };
}

function collectProfileBlockersForFunction(root, base, profileLimits, profileRows) {
  validateCoverageBase(base);
  if (root?.type !== 'fn') return { authored: ['root.kind'], firstPath: '$', firstPosition: 0 };
  const events = [];
  const nodes = [];
  const locations = new WeakMap();
  let eventOrder = 0;
  let nodePosition = 0;
  const add = (blocker, node = null) => {
    const location = node === null ? { path: '$', position: nodePosition } : locations.get(node);
    events.push({ blocker, order: eventOrder++, path: location.path, position: location.position });
  };

  function visit(node, path) {
    nodes.push(node);
    locations.set(node, { path, position: nodePosition++ });
    if (statementChildrenInvalid(node)) add(`${node.type}.children`, node);
    const profile = Object.hasOwn(BASE_PROPERTIES, node.type) ? BASE_PROPERTIES[node.type] : undefined;
    if (profile) {
      for (const key of profile.required) {
        if (!Object.hasOwn(node.props ?? {}, key)) add(`${node.type}.properties.${key}`, node);
      }
      for (const key of includedUnexpectedProperties(node, profile)) add(`${node.type}.properties.${key}`, node);
    }
    if ((node.type === 'param' || node.type === 'return') && (node.children?.length ?? 0) !== 0) {
      add(`${node.type}.children`, node);
    }
    const contract = STRUCTURAL_KIR_NODE_CATALOG.get(node.type);
    for (const [key, value] of Object.entries(node.props ?? {})) {
      if (contract?.properties[key]?.disposition !== 'lowered-expression') continue;
      let projected;
      try {
        projected = projectExpressionText(expressionSource(value, `${node.type}.${key}`), `${node.type}.${key}`);
      } catch (error) {
        if (error instanceof StructuralKirError || error instanceof CanonicalValueDecodeError) continue;
        throw error;
      }
      for (const blocker of baseExpressionProfileBlockers(projected, base)) {
        add(`${node.type}.properties.${key}.${blocker}`, node);
      }
    }
    (node.children ?? []).forEach((child, index) => visit(child, `${path}.children[${index}]`));
  }
  visit(root, '$');

  const rootProperties = root.props ?? {};
  if (typeof rootProperties.name !== 'string' || !IDENTIFIER.test(rootProperties.name)) {
    add('fn.properties.name.value', root);
  }
  if (typeof rootProperties.returns !== 'string' || !RETURN_TYPES.has(rootProperties.returns)) {
    add('fn.properties.returns.value', root);
  }
  if (Object.hasOwn(rootProperties, 'export') && !validBoolean(rootProperties.export)) {
    add('fn.properties.export.value', root);
  }

  const directChildren = root.children ?? [];
  if (
    directChildren.length === 0 ||
    directChildren.at(-1)?.type !== 'handler' ||
    directChildren.slice(0, -1).some(({ type }) => type !== 'param')
  ) {
    add('fn.children', root);
  }
  const parameterNames = new Set();
  for (const param of directChildren.filter(({ type }) => type === 'param')) {
    if (typeof param.props?.name !== 'string' || !IDENTIFIER.test(param.props.name) || parameterNames.has(param.props.name)) {
      add('param.properties.name.value', param);
    }
    parameterNames.add(param.props?.name);
    if (typeof param.props?.type !== 'string' || !PARAMETER_TYPES.has(param.props.type)) {
      add('param.properties.type.value', param);
    }
  }

  const allKindsAreBase = nodes.every(({ type }) => base.nodeKinds.includes(type));
  for (const handler of nodes.filter(({ type }) => type === 'handler')) {
    if (handler.props?.lang !== 'kern') add('handler.properties.lang.value', handler);
    if (allKindsAreBase && (handler.children?.length ?? 0) === 0) {
      add('handler.children', handler);
    }
  }
  for (const returned of nodes.filter(({ type }) => type === 'return')) {
    const hasValue = Object.hasOwn(returned.props ?? {}, 'value');
    if ((rootProperties.returns === 'void' && hasValue) || (rootProperties.returns !== 'void' && !hasValue)) {
      add('return.properties.value', returned);
    }
  }
  if (profileLimits !== undefined) {
    const limitKeys = Reflect.ownKeys(profileLimits).toSorted();
    if (
      limitKeys.length !== PROFILE_LIMIT_KEYS.length ||
      limitKeys.some((key, index) => key !== PROFILE_LIMIT_KEYS[index]) ||
      PROFILE_LIMIT_KEYS.some((key) => !Number.isSafeInteger(profileLimits[key]) || profileLimits[key] < 1)
    ) {
      throw new TypeError('coverage profile rejection: invalid profile limits');
    }
    if (profileRows !== null) {
      const rowKeys = typeof profileRows !== 'object' || Array.isArray(profileRows)
        ? []
        : Reflect.ownKeys(profileRows);
      if (
        rowKeys.some((key) => typeof key !== 'string') ||
        rowKeys.length !== PROFILE_ROW_KEYS.length ||
        rowKeys.toSorted().some((key, index) => key !== PROFILE_ROW_KEYS[index]) ||
        PROFILE_ROW_KEYS.some((key) => !Number.isSafeInteger(profileRows[key]) || profileRows[key] < 0)
      ) {
        throw new TypeError('coverage profile rejection: invalid profile rows');
      }
      for (const [kind, limitName] of [
        ['nodes', 'maxNodeRows'],
        ['properties', 'maxPropertyRows'],
        ['values', 'maxValueRows'],
      ]) {
        if (profileRows[kind] > profileLimits[limitName]) add(`profile.rows.${kind}`);
      }
    }
  }
  const seen = new Set();
  const authoredEvents = events.toSorted((left, right) => left.position - right.position || left.order - right.order)
    .filter(({ blocker }) => !seen.has(blocker) && seen.add(blocker));
  return {
    authored: authoredEvents.map(({ blocker }) => blocker),
    firstPath: authoredEvents[0]?.path ?? null,
    firstPosition: authoredEvents[0]?.position ?? Number.POSITIVE_INFINITY,
  };
}

export function analyzeProfileBlockersForFunction(root, base, profileLimits, profileRows) {
  const { authored, firstPath, firstPosition } = collectProfileBlockersForFunction(
    root, base, profileLimits, profileRows,
  );
  return { blockers: [...authored].sort(compareText), first: authored[0] ?? null, firstPath, firstPosition };
}

export function firstUnsupportedByAuthoredOrder(structural, profile) {
  const firstStructural = structural[0] ?? null;
  if (profile.first !== null && profile.firstPosition < (firstStructural?.position ?? Number.POSITIVE_INFINITY)) {
    return { category: 'profile', path: profile.firstPath, value: profile.first };
  }
  return firstStructural === null ? null : {
    category: firstStructural.category,
    path: firstStructural.path,
    value: firstStructural.value,
  };
}

export function firstProfileBlockerForFunction(root, base, profileLimits, profileRows) {
  return analyzeProfileBlockersForFunction(root, base, profileLimits, profileRows).first;
}

export function profileBlockersForFunction(root, base, profileLimits, profileRows) {
  return analyzeProfileBlockersForFunction(root, base, profileLimits, profileRows).blockers;
}

export function handlerChildProfilesForFunction(root) {
  const profiles = [];
  function visit(node) {
    if (node.type === 'handler') profiles.push((node.children ?? []).map(({ type }) => type));
    for (const child of node.children ?? []) visit(child);
  }
  visit(root);
  return profiles;
}

export function handlerChildProfilesComplete(profile, profiles) {
  if (!Array.isArray(profiles)) return false;
  return profiles.every((childKinds) => {
    if (!Array.isArray(childKinds)) return false;
    if (childKinds.length === 1 && childKinds[0] === 'return') return true;
    if (
      profile.statementNodeKinds.size === 0 ||
      childKinds.length === 0 ||
      !childKinds.some((kind) => profile.statementNodeKinds.has(kind)) ||
      !childKinds.every((kind) => kind === 'return' || profile.statementNodeKinds.has(kind))
    ) return false;
    const returnIndexes = childKinds.flatMap((kind, index) => kind === 'return' ? [index] : []);
    if (returnIndexes.length > 1 || (returnIndexes.length === 1 && returnIndexes[0] !== childKinds.length - 1)) {
      return false;
    }
    return childKinds.every((kind, index) => kind !== 'else' || childKinds[index - 1] === 'if');
  });
}
