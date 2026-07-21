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

function propertyValueIndex(tables, node, key) {
  const propIndex = propertyIndex(tables, node, key);
  if (propIndex < 0) throw new Error(`missing ${key} property on node ${node}`);
  const valueIndex = tables.propValue[propIndex] - 1;
  if (valueIndex < 0 || valueIndex >= tables.valueTag.length) {
    throw new Error(`invalid ${key} value on node ${node}`);
  }
  return valueIndex;
}

export const COUNTED_ITERATION_VALID_FIXTURES = [
  {
    id: 'counted-iteration-conditional-body',
    source: lines(
      'fn name=lastIndex returns=number',
      '  param name=limit type=number',
      '  handler lang=kern',
      '    for name=i from=0 to=limit',
      '      if cond="i == limit"',
      '        return value="i"',
      '    return value="limit"',
    ),
    golden: lines(
      'fn name=lastIndex returns=number',
      '  param name=limit type=number',
      '  handler lang="kern"',
      '    for name=i from="0" to="limit"',
      '      if cond="(i == limit)"',
      '        return value="i"',
      '    return value="limit"',
    ),
  },
  {
    id: 'counted-iteration-nested',
    source: lines(
      'fn name=nestedLimit returns=number',
      '  param name=outer type=number',
      '  param name=inner type=number',
      '  handler lang=kern',
      '    for name=i from=0 to=outer',
      '      for name=j from=i to=inner',
      '        return value="j"',
      '    return value="outer"',
    ),
    golden: lines(
      'fn name=nestedLimit returns=number',
      '  param name=outer type=number',
      '  param name=inner type=number',
      '  handler lang="kern"',
      '    for name=i from="0" to="outer"',
      '      for name=j from="i" to="inner"',
      '        return value="j"',
      '    return value="outer"',
    ),
  },
  {
    id: 'counted-iteration-promoted-bounds',
    source: lines(
      'fn name=boundedIndex returns=number',
      '  param name=offset type=number',
      '  param name=limits type="number[]"',
      '  param name=index type=number',
      '  handler lang=kern',
      '    for name=cursor from="offset + 1" to="limits[index]"',
      '      return value="cursor"',
      '    return value="limits.length"',
    ),
    golden: lines(
      'fn name=boundedIndex returns=number',
      '  param name=offset type=number',
      '  param name=limits type=number[]',
      '  param name=index type=number',
      '  handler lang="kern"',
      '    for name=cursor from="(offset + 1)" to="limits[index]"',
      '      return value="cursor"',
      '    return value="limits.length"',
    ),
  },
  {
    id: 'counted-iteration-empty-body',
    source: lines(
      'fn name=emptyLoop returns=number',
      '  handler lang=kern',
      '    for name=i from=0 to=1',
      '    return value="1"',
    ),
    golden: lines(
      'fn name=emptyLoop returns=number',
      '  handler lang="kern"',
      '    for name=i from="0" to="1"',
      '    return value="1"',
    ),
  },
];

export const COUNTED_ITERATION_HOSTILE_FIXTURES = [
  {
    id: 'counted-iteration-missing-from',
    base: 'counted-iteration-conditional-body',
    category: 'profile rejection',
    mutate(tables) {
      const loop = nodeIds(tables, 'for')[0];
      tables.propKey[propertyIndex(tables, loop, 'from')] = 'future';
    },
  },
  {
    id: 'counted-iteration-missing-name',
    base: 'counted-iteration-conditional-body',
    category: 'profile rejection',
    mutate(tables) {
      const loop = nodeIds(tables, 'for')[0];
      tables.propKey[propertyIndex(tables, loop, 'name')] = 'future';
    },
  },
  {
    id: 'counted-iteration-missing-to',
    base: 'counted-iteration-conditional-body',
    category: 'profile rejection',
    mutate(tables) {
      const loop = nodeIds(tables, 'for')[0];
      tables.propKey[propertyIndex(tables, loop, 'to')] = 'future';
    },
  },
  {
    id: 'counted-iteration-duplicate-from',
    base: 'counted-iteration-conditional-body',
    category: 'direct profile rejection',
    mutate(tables) {
      const loop = nodeIds(tables, 'for')[0];
      tables.propKey[propertyIndex(tables, loop, 'to')] = 'from';
    },
  },
  {
    id: 'counted-iteration-explicit-step',
    base: 'counted-iteration-conditional-body',
    category: 'profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'for')[0], 'step', '1');
    },
  },
  {
    id: 'counted-iteration-extra-property',
    base: 'counted-iteration-conditional-body',
    category: 'profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'for')[0], 'future', 'x');
    },
  },
  {
    id: 'counted-iteration-dollar-name',
    base: 'counted-iteration-conditional-body',
    category: 'profile rejection',
    mutate(tables) {
      const loop = nodeIds(tables, 'for')[0];
      tables.valueText[propertyValueIndex(tables, loop, 'name')] = '$i';
    },
  },
  {
    id: 'counted-iteration-invalid-name',
    base: 'counted-iteration-conditional-body',
    category: 'profile rejection',
    mutate(tables) {
      const loop = nodeIds(tables, 'for')[0];
      tables.valueText[propertyValueIndex(tables, loop, 'name')] = '1i';
    },
  },
  {
    id: 'counted-iteration-nontext-name',
    base: 'counted-iteration-conditional-body',
    category: 'profile rejection',
    mutate(tables) {
      const loop = nodeIds(tables, 'for')[0];
      const nameIndex = propertyValueIndex(tables, loop, 'name');
      tables.valueTag[nameIndex] = 'int';
      tables.valueText[nameIndex] = '1';
    },
  },
  {
    id: 'counted-iteration-unsupported-from',
    base: 'counted-iteration-conditional-body',
    category: 'profile rejection',
    mutate(tables) {
      replacePropertyExpressionKind(tables, nodeIds(tables, 'for')[0], 'from', 'unary');
    },
  },
  {
    id: 'counted-iteration-unsupported-to',
    base: 'counted-iteration-promoted-bounds',
    category: 'profile rejection',
    mutate(tables) {
      replacePropertyExpressionKind(tables, nodeIds(tables, 'for')[0], 'to', 'unary');
    },
  },
  {
    id: 'counted-iteration-unsupported-child',
    base: 'counted-iteration-conditional-body',
    category: 'profile rejection',
    mutate(tables) {
      tables.nodeKind[nodeIds(tables, 'if')[0] - 1] = 'let';
    },
  },
  {
    id: 'counted-iteration-invalid-nested-name',
    base: 'counted-iteration-nested',
    category: 'profile rejection',
    mutate(tables) {
      const nested = nodeIds(tables, 'for')[1];
      tables.valueText[propertyValueIndex(tables, nested, 'name')] = '$j';
    },
  },
];
