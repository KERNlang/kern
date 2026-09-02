import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  FRONTEND_WALLS,
  POSITIONS,
  SHAPE_POSITIONS,
  SHAPE_TABLE_ROWS,
  TABLE_ROWS,
  f5Row,
  statementShapes,
  tableSource,
} from './k0-support.mjs';

const MATRIX_URL = new URL('./probe-matrix.json', import.meta.url);

function rowByName(name) {
  const row = TABLE_ROWS.find((entry) => entry.name === name);
  assert.ok(row !== undefined, `the behavior table must carry ${name}`);
  return row;
}

async function recompute() {
  const positions = {};
  for (const name of Object.keys(POSITIONS).sort()) {
    positions[name] = f5Row(POSITIONS[name]());
  }
  const table = {};
  for (const row of [...TABLE_ROWS].sort((left, right) => (left.name < right.name ? -1 : 1))) {
    table[row.name] = f5Row(tableSource(row));
  }
  const shapes = {};
  for (const name of [...SHAPE_POSITIONS].sort()) {
    shapes[name] = statementShapes(POSITIONS[name]());
  }
  const tableShapes = {};
  for (const name of [...SHAPE_TABLE_ROWS].sort()) {
    tableShapes[name] = statementShapes(tableSource(rowByName(name)));
  }
  return { positions, shapes, table, tableShapes };
}

async function matrix() {
  return JSON.parse(await readFile(MATRIX_URL, 'utf8'));
}

test('the RT-10-pre probe matrix reproduces the committed F5 facts exactly', async () => {
  assert.deepEqual(
    await recompute(),
    await matrix(),
    'RT10PRE_PROBE_DRIFT: F5 no longer projects what the RT-10-pre contract was built on',
  );
});

test('every fixture the linker is asked to decide on projects first', async () => {
  const committed = await matrix();
  const rejected = Object.entries(committed.positions).filter(([, row]) => row.status !== 'projected');
  assert.deepEqual(
    rejected.map(([name]) => name).sort(),
    [...FRONTEND_WALLS].sort(),
    'RT10PRE_PROBE_DRIFT: exactly two probes are frontend walls; every other negative must be a link decision',
  );
  for (const [name, row] of rejected) {
    assert.deepEqual(row.diagnostics, ['FRONTEND_INVALID_EXPRESSION'], name);
  }
});

test('every frozen behavior-table expression projects, so no value row is a frontend gap', async () => {
  const committed = await matrix();
  assert.equal(Object.keys(committed.table).length, TABLE_ROWS.length);
  for (const [name, row] of Object.entries(committed.table)) {
    assert.equal(row.status, 'projected', name);
    assert.deepEqual(row.diagnostics, [], name);
  }
});

test('an arithmetic operator reaches the linker as a binary node carrying its operator text', async () => {
  const committed = await matrix();
  assert.deepEqual(committed.shapes['add-in-let'][0], {
    kind: 'let',
    properties: {
      name: 'n',
      value: {
        kind: 'binary',
        left: { kind: 'integer', value: '1' },
        op: '+',
        right: { kind: 'integer', value: '2' },
      },
    },
  });
  assert.equal(committed.shapes['refuse-div'][0].properties.value.op, '/');
});

test('a negative literal arrives as a unary node over a non-negative canonical payload', async () => {
  const committed = await matrix();
  assert.deepEqual(committed.shapes['neg-in-return'][0], {
    kind: 'return',
    properties: { value: { argument: { kind: 'integer', value: '7' }, kind: 'unary', op: '-' } },
  });
  assert.deepEqual(committed.shapes['neg-of-local'][1].properties.value, {
    argument: { kind: 'identifier', name: 'n' },
    kind: 'unary',
    op: '-',
  });
  assert.equal(committed.shapes['refuse-unary-not'][1].properties.value.op, '!');
});

test('F2 precedence and associativity are already decided before the linker sees the tree', async () => {
  const committed = await matrix();
  const mulThenAdd = committed.tableShapes['prec-mul-then-add'][0].properties.value;
  assert.equal(mulThenAdd.op, '+');
  assert.equal(mulThenAdd.left.op, '*', '2 * 3 + 4 must project as (2 * 3) + 4');
  const parenFirst = committed.tableShapes['prec-paren-add-first'][0].properties.value;
  assert.equal(parenFirst.op, '*');
  assert.equal(parenFirst.right.op, '+', '2 * (3 + 4) must project as 2 * (3 + 4)');
  const leftAssoc = committed.tableShapes['sub-left-assoc'][0].properties.value;
  assert.equal(leftAssoc.op, '-');
  assert.equal(leftAssoc.left.op, '-', '10 - 3 - 2 must project left-associatively');
  assert.equal(leftAssoc.right.value, '2');
});

test('a unary node nests inside a binary operand and inside another unary', async () => {
  const committed = await matrix();
  const subNegRight = committed.tableShapes['sub-neg-right'][0].properties.value;
  assert.equal(subNegRight.op, '-');
  assert.deepEqual(subNegRight.right, { argument: { kind: 'integer', value: '3' }, kind: 'unary', op: '-' });
  const double = committed.tableShapes['neg-double'][0].properties.value;
  assert.equal(double.kind, 'unary');
  assert.equal(double.argument.kind, 'unary');
  assert.equal(double.argument.argument.value, '7');
});

test('F5 projects arithmetic inside a helper body, so the helper position is a link decision', async () => {
  const committed = await matrix();
  assert.equal(committed.positions['helper-body-arith'].status, 'projected');
  assert.deepEqual(committed.shapes['helper-body-arith'][0].properties.value, {
    kind: 'binary',
    left: { kind: 'integer', value: '1' },
    op: '+',
    right: { kind: 'integer', value: '2' },
  });
});

test('F5 projects an arithmetic and a unary value into an assign, the rt10 accumulator shape', async () => {
  const committed = await matrix();
  assert.equal(committed.positions['assign-arith'].status, 'projected');
  assert.deepEqual(committed.shapes['assign-arith'][1], {
    kind: 'assign',
    properties: {
      target: { kind: 'identifier', name: 'n' },
      value: {
        kind: 'binary',
        left: { kind: 'identifier', name: 'n' },
        op: '+',
        right: { kind: 'integer', value: '1' },
      },
    },
  });
  assert.deepEqual(committed.shapes['assign-neg'][1].properties.value, {
    argument: { kind: 'identifier', name: 'n' },
    kind: 'unary',
    op: '-',
  });
});
