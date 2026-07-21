function lines(...items) {
  return `${items.join('\n')}\n`;
}

function unaryFieldsIds(tables) {
  return tables.valueRole.flatMap((role, index) => {
    if (role !== 'record:kind' || tables.valueText[index] !== 'unary') return [];
    const expressionId = tables.valueParent[index];
    const fields = tables.valueRole.findIndex(
      (candidate, candidateIndex) =>
        candidate === 'record:fields' && tables.valueParent[candidateIndex] === expressionId,
    );
    return fields < 0 ? [] : [fields + 1];
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

function argumentExpressionId(tables, fieldsId) {
  return fieldIndex(tables, fieldsId, 'record:argument') + 1;
}

function expressionKindIndex(tables, expressionId) {
  return fieldIndex(tables, expressionId, 'record:kind');
}

export const UNARY_VALID_FIXTURES = [
  {
    id: 'unary-source-operators',
    source: lines(
      'fn name=negative returns=number',
      '  param name=value type=number',
      '  handler lang=kern',
      '    return value="-value"',
      'fn name=inverted returns=boolean',
      '  param name=flag type=boolean',
      '  handler lang=kern',
      '    return value="!flag"',
      'fn name=bitwise returns=number',
      '  param name=value type=number',
      '  handler lang=kern',
      '    return value="~value"',
      'fn name=typeName returns=string',
      '  param name=value type=number',
      '  handler lang=kern',
      '    return value="typeof value"',
    ),
    golden: lines(
      'fn name=negative returns=number',
      '  param name=value type=number',
      '  handler lang="kern"',
      '    return value="(-value)"',
      'fn name=inverted returns=boolean',
      '  param name=flag type=boolean',
      '  handler lang="kern"',
      '    return value="(!flag)"',
      'fn name=bitwise returns=number',
      '  param name=value type=number',
      '  handler lang="kern"',
      '    return value="(~value)"',
      'fn name=typeName returns=string',
      '  param name=value type=number',
      '  handler lang="kern"',
      '    return value="(typeof value)"',
    ),
  },
  {
    id: 'unary-recursive-contexts',
    source: lines(
      'fn name=nested returns=boolean',
      '  param name=flag type=boolean',
      '  handler lang=kern',
      '    return value="!!flag"',
      'fn name=inBinary returns=number',
      '  param name=value type=number',
      '  handler lang=kern',
      '    return value="-value + 1"',
      'fn name=inList returns="number[]"',
      '  param name=value type=number',
      '  handler lang=kern',
      '    return value="[-value, ~value]"',
    ),
    golden: lines(
      'fn name=nested returns=boolean',
      '  param name=flag type=boolean',
      '  handler lang="kern"',
      '    return value="(!(!flag))"',
      'fn name=inBinary returns=number',
      '  param name=value type=number',
      '  handler lang="kern"',
      '    return value="((-value) + 1)"',
      'fn name=inList returns=number[]',
      '  param name=value type=number',
      '  handler lang="kern"',
      '    return value="[(-value), (~value)]"',
    ),
  },
  {
    id: 'unary-negative-literal',
    source: lines(
      'fn name=negativeOne returns=number',
      '  handler lang=kern',
      '    return value="-1"',
    ),
    golden: lines(
      'fn name=negativeOne returns=number',
      '  handler lang="kern"',
      '    return value="(-1)"',
    ),
  },
  {
    id: 'unary-recursive-arguments-structured',
    source: lines(
      'fn name=unaryBinaryArgument returns=boolean',
      '  param name=left type=boolean',
      '  param name=right type=boolean',
      '  handler lang=kern',
      '    return value="!(left && right)"',
      'fn name=unaryMemberArgument returns=boolean',
      '  param name=values type="string[]"',
      '  handler lang=kern',
      '    return value="!values.length"',
      'fn name=unaryIndexArgument returns=boolean',
      '  param name=values type="boolean[]"',
      '  handler lang=kern',
      '    return value="!values[0]"',
    ),
    golden: lines(
      'fn name=unaryBinaryArgument returns=boolean',
      '  param name=left type=boolean',
      '  param name=right type=boolean',
      '  handler lang="kern"',
      '    return value="(!(left && right))"',
      'fn name=unaryMemberArgument returns=boolean',
      '  param name=values type=string[]',
      '  handler lang="kern"',
      '    return value="(!values.length)"',
      'fn name=unaryIndexArgument returns=boolean',
      '  param name=values type=boolean[]',
      '  handler lang="kern"',
      '    return value="(!values[0])"',
    ),
  },
  {
    id: 'unary-recursive-arguments-containers',
    source: lines(
      'fn name=unaryCallArgument returns=boolean',
      '  handler lang=kern',
      '    return value="!check()"',
      'fn name=unaryListArgument returns=boolean',
      '  handler lang=kern',
      '    return value="![true]"',
      'fn name=unaryTextArgument returns=boolean',
      '  handler lang=kern',
      String.raw`    return value="!\"text\""`,
    ),
    golden: lines(
      'fn name=unaryCallArgument returns=boolean',
      '  handler lang="kern"',
      '    return value="(!check())"',
      'fn name=unaryListArgument returns=boolean',
      '  handler lang="kern"',
      '    return value="(![true])"',
      'fn name=unaryTextArgument returns=boolean',
      '  handler lang="kern"',
      String.raw`    return value="(!\"text\")"`,
    ),
  },
  {
    id: 'unary-recursive-arguments-scalars',
    source: lines(
      'fn name=unaryBooleanArgument returns=boolean',
      '  handler lang=kern',
      '    return value="!true"',
      'fn name=unaryIntegerArgument returns=number',
      '  handler lang=kern',
      '    return value="~1"',
    ),
    golden: lines(
      'fn name=unaryBooleanArgument returns=boolean',
      '  handler lang="kern"',
      '    return value="(!true)"',
      'fn name=unaryIntegerArgument returns=number',
      '  handler lang="kern"',
      '    return value="(~1)"',
    ),
  },
  {
    id: 'unary-recursive-consumers-power-member',
    source: lines(
      'fn name=unaryPowerOperand returns=number',
      '  param name=value type=number',
      '  handler lang=kern',
      '    return value="(-value) ** 2"',
      'fn name=unaryMemberReceiver returns=string',
      '  param name=value type=number',
      '  handler lang=kern',
      '    return value="(-value).next"',
    ),
    golden: lines(
      'fn name=unaryPowerOperand returns=number',
      '  param name=value type=number',
      '  handler lang="kern"',
      '    return value="((-value) ** 2)"',
      'fn name=unaryMemberReceiver returns=string',
      '  param name=value type=number',
      '  handler lang="kern"',
      '    return value="(-value).next"',
    ),
  },
  {
    id: 'unary-recursive-consumers-index-call',
    source: lines(
      'fn name=unaryIndexReceiver returns=number',
      '  param name=value type=number',
      '  handler lang=kern',
      '    return value="(-value)[0]"',
      'fn name=unaryCallReceiver returns=number',
      '  param name=callable type=number',
      '  handler lang=kern',
      '    return value="(-callable)()"',
    ),
    golden: lines(
      'fn name=unaryIndexReceiver returns=number',
      '  param name=value type=number',
      '  handler lang="kern"',
      '    return value="(-value)[0]"',
      'fn name=unaryCallReceiver returns=number',
      '  param name=callable type=number',
      '  handler lang="kern"',
      '    return value="(-callable)()"',
    ),
  },
];

export const UNARY_HOSTILE_FIXTURES = [
  {
    id: 'unary-missing-argument',
    base: 'unary-source-operators',
    category: 'profile rejection',
    mutate(tables) {
      const fields = unaryFieldsIds(tables)[0];
      tables.valueRole[fieldIndex(tables, fields, 'record:argument')] = 'record:future';
    },
  },
  {
    id: 'unary-duplicate-op',
    base: 'unary-source-operators',
    category: 'direct profile rejection',
    mutate(tables) {
      const fields = unaryFieldsIds(tables)[0];
      tables.valueRole[fieldIndex(tables, fields, 'record:argument')] = 'record:op';
    },
  },
  {
    id: 'unary-extra-field',
    base: 'unary-source-operators',
    category: 'profile rejection',
    mutate(tables) {
      const fields = unaryFieldsIds(tables)[0];
      appendTextValue(tables, 'extra', fields, 'record:zzz', 2);
    },
  },
  {
    id: 'unary-non-text-op',
    base: 'unary-source-operators',
    category: 'profile rejection',
    mutate(tables) {
      const fields = unaryFieldsIds(tables)[0];
      const op = fieldIndex(tables, fields, 'record:op');
      tables.valueTag[op] = 'bool';
      tables.valueText[op] = '';
      tables.valueBool[op] = 1;
    },
  },
  ...['+', 'void', '++', 'delete', '', 'typeof '].map((operator, index) => ({
    id: `unary-rejected-op-${index}`,
    base: 'unary-source-operators',
    category: 'profile rejection',
    mutate(tables) {
      const fields = unaryFieldsIds(tables)[0];
      tables.valueText[fieldIndex(tables, fields, 'record:op')] = operator;
    },
  })),
  {
    id: 'unary-dangling-argument',
    base: 'unary-source-operators',
    category: 'direct profile rejection',
    mutate(tables) {
      const fields = unaryFieldsIds(tables)[0];
      const argument = fieldIndex(tables, fields, 'record:argument');
      tables.valueParent[argument] = 0;
      tables.valueRole[argument] = '';
    },
  },
  {
    id: 'unary-unsupported-argument-kind',
    base: 'unary-source-operators',
    category: 'profile rejection',
    mutate(tables) {
      const fields = unaryFieldsIds(tables)[0];
      tables.valueText[expressionKindIndex(tables, argumentExpressionId(tables, fields))] = 'decimal';
    },
  },
  {
    id: 'unary-invalid-nested-operator',
    base: 'unary-recursive-contexts',
    category: 'profile rejection',
    mutate(tables) {
      const nestedFields = unaryFieldsIds(tables)[1];
      tables.valueText[fieldIndex(tables, nestedFields, 'record:op')] = 'void';
    },
  },
  {
    id: 'unary-non-record-argument',
    base: 'unary-source-operators',
    category: 'direct profile rejection',
    mutate(tables) {
      const fields = unaryFieldsIds(tables)[0];
      const argument = argumentExpressionId(tables, fields) - 1;
      tables.valueTag[argument] = 'text';
      tables.valueText[argument] = 'not-an-expression';
    },
  },
  {
    id: 'unary-negative-zero',
    base: 'unary-negative-literal',
    category: 'profile rejection',
    mutate(tables) {
      const integer = tables.valueRole.findIndex(
        (role, index) => role === 'record:value' && tables.valueTag[index] === 'int',
      );
      tables.valueText[integer] = '0';
    },
  },
  {
    id: 'unary-negative-integer-argument',
    base: 'unary-negative-literal',
    mutate(tables) {
      const integer = tables.valueRole.findIndex(
        (role, index) => role === 'record:value' && tables.valueTag[index] === 'int',
      );
      tables.valueText[integer] = '-1';
    },
  },
];
