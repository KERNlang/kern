import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { flattenKirRoots, tableArguments } from './flatten.mjs';
import { rehydrateKirRoots } from './rehydrate.mjs';

function genericRoots() {
  return [
    {
      kind: 'arbitrary-node',
      properties: [
        {
          key: 'arbitrary-property',
          value: {
            tag: 'record',
            value: [
              {
                key: 'alpha',
                value: {
                  tag: 'list',
                  value: [
                    { tag: 'null' },
                    { tag: 'bool', value: true },
                    { tag: 'text', value: 'text' },
                    { tag: 'int', value: '-12' },
                    { tag: 'decimal', value: '1.25' },
                  ],
                },
              },
              {
                key: 'map-value',
                value: {
                  tag: 'map',
                  value: [
                    {
                      key: { tag: 'text', value: 'key' },
                      value: {
                        tag: 'error',
                        value: {
                          code: 'E_GENERIC',
                          message: 'generic error',
                          details: { tag: 'null' },
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      children: [
        {
          kind: 'child-node',
          properties: [{ key: 'leaf', value: { tag: 'text', value: 'kept' } }],
          children: [],
        },
      ],
    },
  ];
}

function copyTables() {
  return structuredClone(flattenKirRoots(genericRoots()));
}

test('generic flattening rehydrates every canonical value tag without semantic loss', () => {
  const roots = genericRoots();
  const tables = flattenKirRoots(roots);
  assert.deepEqual(rehydrateKirRoots(tables), roots);
  assert.equal(tableArguments(tables).length, 12);
  assert.ok(tableArguments(tables).every(Array.isArray));
});

test('the adapter rejects cyclic and shared object graphs before id allocation', () => {
  const root = genericRoots()[0];
  root.children.push(root);
  assert.throws(() => flattenKirRoots([root]), /adapter rejection: cyclic or shared object graph/u);

  const shared = [];
  const sharedArrays = [{ kind: 'shared-arrays', properties: shared, children: shared }];
  assert.throws(() => flattenKirRoots(sharedArrays), /adapter rejection: cyclic or shared object graph/u);
});

test('both adapter directions reject symbol-decorated records', () => {
  const roots = genericRoots();
  roots[0][Symbol('unknown')] = true;
  assert.throws(() => flattenKirRoots(roots), /adapter rejection: roots\[0\] must/u);

  const tables = copyTables();
  tables[Symbol('unknown')] = [];
  assert.throws(() => rehydrateKirRoots(tables), /adapter rejection: tables have unknown fields/u);
});

test('both adapter directions reject sparse, decorated, and accessor arrays', () => {
  const sparseRoots = [];
  sparseRoots.length = 1;
  sparseRoots.extra = genericRoots()[0];
  assert.throws(() => flattenKirRoots(sparseRoots), /adapter rejection: roots must be a dense plain array/u);

  const decoratedRoots = genericRoots();
  decoratedRoots[Symbol('extra')] = true;
  assert.throws(() => flattenKirRoots(decoratedRoots), /adapter rejection: roots must be a dense plain array/u);

  const accessorRoots = [];
  Object.defineProperty(accessorRoots, 0, { enumerable: true, get: () => genericRoots()[0] });
  assert.throws(() => flattenKirRoots(accessorRoots), /adapter rejection: roots must be a dense plain array/u);

  for (const mutate of [
    (tables) => { delete tables.nodeKind[0]; tables.nodeKind.extra = 'arbitrary-node'; },
    (tables) => { tables.nodeKind[Symbol('extra')] = 'arbitrary-node'; },
    (tables) => {
      const first = tables.nodeKind[0];
      Object.defineProperty(tables.nodeKind, 0, { enumerable: true, get: () => first });
    },
  ]) {
    const tables = copyTables();
    mutate(tables);
    assert.throws(() => rehydrateKirRoots(tables), /adapter rejection: nodeKind must be a dense plain array/u);
  }
});

test('the flattener rejects noncanonical codec shapes before tables escape', () => {
  const integer = genericRoots();
  integer[0].properties[0].value.value[0].value.value[3].value = '01';
  assert.throws(() => flattenKirRoots(integer), /adapter rejection:/u, 'noncanonical integer');

  const unsortedRecord = genericRoots();
  unsortedRecord[0].properties[0].value.value.reverse();
  assert.throws(() => flattenKirRoots(unsortedRecord), /adapter rejection:/u, 'noncanonical record order');

  const duplicateMap = genericRoots();
  const map = duplicateMap[0].properties[0].value.value.find((entry) => entry.key === 'map-value').value;
  map.value.push(structuredClone(map.value[0]));
  assert.throws(() => flattenKirRoots(duplicateMap), /adapter rejection:/u, 'duplicate map key');
});

test('the adapter source contains no admitted-profile or formatting literals', () => {
  const source = readFileSync(new URL('./flatten.mjs', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('flatten.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const literals = new Set();
  const visit = (node) => {
    if (
      ts.isStringLiteralLike(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      literals.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  for (const forbidden of [
    'fn', 'param', 'handler', 'return', 'export', 'returns', 'lang',
    'identifier', 'integer', 'void', 'kern',
    'name', 'type', '  ',
  ]) {
    assert.equal(literals.has(forbidden), false, `adapter leaked semantic/formatting literal ${forbidden}`);
  }
  assert.equal([...literals].some((literal) => literal.includes('value=')), false, 'adapter leaked source syntax');
});

test('rehydration rejects malformed table lengths, ids, cycles, orders, and orphans', () => {
  const cases = [
    ['node table length', (tables) => tables.nodeParent.pop()],
    ['property table length', (tables) => tables.propKey.pop()],
    ['value table length', (tables) => tables.valueRole.pop()],
    ['non-dense value id', (tables) => { tables.propValue[0] = tables.valueTag.length + 1; }],
    ['invalid node parent', (tables) => { tables.nodeParent[0] = tables.nodeKind.length + 1; }],
    ['node cycle', (tables) => { tables.nodeParent[0] = 2; tables.nodeParent[1] = 1; }],
    ['value cycle', (tables) => { tables.valueParent[0] = 1; }],
    ['duplicate sibling order', (tables) => { tables.nodeOrder[1] = tables.nodeOrder[0]; tables.nodeParent[1] = tables.nodeParent[0]; }],
    ['orphan root value', (tables) => { tables.propValue[0] = 2; }],
    ['malformed role', (tables) => { tables.valueRole[1] = 'unknown-role'; }],
    ['nonzero root order', (tables) => { tables.valueOrder[tables.propValue[0] - 1] = 7; }],
    ['malformed error order', (tables) => {
      const message = tables.valueRole.indexOf('error-message');
      tables.valueOrder[message] = 0;
    }],
  ];
  for (const [name, mutate] of cases) {
    const tables = copyTables();
    mutate(tables);
    assert.throws(() => rehydrateKirRoots(tables), /adapter rejection:/u, name);
  }
});

test('rehydration rejects noncanonical scalar, record, and map codec shapes', () => {
  const integer = copyTables();
  integer.valueText[integer.valueTag.indexOf('int')] = '01';
  assert.throws(() => rehydrateKirRoots(integer), /adapter rejection:/u, 'noncanonical integer');

  const decimal = copyTables();
  decimal.valueText[decimal.valueTag.indexOf('decimal')] = '01.25';
  assert.throws(() => rehydrateKirRoots(decimal), /adapter rejection:/u, 'noncanonical decimal');

  const unsortedRecord = genericRoots();
  unsortedRecord[0].properties[0].value.value.reverse();
  assert.throws(
    () => rehydrateKirRoots(flattenKirRoots(unsortedRecord)),
    /adapter rejection:/u,
    'record keys must be canonical-code-point sorted',
  );

  const duplicateMap = genericRoots();
  const map = duplicateMap[0].properties[0].value.value.find((entry) => entry.key === 'map-value').value;
  map.value.push(structuredClone(map.value[0]));
  assert.throws(
    () => rehydrateKirRoots(flattenKirRoots(duplicateMap)),
    /adapter rejection:/u,
    'map scalar keys must be unique',
  );
});

test('unknown canonical tags are rejected instead of omitted', () => {
  const roots = genericRoots();
  roots[0].properties[0].value.tag = 'future-tag';
  assert.throws(() => flattenKirRoots(roots), /adapter rejection: unknown canonical value tag/u);
});
