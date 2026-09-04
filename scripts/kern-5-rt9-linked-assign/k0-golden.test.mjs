import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { STRUCTURAL_KIR_NODE_CATALOG } from '../../packages/core/dist/kir-structural/catalog.generated.js';
import { CONTROL_POSITIONS, POSITIONS, admission } from './k0-support.mjs';

const GOLDEN_URL = new URL('./k0-golden.json', import.meta.url);
const CONTRACTS_URL = new URL('../../packages/core/src/kir-runtime/linked-kir-program/contracts.ts', import.meta.url);

const ADMITTED = Object.freeze([
  'after-async-suspension',
  'async-value',
  'binary-value',
  'branch-else',
  'branch-return',
  'branch-then',
  'call-typed-list',
  'call-typed-literal',
  'call-typed-positive',
  'capability-to-capability',
  'control-for',
  'helper-body-assign',
  'integer-from-identifier',
  'list-assign',
  'ordering-print',
  'self-referential-and',
  'self-referential-or',
  'self-referential-or-held',
  'simple-reassign',
  'trailing-comment',
  'two-assigns',
  'void-with-assign',
]);

function linkedStatementKinds(source) {
  const start = source.indexOf('export type LinkedKernKirStatement =');
  assert.ok(start >= 0, 'contracts.ts must declare LinkedKernKirStatement');
  const end = source.indexOf('\nexport ', start + 1);
  assert.ok(end > start, 'the LinkedKernKirStatement union must be followed by another export');
  const kinds = [...source.slice(start, end).matchAll(/readonly kind: '([a-z-]+)'/gu)].map((match) => match[1]);
  assert.ok(kinds.length > 0, 'the LinkedKernKirStatement union must carry discriminant literals');
  return [...new Set(kinds)].sort();
}

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

async function admissionRow(name, source) {
  const row = await admission(source);
  if (row.projection === 'not-projected') return 'not-projected';
  assert.equal(row.javascript, row.python, `both targets share one linker; ${name} diverged`);
  assert.equal(row.rt1, row.javascript, `RT-1 and the emitters share one linker; ${name} diverged`);
  return row.rt1;
}

async function recompute() {
  const admissionMap = {};
  const sources = { ...POSITIONS, ...CONTROL_POSITIONS };
  for (const name of Object.keys(sources).sort()) {
    admissionMap[name] = await admissionRow(name, sources[name]());
  }
  return {
    admission: admissionMap,
    linkedStatementKinds: linkedStatementKinds(await readFile(CONTRACTS_URL, 'utf8')),
    structuralSchema: { assign: catalogSchema('assign') },
  };
}

test('the RT-9 K0 golden pins linker admission, the statement union and the assign schema', async () => {
  assert.deepEqual(
    await recompute(),
    JSON.parse(await readFile(GOLDEN_URL, 'utf8')),
    'RT9_K0_GOLDEN_DRIFT: recomputed assign admission, the statement union or the assign schema moved',
  );
});

test('assign and for are linked statement kinds, and the other loop kinds still are not', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  assert.deepEqual(golden.linkedStatementKinds, ['assign', 'capability', 'for', 'if', 'let', 'print', 'return']);
  for (const kind of ['each', 'set', 'while']) {
    assert.ok(!golden.linkedStatementKinds.includes(kind), `${kind} must stay outside RT-1 in this slice`);
  }
});

test('every admitted assign position links on all three legs', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  const admitted = Object.entries(golden.admission)
    .filter(([, value]) => value === 'admitted')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(admitted, [...ADMITTED].sort());
});

test('control-for moved to admitted, the other loop control rows did not move and set is still an excluded host', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  assert.equal(golden.admission['control-for'], 'admitted');
  assert.equal(golden.admission['control-while'], 'handler-entry-unsupported');
  assert.equal(golden.admission['control-each'], 'handler-entry-unsupported');
  assert.equal(golden.admission['control-set'], 'not-projected');
});

test('the assign schema carries a lowered-expression target and an optional op', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  const schema = golden.structuralSchema.assign;
  assert.equal(schema.properties.target.disposition, 'lowered-expression');
  assert.equal(schema.properties.target.required, true);
  assert.equal(schema.properties.value.disposition, 'lowered-expression');
  assert.equal(schema.properties.value.required, true);
  assert.equal(schema.properties.op.required, false);
  assert.equal(schema.allowedChildren, null);
});
