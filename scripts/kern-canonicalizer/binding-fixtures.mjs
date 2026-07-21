import { lines } from './fixture-helpers.mjs';

function nodeIds(tables, kind) {
  return tables.nodeKind.flatMap((value, index) => value === kind ? [index + 1] : []);
}

function propertyIndex(tables, node, key) {
  return tables.propNode.findIndex(
    (candidate, index) => candidate === node && tables.propKey[index] === key,
  );
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

export const BINDING_VALID_FIXTURES = [
  {
    id: 'binding-direct',
    source: lines(
      'fn name=accumulate returns=number',
      '  param name=input type=number',
      '  handler lang=kern',
      '    let name=total value=0',
      '    assign target=total value="total + input"',
      '    return value=total',
    ),
    golden: lines(
      'fn name=accumulate returns=number',
      '  param name=input type=number',
      '  handler lang="kern"',
      '    let name=total value="0"',
      '    assign target="total" value="(total + input)"',
      '    return value="total"',
    ),
  },
  {
    id: 'binding-member-index-targets',
    source: lines(
      'fn name=writeTargets returns=string',
      '  param name=state type=string',
      '  param name=values type="string[]"',
      '  param name=i type=number',
      '  handler lang=kern',
      '    assign target="state.value" value="values[i]"',
      '    assign target="values[i]" value="state.value"',
      '    return value="values[i]"',
    ),
    golden: lines(
      'fn name=writeTargets returns=string',
      '  param name=state type=string',
      '  param name=values type=string[]',
      '  param name=i type=number',
      '  handler lang="kern"',
      '    assign target="state.value" value="values[i]"',
      '    assign target="values[i]" value="state.value"',
      '    return value="values[i]"',
    ),
  },
  {
    id: 'binding-structural-name',
    source: lines(
      'fn name=structuralBinding returns=string',
      '  param name=input type=string',
      '  handler lang=kern',
      '    let name="$local" value=input',
      '    assign target="$local" value="decorate($local)"',
      '    return value="$local"',
    ),
    golden: lines(
      'fn name=structuralBinding returns=string',
      '  param name=input type=string',
      '  handler lang="kern"',
      '    let name="$local" value="input"',
      '    assign target="$local" value="decorate($local)"',
      '    return value="$local"',
    ),
  },
  {
    id: 'binding-nested',
    source: lines(
      'fn name=nestedBinding returns=number',
      '  param name=limit type=number',
      '  handler lang=kern',
      '    let name=total value=0',
      '    for name=i from=0 to=limit',
      '      let name=next value="total + i"',
      '      if cond="next > total"',
      '        assign target=total value=next',
      '    return value=total',
    ),
    golden: lines(
      'fn name=nestedBinding returns=number',
      '  param name=limit type=number',
      '  handler lang="kern"',
      '    let name=total value="0"',
      '    for name=i from="0" to="limit"',
      '      let name=next value="(total + i)"',
      '      if cond="(next > total)"',
      '        assign target="total" value="next"',
      '    return value="total"',
    ),
  },
];

export const BINDING_HOSTILE_FIXTURES = [
  {
    id: 'binding-let-missing-name',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      const binding = nodeIds(tables, 'let')[0];
      tables.propKey[propertyIndex(tables, binding, 'name')] = 'future';
    },
  },
  {
    id: 'binding-let-missing-value',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      const binding = nodeIds(tables, 'let')[0];
      tables.propKey[propertyIndex(tables, binding, 'value')] = 'future';
    },
  },
  {
    id: 'binding-let-duplicate-name',
    base: 'binding-direct',
    category: 'direct profile rejection',
    mutate(tables) {
      const binding = nodeIds(tables, 'let')[0];
      tables.propKey[propertyIndex(tables, binding, 'value')] = 'name';
    },
  },
  {
    id: 'binding-let-duplicate-value',
    base: 'binding-direct',
    category: 'direct profile rejection',
    mutate(tables) {
      const binding = nodeIds(tables, 'let')[0];
      tables.propKey[propertyIndex(tables, binding, 'name')] = 'value';
    },
  },
  {
    id: 'binding-let-invalid-name',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      const binding = nodeIds(tables, 'let')[0];
      tables.valueText[propertyValueIndex(tables, binding, 'name')] = '1total';
    },
  },
  {
    id: 'binding-let-nontext-name',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      const binding = nodeIds(tables, 'let')[0];
      const name = propertyValueIndex(tables, binding, 'name');
      tables.valueTag[name] = 'int';
      tables.valueText[name] = '1';
    },
  },
  {
    id: 'binding-let-kind',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'let')[0], 'kind', 'let');
    },
  },
  ...['type', 'expr', 'trailingComment'].map((key) => ({
    id: `binding-let-${key}`,
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'let')[0], key, 'excluded');
    },
  })),
  {
    id: 'binding-let-future-property',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'let')[0], 'future', 'x');
    },
  },
  {
    id: 'binding-let-unsupported-value',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      replacePropertyExpressionKind(tables, nodeIds(tables, 'let')[0], 'value', 'unary');
    },
  },
  {
    id: 'binding-let-child',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      const returned = nodeIds(tables, 'return')[0];
      tables.nodeParent[returned - 1] = nodeIds(tables, 'let')[0];
      tables.nodeOrder[returned - 1] = 0;
    },
  },
  {
    id: 'binding-assign-missing-target',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      const assignment = nodeIds(tables, 'assign')[0];
      tables.propKey[propertyIndex(tables, assignment, 'target')] = 'future';
    },
  },
  {
    id: 'binding-assign-missing-value',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      const assignment = nodeIds(tables, 'assign')[0];
      tables.propKey[propertyIndex(tables, assignment, 'value')] = 'future';
    },
  },
  {
    id: 'binding-assign-duplicate-target',
    base: 'binding-direct',
    category: 'direct profile rejection',
    mutate(tables) {
      const assignment = nodeIds(tables, 'assign')[0];
      tables.propKey[propertyIndex(tables, assignment, 'value')] = 'target';
    },
  },
  {
    id: 'binding-assign-duplicate-value',
    base: 'binding-direct',
    category: 'direct profile rejection',
    mutate(tables) {
      const assignment = nodeIds(tables, 'assign')[0];
      tables.propKey[propertyIndex(tables, assignment, 'target')] = 'value';
    },
  },
  {
    id: 'binding-assign-op',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'assign')[0], 'op', '=');
    },
  },
  {
    id: 'binding-assign-trailing-comment',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'assign')[0], 'trailingComment', 'excluded');
    },
  },
  {
    id: 'binding-assign-nonassignable-target',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      const assignment = nodeIds(tables, 'assign')[0];
      const target = propertyIndex(tables, assignment, 'target');
      const value = propertyIndex(tables, assignment, 'value');
      const targetId = tables.propValue[target];
      tables.propValue[target] = tables.propValue[value];
      tables.propValue[value] = targetId;
    },
  },
  {
    id: 'binding-assign-unsupported-target',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      replacePropertyExpressionKind(tables, nodeIds(tables, 'assign')[0], 'target', 'unary');
    },
  },
  {
    id: 'binding-assign-unsupported-value',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      replacePropertyExpressionKind(tables, nodeIds(tables, 'assign')[0], 'value', 'unary');
    },
  },
  {
    id: 'binding-assign-child',
    base: 'binding-direct',
    category: 'profile rejection',
    mutate(tables) {
      const returned = nodeIds(tables, 'return')[0];
      tables.nodeParent[returned - 1] = nodeIds(tables, 'assign')[0];
      tables.nodeOrder[returned - 1] = 0;
    },
  },
];
