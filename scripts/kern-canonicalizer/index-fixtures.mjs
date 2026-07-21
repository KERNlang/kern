function lines(...items) {
  return `${items.join('\n')}\n`;
}

function indexFieldsIds(tables) {
  return tables.valueRole.flatMap((role, index) => {
    if (role !== 'record:kind' || tables.valueText[index] !== 'index') return [];
    const expressionId = tables.valueParent[index];
    const fields = tables.valueRole.findIndex(
      (candidate, candidateIndex) =>
        candidate === 'record:fields' && tables.valueParent[candidateIndex] === expressionId,
    );
    return fields < 0 ? [] : [fields + 1];
  });
}

function nestedIndexFieldsId(tables) {
  return indexFieldsIds(tables).find((fieldsId) => {
    const expressionId = tables.valueParent[fieldsId - 1];
    return expressionId > 0 && tables.valueParent[expressionId - 1] > 0;
  });
}

function fieldIndex(tables, parent, role) {
  return tables.valueRole.findIndex(
    (candidate, index) => candidate === role && tables.valueParent[index] === parent,
  );
}

function appendTextValue(tables, text, parent, role, order) {
  tables.valueTag.push('text');
  tables.valueParent.push(parent);
  tables.valueRole.push(role);
  tables.valueOrder.push(order);
  tables.valueText.push(text);
  tables.valueBool.push(0);
}

function replaceExpressionKind(tables, fieldsId, field, kind) {
  const expressionId = fieldIndex(tables, fieldsId, `record:${field}`) + 1;
  const kindIndex = fieldIndex(tables, expressionId, 'record:kind');
  tables.valueText[kindIndex] = kind;
}

export const INDEX_VALID_FIXTURES = [
  {
    id: 'index-selected-shapes',
    source: lines(
      'fn name=indexValues returns=string',
      '  param name=values type="string[]"',
      '  param name=i type=number',
      '  handler lang=kern',
      '    return value="values[i]"',
      'fn name=indexModuleRoot returns=string',
      '  param name=moduleRoot type="string[]"',
      '  param name=i2 type=number',
      '  handler lang=kern',
      '    return value="moduleRoot[i2]"',
    ),
    golden: lines(
      'fn name=indexValues returns=string',
      '  param name=values type=string[]',
      '  param name=i type=number',
      '  handler lang="kern"',
      '    return value="values[i]"',
      'fn name=indexModuleRoot returns=string',
      '  param name=moduleRoot type=string[]',
      '  param name=i2 type=number',
      '  handler lang="kern"',
      '    return value="moduleRoot[i2]"',
    ),
  },
  {
    id: 'index-recursive-and-binary',
    source: lines(
      'fn name=indexMatrix returns=string',
      '  param name=matrix type="string[]"',
      '  param name=i type=number',
      '  param name=j type=number',
      '  handler lang=kern',
      '    return value="matrix[i][j]"',
      'fn name=indexOffset returns=string',
      '  param name=values type="string[]"',
      '  param name=i type=number',
      '  handler lang=kern',
      '    return value="values[i + 1]"',
    ),
    golden: lines(
      'fn name=indexMatrix returns=string',
      '  param name=matrix type=string[]',
      '  param name=i type=number',
      '  param name=j type=number',
      '  handler lang="kern"',
      '    return value="matrix[i][j]"',
      'fn name=indexOffset returns=string',
      '  param name=values type=string[]',
      '  param name=i type=number',
      '  handler lang="kern"',
      '    return value="values[(i + 1)]"',
    ),
  },
  {
    id: 'index-call-and-list-objects',
    source: lines(
      'fn name=indexCallObject returns=string',
      '  handler lang=kern',
      '    return value="make()[0]"',
      'fn name=indexListObject returns=string',
      '  param name=value type=string',
      '  handler lang=kern',
      '    return value="[value][0]"',
    ),
    golden: lines(
      'fn name=indexCallObject returns=string',
      '  handler lang="kern"',
      '    return value="make()[0]"',
      'fn name=indexListObject returns=string',
      '  param name=value type=string',
      '  handler lang="kern"',
      '    return value="[value][0]"',
    ),
  },
  {
    id: 'index-binary-and-text-objects',
    source: lines(
      'fn name=indexBinaryObject returns=string',
      '  param name=first type="string[]"',
      '  param name=second type="string[]"',
      '  param name=i type=number',
      '  handler lang=kern',
      '    return value="(first || second)[i]"',
      'fn name=indexTextObject returns=string',
      '  handler lang=kern',
      String.raw`    return value="\"text\"[0]"`,
    ),
    golden: lines(
      'fn name=indexBinaryObject returns=string',
      '  param name=first type=string[]',
      '  param name=second type=string[]',
      '  param name=i type=number',
      '  handler lang="kern"',
      '    return value="(first || second)[i]"',
      'fn name=indexTextObject returns=string',
      '  handler lang="kern"',
      String.raw`    return value="\"text\"[0]"`,
    ),
  },
  {
    id: 'index-member-and-call-consumers',
    source: lines(
      'fn name=indexMemberReceiver returns=number',
      '  param name=rows type="string[]"',
      '  param name=i type=number',
      '  handler lang=kern',
      '    return value="rows[i].length"',
      'fn name=indexCallCallee returns=string',
      '  param name=handlers type="string[]"',
      '  param name=i type=number',
      '  param name=x type=string',
      '  handler lang=kern',
      '    return value="handlers[i](x)"',
    ),
    golden: lines(
      'fn name=indexMemberReceiver returns=number',
      '  param name=rows type=string[]',
      '  param name=i type=number',
      '  handler lang="kern"',
      '    return value="rows[i].length"',
      'fn name=indexCallCallee returns=string',
      '  param name=handlers type=string[]',
      '  param name=i type=number',
      '  param name=x type=string',
      '  handler lang="kern"',
      '    return value="handlers[i](x)"',
    ),
  },
];

export const INDEX_HOSTILE_FIXTURES = [
  {
    id: 'index-missing-index-field',
    base: 'index-selected-shapes',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = indexFieldsIds(tables)[0];
      tables.valueRole[fieldIndex(tables, fieldsId, 'record:index')] = 'record:future';
    },
  },
  {
    id: 'index-duplicate-object-field',
    base: 'index-selected-shapes',
    category: 'direct profile rejection',
    mutate(tables) {
      const fieldsId = indexFieldsIds(tables)[0];
      tables.valueRole[fieldIndex(tables, fieldsId, 'record:index')] = 'record:object';
    },
  },
  {
    id: 'index-extra-field',
    base: 'index-selected-shapes',
    category: 'profile rejection',
    mutate(tables) {
      appendTextValue(tables, 'future', indexFieldsIds(tables)[0], 'record:zzz', 3);
    },
  },
  {
    id: 'index-dangling-object-id',
    base: 'index-selected-shapes',
    category: 'direct profile rejection',
    mutate(tables) {
      const fieldsId = indexFieldsIds(tables)[0];
      const object = fieldIndex(tables, fieldsId, 'record:object');
      tables.valueParent[object] = tables.valueTag.length + 1;
    },
  },
  {
    id: 'index-dangling-index-id',
    base: 'index-selected-shapes',
    category: 'direct profile rejection',
    mutate(tables) {
      const fieldsId = indexFieldsIds(tables)[0];
      const index = fieldIndex(tables, fieldsId, 'record:index');
      tables.valueParent[index] = tables.valueTag.length + 1;
    },
  },
  {
    id: 'index-non-boolean-optional',
    base: 'index-selected-shapes',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = indexFieldsIds(tables)[0];
      const optional = fieldIndex(tables, fieldsId, 'record:optional');
      tables.valueTag[optional] = 'text';
      tables.valueText[optional] = 'false';
    },
  },
  {
    id: 'index-optional-true',
    base: 'index-selected-shapes',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = indexFieldsIds(tables)[0];
      tables.valueBool[fieldIndex(tables, fieldsId, 'record:optional')] = 1;
    },
  },
  {
    id: 'index-unsupported-object',
    base: 'index-selected-shapes',
    category: 'profile rejection',
    mutate(tables) {
      replaceExpressionKind(tables, indexFieldsIds(tables)[0], 'object', 'unary');
    },
  },
  {
    id: 'index-unsupported-index',
    base: 'index-selected-shapes',
    category: 'profile rejection',
    mutate(tables) {
      replaceExpressionKind(tables, indexFieldsIds(tables)[0], 'index', 'unary');
    },
  },
  {
    id: 'index-nested-optional-true',
    base: 'index-recursive-and-binary',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = nestedIndexFieldsId(tables);
      tables.valueBool[fieldIndex(tables, fieldsId, 'record:optional')] = 1;
    },
  },
];
