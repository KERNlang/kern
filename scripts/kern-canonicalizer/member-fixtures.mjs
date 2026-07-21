function lines(...items) {
  return `${items.join('\n')}\n`;
}

function memberFieldsIds(tables) {
  return tables.valueRole.flatMap((role, index) => {
    if (role !== 'record:kind' || tables.valueText[index] !== 'member') return [];
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

export const MEMBER_VALID_FIXTURES = [
  {
    id: 'member-direct-and-call',
    source: lines(
      'fn name=memberLength returns=number',
      '  param name=values type="string[]"',
      '  handler lang=kern',
      '    return value="values.length"',
      'fn name=memberCall returns=string',
      '  param name=raw type=string',
      '  handler lang=kern',
      '    return value="Text.charAt(raw,0)"',
    ),
    golden: lines(
      'fn name=memberLength returns=number',
      '  param name=values type=string[]',
      '  handler lang="kern"',
      '    return value="values.length"',
      'fn name=memberCall returns=string',
      '  param name=raw type=string',
      '  handler lang="kern"',
      '    return value="Text.charAt(raw, 0)"',
    ),
  },
  {
    id: 'member-recursive-chain',
    source: lines(
      'fn name=memberChain returns=string',
      '  param name=service type=string',
      '  handler lang=kern',
      '    return value="service.client.run"',
    ),
    golden: lines(
      'fn name=memberChain returns=string',
      '  param name=service type=string',
      '  handler lang="kern"',
      '    return value="service.client.run"',
    ),
  },
  {
    id: 'member-recursive-receivers',
    source: lines(
      'fn name=memberCallReceiver returns=string',
      '  handler lang=kern',
      '    return value="make().value"',
      'fn name=memberBinaryReceiver returns=number',
      '  param name=first type=string',
      '  param name=second type=string',
      '  handler lang=kern',
      '    return value="(first || second).length"',
      'fn name=memberListReceiver returns=number',
      '  param name=value type=string',
      '  handler lang=kern',
      '    return value="[value].length"',
    ),
    golden: lines(
      'fn name=memberCallReceiver returns=string',
      '  handler lang="kern"',
      '    return value="make().value"',
      'fn name=memberBinaryReceiver returns=number',
      '  param name=first type=string',
      '  param name=second type=string',
      '  handler lang="kern"',
      '    return value="(first || second).length"',
      'fn name=memberListReceiver returns=number',
      '  param name=value type=string',
      '  handler lang="kern"',
      '    return value="[value].length"',
    ),
  },
  {
    id: 'member-integer-receiver',
    source: lines(
      'fn name=memberIntegerReceiver returns=string',
      '  handler lang=kern',
      '    return value="1.value"',
    ),
    golden: lines(
      'fn name=memberIntegerReceiver returns=string',
      '  handler lang="kern"',
      '    return value="1.value"',
    ),
  },
  {
    id: 'member-token-shaped-property',
    source: lines(
      'fn name=memberTokenProperty returns=string',
      '  param name=object type=string',
      '  handler lang=kern',
      '    return value="object.new"',
      'fn name=memberTypeofProperty returns=string',
      '  param name=object type=string',
      '  handler lang=kern',
      '    return value="object.typeof"',
      'fn name=memberStructuralKeywordProperty returns=string',
      '  param name=object type=string',
      '  handler lang=kern',
      '    return value="object.return"',
    ),
    golden: lines(
      'fn name=memberTokenProperty returns=string',
      '  param name=object type=string',
      '  handler lang="kern"',
      '    return value="object.new"',
      'fn name=memberTypeofProperty returns=string',
      '  param name=object type=string',
      '  handler lang="kern"',
      '    return value="object.typeof"',
      'fn name=memberStructuralKeywordProperty returns=string',
      '  param name=object type=string',
      '  handler lang="kern"',
      '    return value="object.return"',
    ),
  },
  {
    id: 'member-literal-receivers',
    source: lines(
      'fn name=memberNullReceiver returns=string',
      '  handler lang=kern',
      '    return value="null.value"',
      'fn name=memberBooleanReceiver returns=string',
      '  handler lang=kern',
      '    return value="true.value"',
      'fn name=memberTextReceiver returns=number',
      '  handler lang=kern',
      String.raw`    return value="\"text\".length"`,
    ),
    golden: lines(
      'fn name=memberNullReceiver returns=string',
      '  handler lang="kern"',
      '    return value="null.value"',
      'fn name=memberBooleanReceiver returns=string',
      '  handler lang="kern"',
      '    return value="true.value"',
      'fn name=memberTextReceiver returns=number',
      '  handler lang="kern"',
      String.raw`    return value="\"text\".length"`,
    ),
  },
];

export const MEMBER_HOSTILE_FIXTURES = [
  {
    id: 'member-missing-object-field',
    base: 'member-direct-and-call',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = memberFieldsIds(tables)[0];
      tables.valueRole[fieldIndex(tables, fieldsId, 'record:object')] = 'record:future';
    },
  },
  {
    id: 'member-duplicate-optional-field',
    base: 'member-direct-and-call',
    category: 'direct profile rejection',
    mutate(tables) {
      const fieldsId = memberFieldsIds(tables)[0];
      tables.valueRole[fieldIndex(tables, fieldsId, 'record:property')] = 'record:optional';
    },
  },
  {
    id: 'member-extra-field',
    base: 'member-direct-and-call',
    category: 'profile rejection',
    mutate(tables) {
      appendTextValue(tables, 'future', memberFieldsIds(tables)[0], 'record:zzz', 3);
    },
  },
  {
    id: 'member-dangling-object-id',
    base: 'member-direct-and-call',
    category: 'direct profile rejection',
    mutate(tables) {
      const fieldsId = memberFieldsIds(tables)[0];
      const object = fieldIndex(tables, fieldsId, 'record:object');
      tables.valueParent[object] = tables.valueTag.length + 1;
    },
  },
  {
    id: 'member-non-boolean-optional',
    base: 'member-direct-and-call',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = memberFieldsIds(tables)[0];
      const optional = fieldIndex(tables, fieldsId, 'record:optional');
      tables.valueTag[optional] = 'text';
      tables.valueText[optional] = 'false';
    },
  },
  {
    id: 'member-optional-true',
    base: 'member-direct-and-call',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = memberFieldsIds(tables)[0];
      tables.valueBool[fieldIndex(tables, fieldsId, 'record:optional')] = 1;
    },
  },
  {
    id: 'member-non-text-property',
    base: 'member-direct-and-call',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = memberFieldsIds(tables)[0];
      const property = fieldIndex(tables, fieldsId, 'record:property');
      tables.valueTag[property] = 'int';
      tables.valueText[property] = '1';
    },
  },
  ...['bad-name', 'null', 'none', 'undefined', 'true', 'false', 'await'].map((property) => ({
    id: `member-unsafe-property-${property}`,
    base: 'member-direct-and-call',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = memberFieldsIds(tables)[0];
      tables.valueText[fieldIndex(tables, fieldsId, 'record:property')] = property;
    },
  })),
  {
    id: 'member-malformed-index-object',
    base: 'member-direct-and-call',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = memberFieldsIds(tables)[0];
      const objectId = fieldIndex(tables, fieldsId, 'record:object') + 1;
      tables.valueText[fieldIndex(tables, objectId, 'record:kind')] = 'index';
    },
  },
  {
    id: 'member-nested-optional-true',
    base: 'member-recursive-chain',
    category: 'profile rejection',
    mutate(tables) {
      const nestedFieldsId = memberFieldsIds(tables)[0];
      tables.valueBool[fieldIndex(tables, nestedFieldsId, 'record:optional')] = 1;
    },
  },
];
