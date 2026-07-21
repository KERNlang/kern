function lines(...items) {
  return `${items.join('\n')}\n`;
}

function callFieldsIds(tables) {
  return tables.valueRole.flatMap((role, index) => {
    if (role !== 'record:kind' || tables.valueText[index] !== 'call') return [];
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

function argsListWithCount(tables, expectedCount) {
  for (const fieldsId of callFieldsIds(tables)) {
    const args = fieldIndex(tables, fieldsId, 'record:args');
    if (args < 0) continue;
    const argsId = args + 1;
    const count = tables.valueParent.filter((parent) => parent === argsId).length;
    if (count === expectedCount) return argsId;
  }
  return 0;
}

function appendTextValue(tables, text, parent, role, order) {
  tables.valueTag.push('text');
  tables.valueParent.push(parent);
  tables.valueRole.push(role);
  tables.valueOrder.push(order);
  tables.valueText.push(text);
  tables.valueBool.push(0);
}

export const CALL_VALID_FIXTURES = [
  {
    id: 'call-direct-and-nested',
    source: lines(
      'fn name=callDirect returns=string',
      '  param name=value type=string',
      '  handler lang=kern',
      '    return value="String(value)"',
      'fn name=callNested returns=string',
      '  param name=value type=string',
      '  handler lang=kern',
      '    return value="f(g(value),h())"',
    ),
    golden: lines(
      'fn name=callDirect returns=string',
      '  param name=value type=string',
      '  handler lang="kern"',
      '    return value="String(value)"',
      'fn name=callNested returns=string',
      '  param name=value type=string',
      '  handler lang="kern"',
      '    return value="f(g(value), h())"',
    ),
  },
  {
    id: 'call-recursive-callee',
    source: lines(
      'fn name=callAgain returns=string',
      '  handler lang=kern',
      '    return value="f()()"',
    ),
    golden: lines(
      'fn name=callAgain returns=string',
      '  handler lang="kern"',
      '    return value="f()()"',
    ),
  },
  {
    id: 'call-binary-callee',
    source: lines(
      'fn name=callChoice returns=string',
      '  param name=first type=string',
      '  param name=second type=string',
      '  param name=value type=string',
      '  handler lang=kern',
      '    return value="(first || second)(value)"',
    ),
    golden: lines(
      'fn name=callChoice returns=string',
      '  param name=first type=string',
      '  param name=second type=string',
      '  param name=value type=string',
      '  handler lang="kern"',
      '    return value="(first || second)(value)"',
    ),
  },
];

export const CALL_HOSTILE_FIXTURES = [
  {
    id: 'call-missing-callee-field',
    base: 'call-direct-and-nested',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = callFieldsIds(tables)[0];
      tables.valueRole[fieldIndex(tables, fieldsId, 'record:callee')] = 'record:future';
    },
  },
  {
    id: 'call-duplicate-args-field',
    base: 'call-direct-and-nested',
    category: 'direct profile rejection',
    mutate(tables) {
      const fieldsId = callFieldsIds(tables)[0];
      tables.valueRole[fieldIndex(tables, fieldsId, 'record:callee')] = 'record:args';
    },
  },
  {
    id: 'call-extra-field',
    base: 'call-direct-and-nested',
    category: 'profile rejection',
    mutate(tables) {
      appendTextValue(tables, 'future', callFieldsIds(tables)[0], 'record:zzz', 3);
    },
  },
  {
    id: 'call-non-list-args',
    base: 'call-direct-and-nested',
    category: 'direct profile rejection',
    mutate(tables) {
      const fieldsId = callFieldsIds(tables)[0];
      const args = fieldIndex(tables, fieldsId, 'record:args');
      tables.valueTag[args] = 'text';
      tables.valueText[args] = 'not-args';
    },
  },
  {
    id: 'call-dangling-callee-id',
    base: 'call-direct-and-nested',
    category: 'direct profile rejection',
    mutate(tables) {
      const fieldsId = callFieldsIds(tables)[0];
      const callee = fieldIndex(tables, fieldsId, 'record:callee');
      tables.valueParent[callee] = tables.valueTag.length + 1;
    },
  },
  {
    id: 'call-dangling-argument-id',
    base: 'call-direct-and-nested',
    category: 'direct profile rejection',
    mutate(tables) {
      const argsId = argsListWithCount(tables, 1);
      const argument = tables.valueParent.findIndex((parent) => parent === argsId);
      tables.valueParent[argument] = tables.valueTag.length + 1;
    },
  },
  {
    id: 'call-non-boolean-optional',
    base: 'call-direct-and-nested',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = callFieldsIds(tables)[0];
      const optional = fieldIndex(tables, fieldsId, 'record:optional');
      tables.valueTag[optional] = 'text';
      tables.valueText[optional] = 'false';
    },
  },
  {
    id: 'call-optional-true',
    base: 'call-direct-and-nested',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = callFieldsIds(tables)[0];
      tables.valueBool[fieldIndex(tables, fieldsId, 'record:optional')] = 1;
    },
  },
  {
    id: 'call-sparse-arg-order',
    base: 'call-direct-and-nested',
    category: 'direct profile rejection',
    mutate(tables) {
      const argsId = argsListWithCount(tables, 1);
      const argument = tables.valueParent.findIndex((parent) => parent === argsId);
      tables.valueOrder[argument] = 1;
    },
  },
  {
    id: 'call-duplicate-arg-order',
    base: 'call-direct-and-nested',
    category: 'direct profile rejection',
    mutate(tables) {
      const argsId = argsListWithCount(tables, 2);
      const argumentsForCall = tables.valueParent.flatMap((parent, index) =>
        parent === argsId ? [index] : []);
      tables.valueOrder[argumentsForCall[1]] = tables.valueOrder[argumentsForCall[0]];
    },
  },
  ...['member', 'index'].map((kind) => ({
    id: `call-${kind}-callee-malformed`,
    base: 'call-direct-and-nested',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = callFieldsIds(tables)[0];
      const callee = fieldIndex(tables, fieldsId, 'record:callee') + 1;
      const calleeKind = fieldIndex(tables, callee, 'record:kind');
      tables.valueText[calleeKind] = kind;
    },
  })),
];
