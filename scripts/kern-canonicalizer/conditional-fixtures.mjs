function lines(...items) {
  return `${items.join('\n')}\n`;
}

function nodeIds(tables, kind) {
  return tables.nodeKind.flatMap((value, index) => value === kind ? [index + 1] : []);
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

export const CONDITIONAL_VALID_FIXTURES = [
  {
    id: 'conditional-trailing-return',
    source: lines(
      'fn name=choose returns=string',
      '  param name=key type=string',
      '  handler lang=kern',
      String.raw`    if cond="key == \"\""`,
      String.raw`      return value="\"empty\""`,
      '    return value="key"',
    ),
    golden: lines(
      'fn name=choose returns=string',
      '  param name=key type=string',
      '  handler lang="kern"',
      String.raw`    if cond="(key == \"\")"`,
      String.raw`      return value="\"empty\""`,
      '    return value="key"',
    ),
  },
  {
    id: 'conditional-if-else',
    source: lines(
      'fn name=absolute returns=number',
      '  param name=value type=number',
      '  handler lang=kern',
      '    if cond="value < 0"',
      '      return value="0 - value"',
      '    else',
      '      return value="value"',
    ),
    golden: lines(
      'fn name=absolute returns=number',
      '  param name=value type=number',
      '  handler lang="kern"',
      '    if cond="(value < 0)"',
      '      return value="(0 - value)"',
      '    else',
      '      return value="value"',
    ),
  },
  {
    id: 'conditional-nested',
    source: lines(
      'fn name=select returns=string',
      '  param name=first type=boolean',
      '  param name=second type=boolean',
      '  handler lang=kern',
      '    if cond=first',
      '      if cond=second',
      String.raw`        return value="\"both\""`,
      '      else',
      String.raw`        return value="\"first\""`,
      '    else',
      String.raw`      return value="\"none\""`,
    ),
    golden: lines(
      'fn name=select returns=string',
      '  param name=first type=boolean',
      '  param name=second type=boolean',
      '  handler lang="kern"',
      '    if cond="first"',
      '      if cond="second"',
      String.raw`        return value="\"both\""`,
      '      else',
      String.raw`        return value="\"first\""`,
      '    else',
      String.raw`      return value="\"none\""`,
    ),
  },
  {
    id: 'conditional-empty-containers',
    source: lines(
      'fn name=emptyBranches returns=number',
      '  param name=flag type=boolean',
      '  handler lang=kern',
      '    if cond=flag',
      '    else',
      '    return value="0"',
    ),
    golden: lines(
      'fn name=emptyBranches returns=number',
      '  param name=flag type=boolean',
      '  handler lang="kern"',
      '    if cond="flag"',
      '    else',
      '    return value="0"',
    ),
  },
];

export const CONDITIONAL_HOSTILE_FIXTURES = [
  {
    id: 'conditional-orphan-else',
    base: 'conditional-if-else',
    category: 'profile rejection',
    mutate(tables) {
      const [ifId] = nodeIds(tables, 'if');
      const [elseId] = nodeIds(tables, 'else');
      tables.nodeKind[ifId - 1] = 'else';
      tables.nodeKind[elseId - 1] = 'if';
      const cond = tables.propNode.findIndex((node, index) => node === ifId && tables.propKey[index] === 'cond');
      tables.propNode[cond] = elseId;
    },
  },
  {
    id: 'conditional-nonadjacent-else',
    base: 'conditional-if-else',
    category: 'profile rejection',
    mutate(tables) {
      const [ifId] = nodeIds(tables, 'if');
      const [elseId] = nodeIds(tables, 'else');
      const handlerId = nodeIds(tables, 'handler')[0];
      const nestedReturn = tables.nodeParent.findIndex((parent) => parent === ifId) + 1;
      tables.nodeOrder[elseId - 1] = 2;
      tables.nodeParent[nestedReturn - 1] = handlerId;
      tables.nodeOrder[nestedReturn - 1] = 1;
    },
  },
  {
    id: 'conditional-missing-cond',
    base: 'conditional-trailing-return',
    category: 'profile rejection',
    mutate(tables) {
      const ifId = nodeIds(tables, 'if')[0];
      const cond = tables.propNode.findIndex((node, index) => node === ifId && tables.propKey[index] === 'cond');
      tables.propKey[cond] = 'future';
    },
  },
  {
    id: 'conditional-extra-if-property',
    base: 'conditional-trailing-return',
    category: 'profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'if')[0], 'future', 'x');
    },
  },
  {
    id: 'conditional-property-bearing-else',
    base: 'conditional-if-else',
    category: 'profile rejection',
    mutate(tables) {
      appendRootTextProperty(tables, nodeIds(tables, 'else')[0], 'future', 'x');
    },
  },
  {
    id: 'conditional-unsupported-child',
    base: 'conditional-trailing-return',
    category: 'profile rejection',
    mutate(tables) {
      const handlerId = nodeIds(tables, 'handler')[0];
      const directReturn = tables.nodeParent.findIndex(
        (parent, index) => parent === handlerId && tables.nodeKind[index] === 'return',
      );
      tables.nodeKind[directReturn] = 'let';
    },
  },
  {
    id: 'conditional-nonterminal-return',
    base: 'conditional-trailing-return',
    category: 'profile rejection',
    mutate(tables) {
      const ifId = nodeIds(tables, 'if')[0];
      const handlerId = nodeIds(tables, 'handler')[0];
      const nestedReturn = tables.nodeParent.findIndex((parent) => parent === ifId);
      tables.nodeParent[nestedReturn] = handlerId;
      tables.nodeOrder[nestedReturn] = 2;
    },
  },
  {
    id: 'conditional-invalid-expression',
    base: 'conditional-if-else',
    category: 'profile rejection',
    mutate(tables) {
      const operator = tables.valueRole.findIndex((role) => role === 'record:op');
      tables.valueText[operator] = '?';
    },
  },
  {
    id: 'conditional-duplicate-else',
    base: 'conditional-nested',
    category: 'profile rejection',
    mutate(tables) {
      const handlerId = nodeIds(tables, 'handler')[0];
      const elseIds = nodeIds(tables, 'else');
      const nestedElse = elseIds.find((id) => tables.nodeParent[id - 1] !== handlerId);
      tables.nodeParent[nestedElse - 1] = handlerId;
      tables.nodeOrder[nestedElse - 1] = 2;
    },
  },
];
