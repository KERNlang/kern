import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { STRUCTURAL_KIR_NODE_CATALOG } from '../../packages/core/dist/kir-structural/catalog.generated.js';
import {
  WHILE_BODY_FENCES,
  WHILE_METER_POSITIONS,
  WHILE_POSITIONS,
  WHILE_SHAPE_POSITIONS,
  WHILE_TWINS,
  f5Row,
  statementTree,
} from './k0-support.mjs';

const MATRIX_URL = new URL('./probe-matrix.json', import.meta.url);

const ALL_SOURCES = Object.freeze({ ...WHILE_POSITIONS, ...WHILE_METER_POSITIONS, ...WHILE_TWINS });

const WHILE_ALLOWED_CHILDREN = Object.freeze([
  'assign',
  'branch',
  'break',
  'catch',
  'clamp',
  'coalesce',
  'comment',
  'continue',
  'destructure',
  'do',
  'each',
  'else',
  'expression-v1',
  'firstDefined',
  'firstTruthy',
  'fmt',
  'fn',
  'for',
  'if',
  'let',
  'objectMerge',
  'objectOmit',
  'objectPick',
  'return',
  'throw',
  'try',
  'while',
  'with',
]);

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
  for (const name of Object.keys(WHILE_BODY_FENCES).sort()) {
    fences[name] = f5Row(WHILE_BODY_FENCES[name]());
  }
  const positions = {};
  for (const name of Object.keys(ALL_SOURCES).sort()) {
    positions[name] = f5Row(ALL_SOURCES[name]());
  }
  const shapes = {};
  for (const name of [...WHILE_SHAPE_POSITIONS].sort()) {
    shapes[name] = statementTree(WHILE_POSITIONS[name]());
  }
  return { fences, positions, shapes, structuralSchema: { while: catalogSchema('while') } };
}

async function matrix() {
  const raw = await readFile(MATRIX_URL, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(`${JSON.stringify(parsed, null, 2)}\n`, raw, 'the probe matrix must stay canonically serialized');
  return parsed;
}

test('the RT-11 probe matrix reproduces the committed F5 facts exactly', async () => {
  assert.deepEqual(
    await recompute(),
    await matrix(),
    'RT11W_PROBE_DRIFT: F5 no longer projects what the while contract was built on',
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

// `cond` is the node's only property, which is why this slice writes no link-time property gate:
// a wrong property set never reaches the linker.
test('F5 projects a while node whose only property is cond, and cond is required', async () => {
  const committed = await matrix();
  const schema = committed.structuralSchema.while;
  assert.deepEqual(Object.keys(schema.properties), ['cond'], 'while carries exactly one property');
  assert.equal(schema.properties.cond.required, true, 'cond is required');
  assert.equal(schema.properties.cond.schemaKind, 'expression');
  assert.equal(schema.properties.cond.disposition, 'lowered-expression');
  assert.equal(schema.schemaStatus, 'bound', 'while must be a bound catalog node, not a candidate');
});

// The body vocabulary is a closed 28-member list identical to `for`'s, and `print`/`capability` are
// absent from it. That single fact decides both fences below and the whole Out of Scope section.
test('while admits exactly the twenty-eight body children for admits, and neither print nor capability', async () => {
  const committed = await matrix();
  const schema = committed.structuralSchema.while;
  assert.deepEqual(
    schema.allowedChildren,
    [...WHILE_ALLOWED_CHILDREN].sort(),
    'RT11W_SCHEMA_WIDENED: the while body vocabulary moved',
  );
  assert.equal(schema.allowedChildren.length, 28);
  assert.deepEqual(schema.allowedChildren, catalogSchema('for').allowedChildren, 'while and for share one child list');
  for (const kind of ['print', 'capability']) {
    assert.equal(schema.allowedChildren.includes(kind), false, `${kind} must stay outside the while body vocabulary`);
  }
});

// The body arrives as the node's children, never as a sibling, and an empty body projects as a
// childless node — which is what makes the `branch block is empty` refusal a link decision.
test('a while body arrives as the while node children and an empty body projects childless', async () => {
  const committed = await matrix();
  const counted = committed.shapes['while-counted-3'];
  assert.deepEqual(
    counted.map((node) => node.kind),
    ['let', 'let', 'while', 'return'],
    'the handler must see four statements, with the body nested inside the loop',
  );
  const loop = counted.find((node) => node.kind === 'while');
  assert.deepEqual(loop.children.map((node) => node.kind), ['assign', 'assign'], 'both body statements are children');
  assert.deepEqual(Object.keys(loop.properties), ['cond'], 'the projected node carries only cond');

  const nested = committed.shapes['while-nested-while'].find((node) => node.kind === 'while');
  assert.deepEqual(nested.children.map((node) => node.kind), ['let', 'while', 'assign']);

  const empty = committed.shapes['neg-while-empty-body'].find((node) => node.kind === 'while');
  assert.equal(empty.children, undefined, 'an empty body must project as a childless while node');
});

// The four F5 fences. Two are the body vocabulary, two are the property set. If any flips to
// `projected`, the linker starts seeing a shape this slice's contract does not describe.
test('print, capability, an extra property and a missing cond are all refused by F5', async () => {
  const committed = await matrix();
  for (const name of Object.keys(WHILE_BODY_FENCES)) {
    assert.equal(
      committed.fences[name].status,
      'rejected',
      `RT11W_SCHEMA_WIDENED: ${name} now projects, so the while contract needs revisiting`,
    );
    assert.equal(f5Row(WHILE_BODY_FENCES[name]()).status, 'rejected', `${name} must be refused by F5 live too`);
  }
});
