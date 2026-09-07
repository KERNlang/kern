import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { STRUCTURAL_KIR_NODE_CATALOG } from '../../packages/core/dist/kir-structural/catalog.generated.js';
import {
  JUMP_FENCES,
  JUMP_METER_POSITIONS,
  JUMP_POSITIONS,
  JUMP_SHAPE_POSITIONS,
  JUMP_TWINS,
  f5Row,
  statementTree,
} from './k0-support.mjs';

const MATRIX_URL = new URL('./probe-matrix.json', import.meta.url);

const ALL_SOURCES = Object.freeze({ ...JUMP_POSITIONS, ...JUMP_METER_POSITIONS, ...JUMP_TWINS });

const JUMP_KINDS = Object.freeze(['break', 'continue']);

function catalogSchema(kind) {
  const entry = STRUCTURAL_KIR_NODE_CATALOG.get(kind);
  assert.ok(entry !== undefined, `the structural catalog must bind ${kind}`);
  const properties = Object.keys(entry.properties)
    .sort()
    .map((name) => {
      const property = entry.properties[name];
      return [
        name,
        {
          disposition: property.disposition,
          required: property.required,
          schemaKind: property.schemaKind,
          values: property.values === null ? null : [...property.values].sort(),
        },
      ];
    });
  return {
    allowedChildren: entry.allowedChildren === null ? null : [...entry.allowedChildren].sort(),
    disposition: entry.disposition,
    kind,
    properties: Object.fromEntries(properties),
    schemaStatus: entry.schemaStatus,
  };
}

async function recompute() {
  const fences = {};
  for (const name of Object.keys(JUMP_FENCES).sort()) {
    fences[name] = f5Row(JUMP_FENCES[name]());
  }
  const positions = {};
  for (const name of Object.keys(ALL_SOURCES).sort()) {
    positions[name] = f5Row(ALL_SOURCES[name]());
  }
  const shapes = {};
  for (const name of [...JUMP_SHAPE_POSITIONS].sort()) {
    shapes[name] = statementTree(JUMP_POSITIONS[name]());
  }
  const structuralSchema = {};
  for (const kind of JUMP_KINDS) structuralSchema[kind] = catalogSchema(kind);
  return { fences, positions, shapes, structuralSchema };
}

async function matrix() {
  const raw = await readFile(MATRIX_URL, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(`${JSON.stringify(parsed, null, 2)}\n`, raw, 'the probe matrix must stay canonically serialized');
  return parsed;
}

test('the RT-12 probe matrix reproduces the committed F5 facts exactly', async () => {
  assert.deepEqual(
    await recompute(),
    await matrix(),
    'RT12J_PROBE_DRIFT: F5 no longer projects what the jump contract was built on',
  );
});

// The single most important GREEN pin in the suite: every fixture the linker is asked to decide on
// already projects at base, so no RED anywhere else can be a projection gap wearing a link label.
test('every fixture the linker is asked to decide on projects first, so no negative is a frontend gap', async () => {
  const committed = await matrix();
  const names = Object.keys(committed.positions);
  assert.equal(names.length, Object.keys(ALL_SOURCES).length, 'the matrix must carry every fixture');
  for (const name of names) {
    assert.equal(committed.positions[name].status, 'projected', `${name} must project`);
    assert.deepEqual(committed.positions[name].diagnostics, [], `${name} must project without a diagnostic`);
  }
});

// `allowedChildren: null` is unrestricted, not childless, which is exactly why a jump carrying
// children reaches the linker and the leaf gate is the thing that refuses it.
test('F5 binds break and continue as leaf-shaped nodes whose child list is unrestricted', async () => {
  const committed = await matrix();
  for (const kind of JUMP_KINDS) {
    const schema = committed.structuralSchema[kind];
    assert.equal(schema.schemaStatus, 'bound', `${kind} must be a bound catalog node, not a candidate`);
    assert.equal(schema.allowedChildren, null, `RT12J_SCHEMA_WIDENED: ${kind} must keep an unrestricted child list`);
    assert.deepEqual(Object.keys(schema.properties), ['trailingComment'], `${kind} carries exactly one property`);
    assert.equal(schema.properties.trailingComment.required, false);
    assert.equal(schema.properties.trailingComment.schemaKind, 'string');
    assert.equal(schema.properties.trailingComment.disposition, 'included-value');
  }
  assert.deepEqual(
    committed.structuralSchema.break,
    { ...committed.structuralSchema.continue, kind: 'break' },
    'RT12J_SCHEMA_WIDENED: the two jump kinds must stay schema-identical apart from their name',
  );
});

// A jump arrives at the linker with an *empty* property map: F5 drops the trailing comment rather
// than projecting it, so `break # done` and `break` are the same projected node.
test('a trailing comment is dropped by F5, so a commented jump projects as a bare one', async () => {
  const committed = await matrix();
  const bare = committed.shapes['for-break'];
  const commented = committed.shapes['for-break-trailing-comment'];
  assert.deepEqual(commented, bare, 'RT12J_PROPERTY_LEAK: a trailing comment must not reach the projected node');
  const loop = bare.find((node) => node.kind === 'for');
  assert.deepEqual(loop.children.map((node) => node.kind), ['break'], 'the jump is the loop body child');
  assert.deepEqual(Object.keys(loop.children[0].properties), [], 'the projected jump carries no property at all');
  assert.equal(loop.children[0].children, undefined, 'a bare jump projects childless');
});

// The children a jump may carry, projected. This is the shape the leaf gate has to see in order to
// win over the loop-depth gate, so it is a matrix fact rather than only a link assertion.
test('a jump with an indented statement under it projects with that statement as its child', async () => {
  const committed = await matrix();
  const loop = committed.shapes['neg-break-with-children-in-loop'].find((node) => node.kind === 'for');
  const jump = loop.children[0];
  assert.equal(jump.kind, 'break');
  assert.deepEqual(jump.children.map((node) => node.kind), ['assign'], 'the indented statement is a break child');
});

// The canonical importer shape, projected: a condition loop whose only exit is a guarded jump.
test('the while-true importer shape projects with the jump nested under the guard', async () => {
  const committed = await matrix();
  const loop = committed.shapes['while-true-break-counter'].find((node) => node.kind === 'while');
  assert.deepEqual(loop.children.map((node) => node.kind), ['assign', 'if']);
  const guard = loop.children[1];
  assert.deepEqual(guard.children.map((node) => node.kind), ['break'], 'the break is the if branch child');
});

// The only F5 fence a jump has. A foreign property key is refused, so this slice writes its
// link-time property gate purely as defence in depth and never as a reachable decision.
test('a foreign property on either jump kind is refused by F5', async () => {
  const committed = await matrix();
  for (const name of Object.keys(JUMP_FENCES)) {
    assert.equal(
      committed.fences[name].status,
      'rejected',
      `RT12J_SCHEMA_WIDENED: ${name} now projects, so the jump contract needs revisiting`,
    );
    assert.equal(f5Row(JUMP_FENCES[name]()).status, 'rejected', `${name} must be refused by F5 live too`);
  }
});
