import { rehydrateKirRoots } from './rehydrate.mjs';

const VALUE_TAGS = new Set(['null', 'bool', 'text', 'int', 'decimal', 'list', 'record', 'map', 'error']);

function fail(message) {
  throw new TypeError(`adapter rejection: ${message}`);
}

function plainRecord(value, fields, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a plain record`);
  if (Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain record`);
  const ownKeys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    ownKeys.some((key) => typeof key === 'symbol') ||
    ownKeys.some((key) => descriptors[key].get || descriptors[key].set || !descriptors[key].enumerable)
  ) {
    fail(`${label} must be inspectable plain data`);
  }
  const keys = ownKeys.sort();
  if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index])) {
    fail(`${label} must have exact fields ${fields.join(',')}`);
  }
  return value;
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

function text(value, label) {
  if (typeof value !== 'string') fail(`${label} must be text`);
  return value;
}

function mark(value, seen) {
  if (seen.has(value)) fail('cyclic or shared object graph');
  seen.add(value);
}

export function flattenKirRoots(input) {
  const seen = new WeakSet();
  const roots = denseArray(input, 'roots');
  mark(roots, seen);
  const tables = {
    nodeKind: [],
    nodeParent: [],
    nodeOrder: [],
    propNode: [],
    propKey: [],
    propValue: [],
    valueTag: [],
    valueParent: [],
    valueRole: [],
    valueOrder: [],
    valueText: [],
    valueBool: [],
  };

  function addValue(inputValue, parent, role, order, label) {
    const value = plainRecord(inputValue, Object.keys(inputValue ?? {}).sort(), label);
    mark(value, seen);
    const tag = text(value.tag, `${label}.tag`);
    if (!VALUE_TAGS.has(tag)) fail(`unknown canonical value tag ${tag}`);
    const scalar = tag === 'null' || tag === 'bool' || tag === 'text' || tag === 'int' || tag === 'decimal';
    const expectedFields = tag === 'null' ? ['tag'] : ['tag', 'value'];
    plainRecord(value, expectedFields, label);
    const id = tables.valueTag.length + 1;
    tables.valueTag.push(tag);
    tables.valueParent.push(parent);
    tables.valueRole.push(role);
    tables.valueOrder.push(order);
    tables.valueText.push(tag === 'text' || tag === 'int' || tag === 'decimal' ? text(value.value, `${label}.value`) : '');
    tables.valueBool.push(tag === 'bool' ? (value.value === true ? 1 : value.value === false ? 0 : fail(`${label}.value must be boolean`)) : 0);
    if (scalar) return id;

    if (tag === 'list') {
      const items = denseArray(value.value, `${label}.value`);
      mark(items, seen);
      items.forEach((item, index) =>
        addValue(item, id, 'list-item', index, `${label}.value[${index}]`),
      );
      return id;
    }
    if (tag === 'record') {
      const entries = denseArray(value.value, `${label}.value`);
      mark(entries, seen);
      entries.forEach((entryInput, index) => {
        const entry = plainRecord(entryInput, ['key', 'value'], `${label}.value[${index}]`);
        mark(entry, seen);
        addValue(entry.value, id, `record:${text(entry.key, `${label}.value[${index}].key`)}`, index, `${label}.value[${index}].value`);
      });
      return id;
    }
    if (tag === 'map') {
      const entries = denseArray(value.value, `${label}.value`);
      mark(entries, seen);
      entries.forEach((entryInput, index) => {
        const entry = plainRecord(entryInput, ['key', 'value'], `${label}.value[${index}]`);
        mark(entry, seen);
        addValue(entry.key, id, 'map-key', index, `${label}.value[${index}].key`);
        addValue(entry.value, id, 'map-value', index, `${label}.value[${index}].value`);
      });
      return id;
    }
    const error = plainRecord(value.value, ['code', 'details', 'message'], `${label}.value`);
    mark(error, seen);
    addValue({ tag: 'text', value: text(error.code, `${label}.value.code`) }, id, 'error-code', 0, `${label}.value.codeValue`);
    addValue(
      { tag: 'text', value: text(error.message, `${label}.value.message`) },
      id,
      'error-message',
      1,
      `${label}.value.messageValue`,
    );
    if (error.details !== null) addValue(error.details, id, 'error-details', 2, `${label}.value.details`);
    return id;
  }

  function addNode(inputNode, parent, order, label) {
    const node = plainRecord(inputNode, ['children', 'kind', 'properties'], label);
    mark(node, seen);
    const id = tables.nodeKind.length + 1;
    tables.nodeKind.push(text(node.kind, `${label}.kind`));
    tables.nodeParent.push(parent);
    tables.nodeOrder.push(order);
    const properties = denseArray(node.properties, `${label}.properties`);
    mark(properties, seen);
    properties.forEach((entryInput, index) => {
      const entry = plainRecord(entryInput, ['key', 'value'], `${label}.properties[${index}]`);
      mark(entry, seen);
      tables.propNode.push(id);
      tables.propKey.push(text(entry.key, `${label}.properties[${index}].key`));
      tables.propValue.push(addValue(entry.value, 0, '', 0, `${label}.properties[${index}].value`));
    });
    const children = denseArray(node.children, `${label}.children`);
    mark(children, seen);
    children.forEach((child, index) =>
      addNode(child, id, index, `${label}.children[${index}]`),
    );
  }

  roots.forEach((root, index) => addNode(root, 0, index, `roots[${index}]`));
  // Mandatory: this is the adapter's canonical scalar-spelling and table-shape validation pass.
  rehydrateKirRoots(tables);
  return tables;
}

export function tableArguments(tables) {
  return [
    tables.nodeKind,
    tables.nodeParent,
    tables.nodeOrder,
    tables.propNode,
    tables.propKey,
    tables.propValue,
    tables.valueTag,
    tables.valueParent,
    tables.valueRole,
    tables.valueOrder,
    tables.valueText,
    tables.valueBool,
  ];
}
