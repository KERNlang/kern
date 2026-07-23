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

export const WHILE_VALID_FIXTURES = [
  {
    id: 'while-assignment-body',
    source: lines(
      'fn name=countTo returns=number',
      '  param name=limit type=number',
      '  handler lang=kern',
      '    let name=current value=0',
      '    while cond="current < limit"',
      '      assign target=current value="current + 1"',
      '    return value=current',
    ),
    golden: lines(
      'fn name=countTo returns=number',
      '  param name=limit type=number',
      '  handler lang="kern"',
      '    let name=current value="0"',
      '    while cond="(current < limit)"',
      '      assign target="current" value="(current + 1)"',
      '    return value="current"',
    ),
  },
  {
    id: 'while-nested',
    source: lines(
      'fn name=nestedCount returns=number',
      '  param name=outer type=number',
      '  param name=inner type=number',
      '  handler lang=kern',
      '    let name=i value=0',
      '    while cond="i < outer"',
      '      let name=j value=0',
      '      while cond="j < inner"',
      '        assign target=j value="j + 1"',
      '      assign target=i value="i + 1"',
      '    return value=i',
    ),
    golden: lines(
      'fn name=nestedCount returns=number',
      '  param name=outer type=number',
      '  param name=inner type=number',
      '  handler lang="kern"',
      '    let name=i value="0"',
      '    while cond="(i < outer)"',
      '      let name=j value="0"',
      '      while cond="(j < inner)"',
      '        assign target="j" value="(j + 1)"',
      '      assign target="i" value="(i + 1)"',
      '    return value="i"',
    ),
  },
  {
    id: 'while-conditional-body',
    source: lines(
      'fn name=findZero returns=number',
      '  param name=items type="number[]"',
      '  param name=index type=number',
      '  handler lang=kern',
      '    while cond="index < items.length"',
      '      if cond="items[index] == 0"',
      '        return value=index',
      '      assign target=index value="index + 1"',
      '    return value=index',
    ),
    golden: lines(
      'fn name=findZero returns=number',
      '  param name=items type=number[]',
      '  param name=index type=number',
      '  handler lang="kern"',
      '    while cond="(index < items.length)"',
      '      if cond="(items[index] == 0)"',
      '        return value="index"',
      '      assign target="index" value="(index + 1)"',
      '    return value="index"',
    ),
  },
  {
    id: 'while-empty-body',
    source: lines(
      'fn name=emptyWhile returns=void',
      '  param name=active type=boolean',
      '  handler lang=kern',
      '    while cond=active',
      '    return',
    ),
    golden: lines(
      'fn name=emptyWhile returns=void',
      '  param name=active type=boolean',
      '  handler lang="kern"',
      '    while cond="active"',
      '    return',
    ),
  },
];

export const WHILE_HOSTILE_FIXTURES = [
  {
    id: 'while-missing-cond',
    base: 'while-assignment-body',
    category: 'profile rejection',
    mutate(tables) {
      const loop = nodeIds(tables, 'while')[0];
      tables.propKey[propertyIndex(tables, loop, 'cond')] = 'future';
    },
  },
  {
    id: 'while-duplicate-cond',
    base: 'while-assignment-body',
    category: 'direct profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'while')[0], 'cond', 'true');
    },
  },
  ...['kind', 'trailingComment', 'future'].map((key) => ({
    id: `while-${key}`,
    base: 'while-assignment-body',
    category: 'profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'while')[0], key, 'excluded');
    },
  })),
  {
    id: 'while-non-expression-cond',
    base: 'while-empty-body',
    category: 'profile rejection',
    mutate(tables) {
      const loop = nodeIds(tables, 'while')[0];
      const cond = propertyIndex(tables, loop, 'cond');
      const expression = tables.propValue[cond];
      const functionNode = nodeIds(tables, 'fn')[0];
      replacePropertyExpressionKind(tables, functionNode, 'returns', 'number');
      appendRootTextProperty(tables, loop, 'future', 'not-an-expression-record');
      tables.propValue[cond] = tables.propValue.pop();
      tables.propNode.pop();
      tables.propKey.pop();
      const returned = nodeIds(tables, 'return')[0];
      tables.propNode.push(returned);
      tables.propKey.push('value');
      tables.propValue.push(expression);
    },
  },
  {
    id: 'while-unsupported-cond',
    base: 'while-assignment-body',
    category: 'profile rejection',
    mutate(tables) {
      replacePropertyExpressionKind(tables, nodeIds(tables, 'while')[0], 'cond', 'future');
    },
  },
  {
    id: 'while-unsupported-child',
    base: 'while-assignment-body',
    category: 'profile rejection',
    mutate(tables) {
      tables.nodeKind[nodeIds(tables, 'assign')[0] - 1] = 'param';
    },
  },
  {
    id: 'while-invalid-nested-cond',
    base: 'while-nested',
    category: 'profile rejection',
    mutate(tables) {
      replacePropertyExpressionKind(tables, nodeIds(tables, 'while')[1], 'cond', 'future');
    },
  },
];
