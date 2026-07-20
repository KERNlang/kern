function lines(...items) {
  return `${items.join('\n')}\n`;
}

function appendTextValue(tables, text, parent = 0, role = '', order = 0) {
  tables.valueTag.push('text');
  tables.valueParent.push(parent);
  tables.valueRole.push(role);
  tables.valueOrder.push(order);
  tables.valueText.push(text);
  tables.valueBool.push(0);
}

export const BINARY_VALID_FIXTURES = [
  {
    id: 'binary-basic',
    source: lines(
      'fn name=calculate returns=number',
      '  param name=left type=number',
      '  param name=right type=number',
      '  handler lang=kern',
      '    return value="left + right * 2"',
    ),
    golden: lines(
      'fn name=calculate returns=number',
      '  param name=left type=number',
      '  param name=right type=number',
      '  handler lang="kern"',
      '    return value="(left + (right * 2))"',
    ),
  },
  {
    id: 'binary-associativity',
    source: lines(
      'fn name=leftNested returns=number',
      '  param name=a type=number',
      '  param name=b type=number',
      '  param name=c type=number',
      '  handler lang=kern',
      '    return value="(a - b) - c"',
      'fn name=rightNested returns=number',
      '  param name=a type=number',
      '  param name=b type=number',
      '  param name=c type=number',
      '  handler lang=kern',
      '    return value="a - (b - c)"',
    ),
    golden: lines(
      'fn name=leftNested returns=number',
      '  param name=a type=number',
      '  param name=b type=number',
      '  param name=c type=number',
      '  handler lang="kern"',
      '    return value="((a - b) - c)"',
      'fn name=rightNested returns=number',
      '  param name=a type=number',
      '  param name=b type=number',
      '  param name=c type=number',
      '  handler lang="kern"',
      '    return value="(a - (b - c))"',
    ),
  },
  {
    id: 'binary-exponentiation-nesting',
    source: lines(
      'fn name=leftExponent returns=number',
      '  param name=a type=number',
      '  param name=b type=number',
      '  param name=c type=number',
      '  handler lang=kern',
      '    return value="(a ** b) ** c"',
      'fn name=rightExponent returns=number',
      '  param name=a type=number',
      '  param name=b type=number',
      '  param name=c type=number',
      '  handler lang=kern',
      '    return value="a ** (b ** c)"',
    ),
    golden: lines(
      'fn name=leftExponent returns=number',
      '  param name=a type=number',
      '  param name=b type=number',
      '  param name=c type=number',
      '  handler lang="kern"',
      '    return value="((a ** b) ** c)"',
      'fn name=rightExponent returns=number',
      '  param name=a type=number',
      '  param name=b type=number',
      '  param name=c type=number',
      '  handler lang="kern"',
      '    return value="(a ** (b ** c))"',
    ),
  },
];

export const BINARY_HOSTILE_FIXTURES = [
  {
    id: 'binary-missing-left-field',
    base: 'binary-basic',
    category: 'profile rejection',
    mutate(tables) {
      const left = tables.valueRole.indexOf('record:left');
      tables.valueRole[left] = 'record:future';
    },
  },
  {
    id: 'binary-duplicate-op-field',
    base: 'binary-basic',
    category: 'direct profile rejection',
    mutate(tables) {
      const right = tables.valueRole.indexOf('record:right');
      tables.valueRole[right] = 'record:op';
    },
  },
  {
    id: 'binary-extra-field',
    base: 'binary-basic',
    category: 'profile rejection',
    mutate(tables) {
      const op = tables.valueRole.indexOf('record:op');
      appendTextValue(tables, 'extra', tables.valueParent[op], 'record:zzz', 3);
    },
  },
  {
    id: 'binary-non-text-op',
    base: 'binary-basic',
    category: 'profile rejection',
    mutate(tables) {
      const op = tables.valueRole.indexOf('record:op');
      tables.valueTag[op] = 'bool';
      tables.valueText[op] = '';
      tables.valueBool[op] = 1;
    },
  },
  ...['', ' ', '++', '***', '=', '====', '>>>>', '＞', '∗', 'instanceof '].map((operator, index) => ({
    id: `binary-invalid-op-${index}`,
    base: 'binary-basic',
    category: 'profile rejection',
    mutate(tables) {
      const op = tables.valueRole.indexOf('record:op');
      tables.valueText[op] = operator;
    },
  })),
];
