import { lines } from './fixture-helpers.mjs';

function nodeIds(tables, kind) {
  return tables.nodeKind.flatMap((value, index) => value === kind ? [index + 1] : []);
}

function propertyIndex(tables, node, key) {
  return tables.propNode.findIndex(
    (candidate, index) => candidate === node && tables.propKey[index] === key,
  );
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

export const DO_VALID_FIXTURES = [
  {
    id: 'do-direct-call',
    source: lines(
      'fn name=append returns=void',
      '  param name=items type="string[]"',
      '  param name=value type=string',
      '  handler lang=kern',
      '    do value="items.push(value)"',
      '    return',
    ),
    golden: lines(
      'fn name=append returns=void',
      '  param name=items type=string[]',
      '  param name=value type=string',
      '  handler lang="kern"',
      '    do value="items.push(value)"',
      '    return',
    ),
  },
  {
    id: 'do-call-argument-spacing',
    source: lines(
      'fn name=write returns=void',
      '  param name=state type=string',
      '  param name=key type=string',
      '  param name=value type=string',
      '  handler lang=kern',
      '    do value="Map.set(state,key,value)"',
      '    return',
    ),
    golden: lines(
      'fn name=write returns=void',
      '  param name=state type=string',
      '  param name=key type=string',
      '  param name=value type=string',
      '  handler lang="kern"',
      '    do value="Map.set(state, key, value)"',
      '    return',
    ),
  },
  {
    id: 'do-nested-control-flow',
    source: lines(
      'fn name=visitAll returns=void',
      '  param name=items type="string[]"',
      '  param name=limit type=number',
      '  handler lang=kern',
      '    for name=i from=0 to=limit',
      '      if cond="i < limit"',
      '        do value="visit(items[i])"',
      '    return',
    ),
    golden: lines(
      'fn name=visitAll returns=void',
      '  param name=items type=string[]',
      '  param name=limit type=number',
      '  handler lang="kern"',
      '    for name=i from="0" to="limit"',
      '      if cond="(i < limit)"',
      '        do value="visit(items[i])"',
      '    return',
    ),
  },
];

export const DO_HOSTILE_FIXTURES = [
  {
    id: 'do-missing-value',
    base: 'do-direct-call',
    category: 'profile rejection',
    mutate(tables) {
      const statement = nodeIds(tables, 'do')[0];
      tables.propKey[propertyIndex(tables, statement, 'value')] = 'future';
    },
  },
  {
    id: 'do-duplicate-value',
    base: 'do-direct-call',
    category: 'direct profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'do')[0], 'value', 'duplicate');
    },
  },
  ...['kind', 'trailingComment', 'future'].map((key) => ({
    id: `do-${key}`,
    base: 'do-direct-call',
    category: 'profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'do')[0], key, 'excluded');
    },
  })),
  {
    id: 'do-non-expression-value',
    base: 'do-direct-call',
    category: 'profile rejection',
    mutate(tables) {
      const statement = nodeIds(tables, 'do')[0];
      const value = propertyIndex(tables, statement, 'value');
      const expression = tables.propValue[value];
      const functionNode = nodeIds(tables, 'fn')[0];
      replacePropertyExpressionKind(tables, functionNode, 'returns', 'number');
      tables.valueTag.push('text');
      tables.valueParent.push(0);
      tables.valueRole.push('');
      tables.valueOrder.push(0);
      tables.valueText.push('not-an-expression-record');
      tables.valueBool.push(0);
      tables.propValue[value] = tables.valueTag.length;
      tables.propNode.push(nodeIds(tables, 'return')[0]);
      tables.propKey.push('value');
      tables.propValue.push(expression);
    },
  },
  {
    id: 'do-unsupported-expression',
    base: 'do-direct-call',
    category: 'profile rejection',
    mutate(tables) {
      replacePropertyExpressionKind(tables, nodeIds(tables, 'do')[0], 'value', 'future');
    },
  },
  {
    id: 'do-child',
    base: 'do-direct-call',
    category: 'profile rejection',
    mutate(tables) {
      const statement = nodeIds(tables, 'do')[0];
      const returned = nodeIds(tables, 'return')[0];
      tables.nodeParent[returned - 1] = statement;
      tables.nodeOrder[returned - 1] = 0;
    },
  },
];
