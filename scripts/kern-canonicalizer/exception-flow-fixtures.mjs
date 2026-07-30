import { lines } from './fixture-helpers.mjs';

function nodeIds(tables, kind) {
  return tables.nodeKind.flatMap((value, index) => value === kind ? [index + 1] : []);
}

function propertyIndex(tables, node, key) {
  return tables.propNode.findIndex(
    (candidate, index) => candidate === node && tables.propKey[index] === key,
  );
}

function removeProperty(tables, index) {
  for (const key of ['propNode', 'propKey', 'propValue']) tables[key].splice(index, 1);
}

function appendRootTextProperty(tables, node, key, value) {
  tables.valueTag.push('text');
  tables.valueParent.push(0);
  tables.valueRole.push('');
  tables.valueOrder.push(0);
  tables.valueText.push(value);
  tables.valueBool.push(0);
  tables.propNode.push(node);
  tables.propKey.push(key);
  tables.propValue.push(tables.valueTag.length);
}

function replacePropertyExpressionKind(tables, node, key, kind) {
  const propIndex = propertyIndex(tables, node, key);
  if (propIndex < 0) throw new Error(`missing ${key} property on node ${node}`);
  const expressionId = tables.propValue[propIndex];
  const kindIndex = tables.valueRole.findIndex(
    (role, index) => role === 'record:kind' && tables.valueParent[index] === expressionId,
  );
  if (kindIndex < 0) throw new Error(`missing record:kind for ${key} property on node ${node}`);
  tables.valueText[kindIndex] = kind;
}

export const EXCEPTION_FLOW_VALID_FIXTURES = [
  {
    id: 'throw-valued-error',
    source: lines(
      'fn name=fail returns=void',
      '  param name=message type=string',
      '  handler lang=kern',
      '    throw value="new Error(message)"',
      '    return',
    ),
    golden: lines(
      'fn name=fail returns=void',
      '  param name=message type=string',
      '  handler lang="kern"',
      '    throw value="new Error(message)"',
      '    return',
    ),
  },
  {
    id: 'throw-nested-condition',
    source: lines(
      'fn name=requirePositive returns=number',
      '  param name=value type=number',
      '  handler lang=kern',
      '    if cond="value <= 0"',
      '      throw value="new Error(\\"positive required\\")"',
      '    return value=value',
    ),
    golden: lines(
      'fn name=requirePositive returns=number',
      '  param name=value type=number',
      '  handler lang="kern"',
      '    if cond="(value <= 0)"',
      '      throw value="new Error(\\"positive required\\")"',
      '    return value="value"',
    ),
  },
];

export const EXCEPTION_FLOW_HOSTILE_FIXTURES = [
  {
    id: 'throw-bare',
    base: 'throw-valued-error',
    category: 'profile rejection',
    mutate(tables) {
      const thrown = nodeIds(tables, 'throw')[0];
      const value = propertyIndex(tables, thrown, 'value');
      const expression = tables.propValue[value];
      removeProperty(tables, value);
      tables.propNode.push(nodeIds(tables, 'return')[0]);
      tables.propKey.push('value');
      tables.propValue.push(expression);
    },
  },
  {
    id: 'throw-duplicate-value',
    base: 'throw-valued-error',
    category: 'direct profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'throw')[0], 'value', 'duplicate');
    },
  },
  ...['trailingComment', 'future'].map((key) => ({
    id: `throw-${key}`,
    base: 'throw-valued-error',
    category: 'profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'throw')[0], key, 'excluded');
    },
  })),
  {
    id: 'throw-non-expression-value',
    base: 'throw-valued-error',
    category: 'profile rejection',
    mutate(tables) {
      const statement = nodeIds(tables, 'throw')[0];
      const value = propertyIndex(tables, statement, 'value');
      const expression = tables.propValue[value];
      appendRootTextProperty(tables, statement, 'future', 'not-an-expression-record');
      tables.propValue[value] = tables.propValue.pop();
      tables.propNode.pop();
      tables.propKey.pop();
      tables.propNode.push(nodeIds(tables, 'return')[0]);
      tables.propKey.push('value');
      tables.propValue.push(expression);
    },
  },
  {
    id: 'throw-unsupported-expression',
    base: 'throw-valued-error',
    category: 'profile rejection',
    mutate(tables) {
      replacePropertyExpressionKind(tables, nodeIds(tables, 'throw')[0], 'value', 'future');
    },
  },
  {
    id: 'throw-child',
    base: 'throw-nested-condition',
    category: 'profile rejection',
    mutate(tables) {
      const thrown = nodeIds(tables, 'throw')[0];
      const returned = nodeIds(tables, 'return')[0];
      tables.nodeParent[returned - 1] = thrown;
      tables.nodeOrder[returned - 1] = 0;
    },
  },
];
