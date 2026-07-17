const TABLE_KEYS = [
  'nodeKind', 'nodeParent', 'nodeOrder', 'propNode', 'propKey', 'propValue',
  'valueTag', 'valueParent', 'valueRole', 'valueOrder', 'valueText', 'valueBool',
];
const VALUE_TAGS = new Set(['null', 'bool', 'text', 'int', 'decimal', 'list', 'record', 'map', 'error']);
const SCALAR_TAGS = new Set(['null', 'bool', 'text', 'int', 'decimal']);
const textEncoder = new TextEncoder();

function fail(message) {
  throw new TypeError(`adapter rejection: ${message}`);
}

function denseArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label} must be a dense plain array`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must be a dense plain array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail(`${label} must be a dense plain array`);
    }
  }
  return value;
}

function safeInt(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(`${label} must be an integer >= ${minimum}`);
  return value;
}

function text(value, label) {
  if (typeof value !== 'string') fail(`${label} must be text`);
  return value;
}

function compareCodePoints(left, right) {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index].codePointAt(0) - rightPoints[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function compareBytes(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function scalarBytes(value) {
  const normalized = value.tag === 'null' ? { tag: value.tag } : { tag: value.tag, value: value.value };
  return textEncoder.encode(JSON.stringify(normalized));
}

function exactTables(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    fail('tables must be a plain record');
  }
  const keys = Reflect.ownKeys(input);
  const expected = [...TABLE_KEYS].sort();
  if (keys.some((key) => typeof key === 'symbol')) fail('tables have unknown fields');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (keys.some((key) => descriptors[key].get || descriptors[key].set || !descriptors[key].enumerable)) {
    fail('tables must be inspectable plain data');
  }
  keys.sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('tables have unknown fields');
  }
  for (const key of TABLE_KEYS) denseArray(input[key], key);
  if (input.nodeKind.length !== input.nodeParent.length || input.nodeKind.length !== input.nodeOrder.length) {
    fail('node table lengths differ');
  }
  if (input.propNode.length !== input.propKey.length || input.propNode.length !== input.propValue.length) {
    fail('property table lengths differ');
  }
  const valueLength = input.valueTag.length;
  for (const key of ['valueParent', 'valueRole', 'valueOrder', 'valueText', 'valueBool']) {
    if (input[key].length !== valueLength) fail('value table lengths differ');
  }
  return input;
}

function assertParentGraph(parents, label) {
  for (let index = 0; index < parents.length; index += 1) {
    let current = index + 1;
    for (let depth = 0; depth <= parents.length; depth += 1) {
      const parent = safeInt(parents[current - 1], `${label}[${current - 1}]`);
      if (parent === 0) break;
      if (parent > parents.length) fail(`${label}[${current - 1}] points outside the table`);
      if (parent >= current) fail(`${label}[${current - 1}] must reference an earlier row`);
      current = parent;
      if (depth === parents.length) fail(`${label} contains a cycle`);
    }
  }
}

function assertSiblingOrders(parents, orders, label) {
  const byParent = new Map();
  for (let index = 0; index < parents.length; index += 1) {
    const parent = parents[index];
    const order = safeInt(orders[index], `${label}Order[${index}]`);
    const group = byParent.get(parent) ?? [];
    group.push(order);
    byParent.set(parent, group);
  }
  for (const [parent, group] of byParent) {
    const sorted = [...group].sort((left, right) => left - right);
    if (sorted.some((order, index) => order !== index)) fail(`${label} siblings of ${parent} must have dense unique order`);
  }
}

export function rehydrateKirRoots(input) {
  const tables = exactTables(input);
  const nodeCount = tables.nodeKind.length;
  const valueCount = tables.valueTag.length;
  assertParentGraph(tables.nodeParent, 'nodeParent');
  assertParentGraph(tables.valueParent, 'valueParent');
  assertSiblingOrders(tables.nodeParent, tables.nodeOrder, 'node');

  const valuesByParent = Array.from({ length: valueCount + 1 }, () => []);
  for (let index = 0; index < valueCount; index += 1) {
    const tag = text(tables.valueTag[index], `valueTag[${index}]`);
    if (!VALUE_TAGS.has(tag)) fail(`unknown canonical value tag ${tag}`);
    const parent = safeInt(tables.valueParent[index], `valueParent[${index}]`);
    if (parent > valueCount) fail(`valueParent[${index}] points outside the table`);
    text(tables.valueRole[index], `valueRole[${index}]`);
    const order = safeInt(tables.valueOrder[index], `valueOrder[${index}]`);
    if (parent === 0 && order !== 0) fail(`root value ${index + 1} must have order 0`);
    text(tables.valueText[index], `valueText[${index}]`);
    if (tables.valueBool[index] !== 0 && tables.valueBool[index] !== 1) fail(`valueBool[${index}] must be 0 or 1`);
    if (parent > 0) valuesByParent[parent].push(index + 1);
  }

  const rootReferences = new Array(valueCount + 1).fill(0);
  const propsByNode = Array.from({ length: nodeCount + 1 }, () => []);
  for (let index = 0; index < tables.propNode.length; index += 1) {
    const node = safeInt(tables.propNode[index], `propNode[${index}]`, 1);
    const value = safeInt(tables.propValue[index], `propValue[${index}]`, 1);
    if (node > nodeCount || value > valueCount) fail(`property row ${index} points outside a table`);
    if (tables.valueParent[value - 1] !== 0 || tables.valueRole[value - 1] !== '') fail(`property row ${index} must point to a root value`);
    rootReferences[value] += 1;
    propsByNode[node].push({ key: text(tables.propKey[index], `propKey[${index}]`), value });
  }
  for (let id = 1; id <= valueCount; id += 1) {
    if (tables.valueParent[id - 1] === 0 && rootReferences[id] !== 1) fail(`root value ${id} must have one property owner`);
    if (tables.valueParent[id - 1] !== 0 && rootReferences[id] !== 0) fail(`child value ${id} cannot be a property root`);
  }
  for (let id = 1; id <= nodeCount; id += 1) {
    const keys = propsByNode[id].map((entry) => entry.key);
    if (new Set(keys).size !== keys.length) fail(`node ${id} has duplicate properties`);
  }

  const cache = new Map();
  function valueAt(id) {
    if (cache.has(id)) return cache.get(id);
    const index = id - 1;
    const tag = tables.valueTag[index];
    const children = valuesByParent[id];
    const textValue = tables.valueText[index];
    const boolValue = tables.valueBool[index];
    if (SCALAR_TAGS.has(tag)) {
      if (children.length !== 0) fail(`scalar value ${id} cannot have children`);
      if (tag === 'null') {
        if (textValue !== '' || boolValue !== 0) fail(`null value ${id} has payload`);
        return { tag: 'null' };
      }
      if (tag === 'bool') {
        if (textValue !== '') fail(`boolean value ${id} has text payload`);
        return { tag: 'bool', value: boolValue === 1 };
      }
      if (boolValue !== 0) fail(`${tag} value ${id} has boolean payload`);
      if (tag === 'int' && !/^(?:0|-?[1-9][0-9]*)$/u.test(textValue)) {
        fail(`integer value ${id} is not canonical`);
      }
      if (tag === 'decimal') {
        const match = /^-?(0|[1-9][0-9]*)\.([0-9]+)$/u.exec(textValue);
        if (!match || (textValue.startsWith('-') && match[1] === '0' && /^0+$/u.test(match[2]))) {
          fail(`decimal value ${id} is not canonical`);
        }
      }
      return { tag, value: textValue };
    }
    if (textValue !== '' || boolValue !== 0) fail(`composite value ${id} has scalar payload`);
    const ordered = [...children].sort((left, right) => tables.valueOrder[left - 1] - tables.valueOrder[right - 1]);
    if (tag === 'list') {
      if (ordered.some((child, order) => tables.valueRole[child - 1] !== 'list-item' || tables.valueOrder[child - 1] !== order)) {
        fail(`list value ${id} has malformed role or order`);
      }
      return { tag: 'list', value: ordered.map(valueAt) };
    }
    if (tag === 'record') {
      const entries = ordered.map((child, order) => {
        const role = tables.valueRole[child - 1];
        if (!role.startsWith('record:') || tables.valueOrder[child - 1] !== order) fail(`record value ${id} has malformed role or order`);
        return { key: role.slice('record:'.length), value: valueAt(child) };
      });
      for (let index = 1; index < entries.length; index += 1) {
        const comparison = compareCodePoints(entries[index - 1].key, entries[index].key);
        if (comparison >= 0) fail(`record value ${id} has duplicate or noncanonical key order`);
      }
      return { tag: 'record', value: entries };
    }
    if (tag === 'map') {
      const byOrder = new Map();
      for (const child of ordered) {
        const order = tables.valueOrder[child - 1];
        const role = tables.valueRole[child - 1];
        if (role !== 'map-key' && role !== 'map-value') fail(`map value ${id} has malformed role`);
        const entry = byOrder.get(order) ?? {};
        if (entry[role] !== undefined) fail(`map value ${id} has duplicate ${role}`);
        entry[role] = child;
        byOrder.set(order, entry);
      }
      const orders = [...byOrder.keys()].sort((left, right) => left - right);
      if (orders.some((order, index) => order !== index)) fail(`map value ${id} has sparse order`);
      const entries = orders.map((order) => {
        const entry = byOrder.get(order);
        if (entry['map-key'] === undefined || entry['map-value'] === undefined) fail(`map value ${id} has incomplete entry`);
        const key = valueAt(entry['map-key']);
        if (!SCALAR_TAGS.has(key.tag)) fail(`map value ${id} has non-scalar key`);
        return { key, value: valueAt(entry['map-value']) };
      });
      let previous;
      for (const entry of entries) {
        const encoded = scalarBytes(entry.key);
        if (previous !== undefined && compareBytes(previous, encoded) >= 0) {
          fail(`map value ${id} has duplicate or noncanonical key order`);
        }
        previous = encoded;
      }
      return { tag: 'map', value: entries };
    }
    const roles = new Map(children.map((child) => [tables.valueRole[child - 1], child]));
    if (roles.size !== children.length || !roles.has('error-code') || !roles.has('error-message')) fail(`error value ${id} has malformed fields`);
    if ([...roles.keys()].some((role) => !['error-code', 'error-message', 'error-details'].includes(role))) fail(`error value ${id} has unknown field`);
    for (const [role, order] of [['error-code', 0], ['error-message', 1], ['error-details', 2]]) {
      const child = roles.get(role);
      if (child !== undefined && tables.valueOrder[child - 1] !== order) fail(`error value ${id} has malformed order`);
    }
    const code = valueAt(roles.get('error-code'));
    const message = valueAt(roles.get('error-message'));
    if (code.tag !== 'text' || message.tag !== 'text') fail(`error value ${id} code and message must be text`);
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(code.value)) fail(`error value ${id} code is not canonical`);
    return {
      tag: 'error',
      value: {
        code: code.value,
        message: message.value,
        details: roles.has('error-details') ? valueAt(roles.get('error-details')) : null,
      },
    };
  }

  const childrenByNode = Array.from({ length: nodeCount + 1 }, () => []);
  for (let index = 0; index < nodeCount; index += 1) {
    text(tables.nodeKind[index], `nodeKind[${index}]`);
    const parent = safeInt(tables.nodeParent[index], `nodeParent[${index}]`);
    if (parent > nodeCount) fail(`nodeParent[${index}] points outside the table`);
    if (parent > 0) childrenByNode[parent].push(index + 1);
  }
  function nodeAt(id) {
    const children = [...childrenByNode[id]].sort((left, right) => tables.nodeOrder[left - 1] - tables.nodeOrder[right - 1]);
    return {
      kind: tables.nodeKind[id - 1],
      properties: propsByNode[id].map((entry) => ({ key: entry.key, value: valueAt(entry.value) })),
      children: children.map(nodeAt),
    };
  }
  return tables.nodeParent
    .map((parent, index) => ({ parent, id: index + 1 }))
    .filter((entry) => entry.parent === 0)
    .sort((left, right) => tables.nodeOrder[left.id - 1] - tables.nodeOrder[right.id - 1])
    .map((entry) => nodeAt(entry.id));
}
