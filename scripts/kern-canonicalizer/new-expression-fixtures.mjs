import { appendTextValue, lines } from './fixture-helpers.mjs';

function fieldIndex(tables, parent, role) {
  return tables.valueRole.findIndex(
    (candidate, index) => candidate === role && tables.valueParent[index] === parent,
  );
}

function newFieldsIds(tables) {
  return tables.valueRole.flatMap((role, index) => {
    if (role !== 'record:kind' || tables.valueText[index] !== 'new') return [];
    const expressionId = tables.valueParent[index];
    const fields = fieldIndex(tables, expressionId, 'record:fields');
    return fields < 0 ? [] : [fields + 1];
  });
}

function newFieldsFor(tables, name) {
  const fieldsId = newFieldsIds(tables).find((candidate) => {
    const constructor = fieldIndex(tables, candidate, 'record:constructor');
    return constructor >= 0 && tables.valueText[constructor] === name;
  });
  if (fieldsId === undefined) throw new Error(`missing ${name} new-expression fields`);
  return fieldsId;
}

function argsId(tables, fieldsId) {
  const args = fieldIndex(tables, fieldsId, 'record:args');
  if (args < 0) throw new Error('missing new-expression args');
  return args + 1;
}

export const NEW_EXPRESSION_VALID_FIXTURES = [
  {
    id: 'bounded-new-expressions',
    source: lines(
      'fn name=emptyMap returns=boolean',
      '  handler lang=kern',
      '    let name=values value="new Map()"',
      '    return value="Map.has(values, \\"key\\")"',
      'fn name=profileError returns=void',
      '  handler lang=kern',
      '    do value="new Error(\\"KERN_CANONICALIZER_PROFILE\\")"',
    ),
    golden: lines(
      'fn name=emptyMap returns=boolean',
      '  handler lang="kern"',
      '    let name=values value="new Map()"',
      '    return value="Map.has(values, \\"key\\")"',
      'fn name=profileError returns=void',
      '  handler lang="kern"',
      '    do value="new Error(\\"KERN_CANONICALIZER_PROFILE\\")"',
    ),
  },
];

export const NEW_EXPRESSION_HOSTILE_FIXTURES = [
  {
    id: 'new-expression-missing-constructor-field',
    base: 'bounded-new-expressions',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = newFieldsFor(tables, 'Map');
      tables.valueRole[fieldIndex(tables, fieldsId, 'record:constructor')] = 'record:future';
    },
  },
  {
    id: 'new-expression-duplicate-args-field',
    base: 'bounded-new-expressions',
    category: 'direct profile rejection',
    mutate(tables) {
      const fieldsId = newFieldsFor(tables, 'Map');
      tables.valueRole[fieldIndex(tables, fieldsId, 'record:constructor')] = 'record:args';
    },
  },
  {
    id: 'new-expression-extra-field',
    base: 'bounded-new-expressions',
    category: 'profile rejection',
    mutate(tables) {
      appendTextValue(tables, 'future', newFieldsFor(tables, 'Map'), 'record:future', 2);
    },
  },
  {
    id: 'new-expression-non-list-args',
    base: 'bounded-new-expressions',
    category: 'profile rejection',
    mutate(tables) {
      const args = fieldIndex(tables, newFieldsFor(tables, 'Map'), 'record:args');
      tables.valueTag[args] = 'text';
      tables.valueText[args] = 'not-args';
    },
  },
  {
    id: 'new-expression-unsupported-constructor',
    base: 'bounded-new-expressions',
    category: 'profile rejection',
    mutate(tables) {
      const fieldsId = newFieldsFor(tables, 'Map');
      tables.valueText[fieldIndex(tables, fieldsId, 'record:constructor')] = 'User';
    },
  },
  {
    id: 'new-map-nonzero-arity',
    base: 'bounded-new-expressions',
    category: 'profile rejection',
    mutate(tables) {
      appendTextValue(tables, 'value', argsId(tables, newFieldsFor(tables, 'Map')), 'list-item', 0);
    },
  },
  {
    id: 'new-error-wrong-arity',
    base: 'bounded-new-expressions',
    category: 'profile rejection',
    mutate(tables) {
      appendTextValue(tables, 'second', argsId(tables, newFieldsFor(tables, 'Error')), 'list-item', 1);
    },
  },
  {
    id: 'new-error-missing-argument-source',
    base: 'bounded-new-expressions',
    category: 'profile rejection',
    mutate(tables) {
      const errorArgsId = argsId(tables, newFieldsFor(tables, 'Error'));
      const argument = tables.valueParent.findIndex((parent) => parent === errorArgsId) + 1;
      const kind = fieldIndex(tables, argument, 'record:kind');
      tables.valueText[kind] = 'future';
    },
  },
];
