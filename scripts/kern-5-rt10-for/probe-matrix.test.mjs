import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BODY_FENCES,
  METER_POSITIONS,
  POSITIONS,
  SHAPE_POSITIONS,
  TWINS,
  f5Row,
  statementTree,
} from './k0-support.mjs';

const MATRIX_URL = new URL('./probe-matrix.json', import.meta.url);

const ALL_SOURCES = Object.freeze({ ...POSITIONS, ...METER_POSITIONS, ...TWINS });

async function recompute() {
  const fences = {};
  for (const name of Object.keys(BODY_FENCES).sort()) {
    fences[name] = f5Row(BODY_FENCES[name]());
  }
  const positions = {};
  for (const name of Object.keys(ALL_SOURCES).sort()) {
    positions[name] = f5Row(ALL_SOURCES[name]());
  }
  const shapes = {};
  for (const name of [...SHAPE_POSITIONS].sort()) {
    shapes[name] = statementTree(POSITIONS[name]());
  }
  return { fences, positions, shapes };
}

async function matrix() {
  const raw = await readFile(MATRIX_URL, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(`${JSON.stringify(parsed, null, 2)}\n`, raw, 'the probe matrix must stay canonically serialized');
  return parsed;
}

test('the RT-10-F probe matrix reproduces the committed F5 facts exactly', async () => {
  assert.deepEqual(
    await recompute(),
    await matrix(),
    'RT10F_PROBE_DRIFT: F5 no longer projects what the loop contract was built on',
  );
});

test('every fixture the linker is asked to decide on projects first, so no negative is a frontend gap', async () => {
  const committed = await matrix();
  const names = Object.keys(committed.positions);
  assert.ok(names.length > 0, 'the matrix must carry positions');
  for (const name of names) {
    assert.equal(committed.positions[name].status, 'projected', `${name} must project`);
    assert.deepEqual(committed.positions[name].diagnostics, [], `${name} must project without a diagnostic`);
  }
});

// The `for` node's projected property set is the contract's other side. `step` is the only optional
// one, so its presence and absence are pinned separately.
test('F5 projects a for node with from, name and to, and step only when written', async () => {
  const committed = await matrix();
  const plain = committed.shapes['for-sum-0-3'].find((node) => node.kind === 'for');
  assert.ok(plain !== undefined, 'the plain loop must project a for node');
  const plainKeys = Object.keys(plain.properties).sort();
  assert.deepEqual(plainKeys, ['from', 'name', 'to'], 'an omitted step must not be invented');
  assert.equal(plain.properties.name, 'i', 'the counter arrives as identifier text, not as an expression');
  assert.deepEqual(plain.properties.from, { kind: 'integer', value: '0' });
  assert.deepEqual(plain.properties.to, { kind: 'integer', value: '3' });

  const stepped = committed.shapes['for-step-2'].find((node) => node.kind === 'for');
  assert.deepEqual(Object.keys(stepped.properties).sort(), ['from', 'name', 'step', 'to']);
  assert.deepEqual(stepped.properties.step, { kind: 'integer', value: '2' });

  const zero = committed.shapes['neg-step-zero-literal'].find((node) => node.kind === 'for');
  assert.deepEqual(
    zero.properties.step,
    { kind: 'integer', value: '0' },
    'the literal zero must reach the linker as a literal, or the link refusal is unreachable',
  );
});

// The body is the node's children, not a sibling. A probe that flattened the tree could not tell
// the two apart, which is why this suite carries its own nesting-preserving walk.
test('a loop body arrives as the for node children and never as a sibling statement', async () => {
  const committed = await matrix();
  const plain = committed.shapes['for-sum-0-3'];
  assert.deepEqual(
    plain.map((node) => node.kind),
    ['let', 'for', 'return'],
    'the handler must see three statements, with the body nested inside the loop',
  );
  const loop = plain.find((node) => node.kind === 'for');
  assert.deepEqual(
    loop.children.map((node) => node.kind),
    ['assign'],
    'the accumulator must be a child of the loop',
  );
  const empty = committed.shapes['neg-empty-body'].find((node) => node.kind === 'for');
  assert.equal(empty.children, undefined, 'an empty body must project as a childless for node');
});

test('a nested loop arrives as a for node whose only child is a for node', async () => {
  const committed = await matrix();
  const outer = committed.shapes['for-nested-acc'].find((node) => node.kind === 'for');
  assert.deepEqual(outer.children.map((node) => node.kind), ['for']);
  assert.deepEqual(outer.children[0].children.map((node) => node.kind), ['assign']);
  assert.equal(outer.properties.name, 'o');
  assert.equal(outer.children[0].properties.name, 'n');
});

test('an assign whose target is the counter reaches the linker, so the refusal is a link decision', async () => {
  const committed = await matrix();
  const loop = committed.shapes['neg-assign-counter'].find((node) => node.kind === 'for');
  assert.deepEqual(loop.children[0].properties.target, { kind: 'identifier', name: 'i' });
});

// The two fences. `for`'s allowedChildren is a closed list that contains neither `print` nor
// `capability`, so both fixtures die at F5 and neither loop-body event ordering nor a
// cancel-mid-loop row is buildable. If either of these flips to `projected`, the structural catalog
// widened and this slice's Out of Scope needs revisiting rather than its linker.
test('neither print nor capability is admissible as a for body child', async () => {
  const committed = await matrix();
  for (const name of ['fence-print-in-body', 'fence-capability-in-body']) {
    assert.equal(
      committed.fences[name].status,
      'rejected',
      `RT10F_SCHEMA_WIDENED: ${name} now projects, so the loop body admits more than this slice covers`,
    );
  }
});

test('the committed fence rows are what the projector actually answers today', async () => {
  for (const name of Object.keys(BODY_FENCES)) {
    assert.equal(f5Row(BODY_FENCES[name]()).status, 'rejected', `${name} must be refused by F5`);
  }
});
