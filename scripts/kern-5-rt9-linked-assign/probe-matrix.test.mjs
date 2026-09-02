import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { POSITIONS, SHAPE_POSITIONS, assignShapes, f5Row } from './k0-support.mjs';

const MATRIX_URL = new URL('./probe-matrix.json', import.meta.url);

async function recompute() {
  const positions = {};
  for (const name of Object.keys(POSITIONS).sort()) {
    positions[name] = f5Row(POSITIONS[name]());
  }
  const shapes = {};
  for (const name of [...SHAPE_POSITIONS].sort()) {
    shapes[name] = assignShapes(POSITIONS[name]());
  }
  return { positions, shapes };
}

test('the RT-9 probe matrix reproduces the committed F5 facts exactly', async () => {
  assert.deepEqual(
    await recompute(),
    JSON.parse(await readFile(MATRIX_URL, 'utf8')),
    'RT9_PROBE_DRIFT: F5 no longer projects what the RT-9 contract was built on',
  );
});

test('every fixture the linker is asked to decide on projects first', async () => {
  const matrix = JSON.parse(await readFile(MATRIX_URL, 'utf8'));
  const rejected = Object.entries(matrix.positions).filter(([, row]) => row.status !== 'projected');
  assert.deepEqual(
    rejected.map(([name]) => name).sort(),
    ['neg-postfix-op', 'neg-unquoted-target'],
    'RT9_PROBE_DRIFT: exactly two probes are frontend walls; every other negative must be a link decision',
  );
  for (const [name, row] of rejected) {
    assert.deepEqual(row.diagnostics, ['UNEXPECTED_TOKEN'], name);
  }
});

test('the assign target is a lowered expression, not a name string', async () => {
  const matrix = JSON.parse(await readFile(MATRIX_URL, 'utf8'));
  assert.deepEqual(matrix.shapes['simple-reassign'], [
    { children: 0, properties: ['target', 'value'], targetKind: 'identifier', valueKind: 'text' },
  ]);
  assert.equal(matrix.shapes['neg-target-member'][0].targetKind, 'member');
  assert.equal(matrix.shapes['neg-target-index'][0].targetKind, 'index');
});

test('a compound operator reaches the linker as a property and a trailing comment does not', async () => {
  const matrix = JSON.parse(await readFile(MATRIX_URL, 'utf8'));
  assert.deepEqual(matrix.shapes['neg-op-compound'][0].properties, ['op', 'target', 'value']);
  assert.deepEqual(matrix.shapes['trailing-comment'][0].properties, ['target', 'value']);
});

test('F5 projects an assign inside a helper body, so RT9-O1 is a link decision and not a frontend gap', async () => {
  const matrix = JSON.parse(await readFile(MATRIX_URL, 'utf8'));
  assert.deepEqual(matrix.shapes['helper-body-assign'], [
    { children: 0, properties: ['target', 'value'], targetKind: 'identifier', valueKind: 'text' },
  ]);
  assert.equal(matrix.positions['helper-body-assign'].status, 'projected');
});

test('an assign carries no children, so the leaf gate cannot fire on it', async () => {
  const matrix = JSON.parse(await readFile(MATRIX_URL, 'utf8'));
  for (const [name, shapes] of Object.entries(matrix.shapes)) {
    for (const shape of shapes) assert.equal(shape.children, 0, name);
  }
});
