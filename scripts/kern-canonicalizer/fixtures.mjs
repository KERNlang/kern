import { BINARY_HOSTILE_FIXTURES, BINARY_VALID_FIXTURES } from './binary-fixtures.mjs';
import { BINDING_HOSTILE_FIXTURES, BINDING_VALID_FIXTURES } from './binding-fixtures.mjs';
import { CALL_HOSTILE_FIXTURES, CALL_VALID_FIXTURES } from './call-fixtures.mjs';
import { CONDITIONAL_HOSTILE_FIXTURES, CONDITIONAL_VALID_FIXTURES } from './conditional-fixtures.mjs';
import { COUNTED_ITERATION_HOSTILE_FIXTURES, COUNTED_ITERATION_VALID_FIXTURES } from './counted-iteration-fixtures.mjs';
import { DO_HOSTILE_FIXTURES, DO_VALID_FIXTURES } from './do-fixtures.mjs';
import {
  appendRootBoolValue,
  appendRootTextValue,
  appendRootTypeValue,
  appendTextValue,
  lines,
} from './fixture-helpers.mjs';
import { INDEX_HOSTILE_FIXTURES, INDEX_VALID_FIXTURES } from './index-fixtures.mjs';
import { MEMBER_HOSTILE_FIXTURES, MEMBER_VALID_FIXTURES } from './member-fixtures.mjs';
import {
  NEW_EXPRESSION_HOSTILE_FIXTURES,
  NEW_EXPRESSION_VALID_FIXTURES,
} from './new-expression-fixtures.mjs';
import { PROFILE_BOUNDARY_FIXTURE } from './profile-limit-fixtures.mjs';
import {
  ESCAPED_OUTPUT_BOUNDARY_FIXTURE,
  REVIEW_BOUNDARY_FIXTURES,
} from './review-boundary-fixtures.mjs';
import { SEMANTIC_BOUNDARY_FIXTURES } from './semantic-boundary-fixtures.mjs';
import { UNARY_HOSTILE_FIXTURES, UNARY_VALID_FIXTURES } from './unary-fixtures.mjs';
import { WHILE_HOSTILE_FIXTURES, WHILE_VALID_FIXTURES } from './while-fixtures.mjs';

export const VALID_FIXTURES = [
  {
    id: 'shuffled-identifier',
    source: lines(
      'fn export=true returns=string name=greet',
      '  param type=string name=name',
      '  handler lang="kern"',
      '    return value="name"',
    ),
    golden: lines(
      'fn name=greet returns=string export=true',
      '  param name=name type=string',
      '  handler lang="kern"',
      '    return value="name"',
    ),
  },
  {
    id: 'ordered-list-text',
    source: lines(
      'fn returns="string[]" name=ordered',
      '  param type=string name=first',
      '  param name=second type=string',
      '  handler lang=kern',
      String.raw`    return value="[second, \"tab\\tcarriage\\rline\\nquote\\\"slash\\\\\", first]"`,
    ),
    golden: lines(
      'fn name=ordered returns=string[]',
      '  param name=first type=string',
      '  param name=second type=string',
      '  handler lang="kern"',
      String.raw`    return value="[second, \"tab\\tcarriage\\rline\\nquote\\\"slash\\\\\", first]"`,
    ),
  },
  {
    id: 'multiple-roots',
    source: lines(
      'fn name=zeta returns=boolean export=false',
      '  handler lang=kern',
      '    return value="false"',
      'fn returns=number name=alpha',
      '  handler lang=kern',
      '    return value="12"',
    ),
    golden: lines(
      'fn name=zeta returns=boolean export=false',
      '  handler lang="kern"',
      '    return value="false"',
      'fn name=alpha returns=number',
      '  handler lang="kern"',
      '    return value="12"',
    ),
  },
  {
    id: 'null-and-nested-list',
    source: lines(
      'fn name=nested returns="string[]"',
      '  handler lang=kern',
      '    return value="[null,[true,7]]"',
    ),
    golden: lines(
      'fn name=nested returns=string[]',
      '  handler lang="kern"',
      '    return value="[null, [true, 7]]"',
    ),
  },
  {
    id: 'remaining-list-types',
    source: lines(
      'fn returns="boolean[]" name=flags',
      '  handler lang=kern',
      '    return value="[true,false]"',
      'fn name=counts returns="number[]"',
      '  handler lang=kern',
      '    return value="[1,2]"',
    ),
    golden: lines(
      'fn name=flags returns=boolean[]',
      '  handler lang="kern"',
      '    return value="[true, false]"',
      'fn name=counts returns=number[]',
      '  handler lang="kern"',
      '    return value="[1, 2]"',
    ),
  },
  {
    id: 'keyword-shaped-identifiers',
    source: lines(
      'fn returns="string[]" name=keywords',
      '  param type=string name=let',
      '  param name=fn type=string',
      '  handler lang=kern',
      '    return value="[let,fn]"',
    ),
    golden: lines(
      'fn name=keywords returns=string[]',
      '  param name=let type=string',
      '  param name=fn type=string',
      '  handler lang="kern"',
      '    return value="[let, fn]"',
    ),
  },
  {
    id: 'dollar-structural-identifiers',
    source: lines(
      'fn name="$fn" returns=string',
      '  param name="$value" type=string',
      '  handler lang=kern',
      '    return value="$value"',
    ),
    golden: lines(
      'fn name="$fn" returns=string',
      '  param name="$value" type=string',
      '  handler lang="kern"',
      '    return value="$value"',
    ),
  },
  {
    id: 'void-return',
    source: lines('fn export=true name=finished returns=void', '  handler lang=kern', '    return'),
    golden: lines('fn name=finished returns=void export=true', '  handler lang="kern"', '    return'),
  },
  {
    id: 'parameter-types',
    source: lines(
      'fn returns=void name=accepts',
      '  param type=string name=textValue',
      '  param name=flagValue type=boolean',
      '  param type=number name=countValue',
      '  param name=textValues type="string[]"',
      '  param type="boolean[]" name=flagValues',
      '  param name=countValues type="number[]"',
      '  handler lang=kern',
      '    return',
    ),
    golden: lines(
      'fn name=accepts returns=void',
      '  param name=textValue type=string',
      '  param name=flagValue type=boolean',
      '  param name=countValue type=number',
      '  param name=textValues type=string[]',
      '  param name=flagValues type=boolean[]',
      '  param name=countValues type=number[]',
      '  handler lang="kern"',
      '    return',
    ),
  },
  ...BINARY_VALID_FIXTURES,
  ...CONDITIONAL_VALID_FIXTURES,
  ...CALL_VALID_FIXTURES,
  ...MEMBER_VALID_FIXTURES,
  ...INDEX_VALID_FIXTURES,
  ...NEW_EXPRESSION_VALID_FIXTURES,
  ...COUNTED_ITERATION_VALID_FIXTURES,
  ...BINDING_VALID_FIXTURES,
  ...UNARY_VALID_FIXTURES,
  ...DO_VALID_FIXTURES,
  ...WHILE_VALID_FIXTURES,
  ESCAPED_OUTPUT_BOUNDARY_FIXTURE,
  PROFILE_BOUNDARY_FIXTURE,
];

export const HOSTILE_FIXTURES = [
  ...SEMANTIC_BOUNDARY_FIXTURES,
  ...CONDITIONAL_HOSTILE_FIXTURES,
  ...CALL_HOSTILE_FIXTURES,
  ...MEMBER_HOSTILE_FIXTURES,
  ...INDEX_HOSTILE_FIXTURES,
  ...NEW_EXPRESSION_HOSTILE_FIXTURES,
  ...COUNTED_ITERATION_HOSTILE_FIXTURES,
  ...BINDING_HOSTILE_FIXTURES,
  ...UNARY_HOSTILE_FIXTURES,
  ...DO_HOSTILE_FIXTURES,
  ...WHILE_HOSTILE_FIXTURES,
  {
    id: 'empty-root-list',
    base: 'shuffled-identifier',
    category: 'profile rejection',
    mutate(tables) {
      for (const values of Object.values(tables)) values.length = 0;
    },
  },
  {
    id: 'node-table-length',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      tables.nodeParent.pop();
    },
  },
  {
    id: 'property-table-length',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      tables.propKey.pop();
    },
  },
  {
    id: 'value-table-length',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      tables.valueRole.pop();
    },
  },
  {
    id: 'non-dense-value-id',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      tables.propValue[0] = tables.valueTag.length + 1;
    },
  },
  {
    id: 'invalid-node-parent',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      tables.nodeParent[0] = tables.nodeKind.length + 1;
    },
  },
  {
    id: 'node-cycle',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      tables.nodeParent[0] = 2;
      tables.nodeParent[1] = 1;
    },
  },
  {
    id: 'value-cycle',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      const value = tables.propValue[0];
      tables.valueParent[value - 1] = value;
    },
  },
  {
    id: 'duplicate-sibling-order',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      const siblings = tables.nodeParent
        .map((parent, index) => ({ index, parent }))
        .filter((entry) => entry.parent === 1);
      tables.nodeOrder[siblings[1].index] = tables.nodeOrder[siblings[0].index];
    },
  },
  {
    id: 'duplicate-required-property',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      const value = appendRootTextValue(tables, 'duplicate');
      tables.propNode.push(1);
      tables.propKey.push('name');
      tables.propValue.push(value);
    },
  },
  {
    id: 'duplicate-returns-property',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      const value = appendRootTypeValue(tables, 'string');
      tables.propNode.push(1);
      tables.propKey.push('returns');
      tables.propValue.push(value);
    },
  },
  {
    id: 'duplicate-export-property',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      const value = appendRootBoolValue(tables, false);
      tables.propNode.push(1);
      tables.propKey.push('export');
      tables.propValue.push(value);
    },
  },
  {
    id: 'void-parameter-type',
    base: 'shuffled-identifier',
    category: 'profile rejection',
    mutate(tables) {
      const param = tables.nodeKind.indexOf('param') + 1;
      const typeProperty = tables.propNode.findIndex(
        (node, index) => node === param && tables.propKey[index] === 'type',
      );
      const typeValue = tables.propValue[typeProperty];
      const kind = tables.valueParent.findIndex(
        (parent, index) => parent === typeValue && tables.valueRole[index] === 'record:kind',
      );
      tables.valueText[kind] = 'void';
    },
  },
  {
    id: 'orphan-value',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      appendRootTextValue(tables, 'orphan');
    },
  },
  {
    id: 'unknown-tag',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      tables.valueTag[tables.propValue[0] - 1] = 'future-tag';
    },
  },
  {
    id: 'malformed-role',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      const child = tables.valueParent.findIndex((parent) => parent > 0);
      tables.valueRole[child] = 'unknown-role';
    },
  },
  {
    id: 'noncanonical-record-field-order-direct',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      const fields = tables.valueRole.indexOf('record:fields');
      const parent = tables.valueParent[fields];
      const kind = tables.valueRole.findIndex(
        (role, index) => role === 'record:kind' && tables.valueParent[index] === parent,
      );
      const order = tables.valueOrder[fields];
      tables.valueOrder[fields] = tables.valueOrder[kind];
      tables.valueOrder[kind] = order;
    },
  },
  {
    id: 'duplicate-record-field-direct',
    base: 'shuffled-identifier',
    category: 'direct profile rejection',
    mutate(tables) {
      const fields = tables.valueRole.indexOf('record:fields');
      const parent = tables.valueParent[fields];
      const kind = tables.valueRole.findIndex(
        (role, index) => role === 'record:kind' && tables.valueParent[index] === parent,
      );
      tables.valueRole[fields] = tables.valueRole[kind];
    },
  },
  {
    id: 'unknown-property-with-export',
    base: 'shuffled-identifier',
    category: 'profile rejection',
    mutate(tables) {
      const value = appendRootTextValue(tables, 'retained');
      tables.propNode.push(1);
      tables.propKey.push('future');
      tables.propValue.push(value);
    },
  },
  {
    id: 'unknown-property-without-export',
    base: 'ordered-list-text',
    category: 'profile rejection',
    mutate(tables) {
      const value = appendRootTextValue(tables, 'retained');
      tables.propNode.push(1);
      tables.propKey.push('future');
      tables.propValue.push(value);
    },
  },
  ...REVIEW_BOUNDARY_FIXTURES,
  {
    id: 'unsupported-expression-kind',
    base: 'shuffled-identifier',
    category: 'profile rejection',
    mutate(tables) {
      const kind = tables.valueRole.findIndex(
        (role, index) => role === 'record:kind' && tables.valueText[index] === 'identifier',
      );
      tables.valueText[kind] = 'binary';
    },
  },
  ...BINARY_HOSTILE_FIXTURES,
  ...['true', 'false', 'null', 'none', 'undefined', 'await', 'new', 'typeof'].map((reserved) => ({
    id: `reserved-identifier-${reserved}`,
    base: 'shuffled-identifier',
    category: 'profile rejection',
    mutate(tables) {
      const name = tables.valueRole.findIndex((role) => role === 'record:name');
      tables.valueText[name] = reserved;
    },
  })),
  ...Array.from({ length: 32 }, (_, code) => code)
    .filter((code) => code !== 9 && code !== 10 && code !== 13)
    .map((code) => ({
      id: `unsupported-text-control-${code.toString(16).padStart(2, '0')}`,
      base: 'ordered-list-text',
      category: 'profile rejection',
      mutate(tables) {
        const value = tables.valueRole.findIndex(
          (role, index) => role === 'record:value' && tables.valueText[index].includes('line'),
        );
        tables.valueText[value] = String.fromCharCode(code);
      },
    })),
  ...Array.from({ length: 33 }, (_, index) => index + 0x7f).map((code) => ({
    id: `unsupported-text-control-${code.toString(16)}`,
    base: 'ordered-list-text',
    category: 'profile rejection',
    mutate(tables) {
      const value = tables.valueRole.findIndex(
        (role, valueIndex) => role === 'record:value' && tables.valueText[valueIndex].includes('line'),
      );
      tables.valueText[value] = String.fromCharCode(code);
    },
  })),
  {
    id: 'unsupported-map-value',
    base: 'shuffled-identifier',
    category: 'profile rejection',
    mutate(tables) {
      const parent = tables.propValue[tables.propKey.indexOf('returns')];
      const child = tables.valueParent.findIndex((candidate) => candidate === parent);
      tables.valueTag[parent - 1] = 'map';
      tables.valueRole[child] = 'map-key';
      tables.valueOrder[child] = 0;
      appendTextValue(tables, 'value', parent, 'map-value', 0);
    },
  },
  {
    id: 'unsupported-error-value',
    base: 'shuffled-identifier',
    category: 'profile rejection',
    mutate(tables) {
      const parent = tables.propValue[tables.propKey.indexOf('returns')];
      const child = tables.valueParent.findIndex((candidate) => candidate === parent);
      tables.valueTag[parent - 1] = 'error';
      tables.valueRole[child] = 'error-code';
      tables.valueOrder[child] = 0;
      appendTextValue(tables, 'unsupported profile value', parent, 'error-message', 1);
    },
  },
  {
    id: 'unsupported-child-kind',
    base: 'shuffled-identifier',
    category: 'profile rejection',
    mutate(tables) {
      const returned = tables.nodeKind.indexOf('return');
      tables.nodeKind[returned] = 'print';
    },
  },
  {
    id: 'valid-prefix-invalid-suffix',
    base: 'multiple-roots',
    category: 'profile rejection',
    mutate(tables) {
      const roots = tables.nodeParent
        .map((parent, index) => ({ index, parent }))
        .filter((entry) => entry.parent === 0);
      tables.nodeKind[roots.at(-1).index] = 'class';
    },
  },
];
