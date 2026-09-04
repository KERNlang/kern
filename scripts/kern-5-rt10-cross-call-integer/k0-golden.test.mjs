import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  LINKED_KIR_BINARY_OPERATORS,
  LINKED_KIR_CROSS_CALL_TYPES,
  LINKED_KIR_CROSS_CALL_TYPE_NAMES,
  LINKED_KIR_UNARY_OPERATORS,
  linkedKirCrossCallType,
} from '../../packages/core/dist/kir-runtime/linked-kir-program/index.js';
import { BEHAVIOR_TABLE_RAW, POSITIONS, TABLE_ROWS, admission } from './k0-support.mjs';

const GOLDEN_URL = new URL('./k0-golden.json', import.meta.url);
const CONTRACTS_URL = new URL('../../packages/core/src/kir-runtime/linked-kir-program/contracts.ts', import.meta.url);
const EXPRESSION_URL = new URL('../../packages/core/src/kir-runtime/linked-kir-program/expression.ts', import.meta.url);

const DEFERRED_CROSS_CALL_TYPES = Object.freeze(['list<integer>', 'decimal', 'json', 'record', 'void']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function linkedExpressionKinds(source) {
  const start = source.indexOf('export type LinkedKernKirExpression =');
  assert.ok(start >= 0, 'contracts.ts must declare LinkedKernKirExpression');
  const end = source.indexOf('\nexport ', start + 1);
  assert.ok(end > start, 'the LinkedKernKirExpression union must be followed by another export');
  const kinds = [...source.slice(start, end).matchAll(/readonly kind: '([a-z-]+)'/gu)].map((match) => match[1]);
  assert.ok(kinds.length > 0, 'the LinkedKernKirExpression union must carry discriminant literals');
  return [...new Set(kinds)].sort();
}

function crossCallTypeContracts() {
  return Object.fromEntries(
    [...LINKED_KIR_CROSS_CALL_TYPE_NAMES].map((name) => [
      name,
      { element: LINKED_KIR_CROSS_CALL_TYPES[name].element ?? null, kind: LINKED_KIR_CROSS_CALL_TYPES[name].kind },
    ]),
  );
}

function resolverBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expression.ts must declare ${name}`);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `${name} must be terminated`);
  return source.slice(start, end);
}

async function admissionRow(name, source) {
  const row = await admission(source);
  if (row.projection === 'not-projected') return 'not-projected';
  assert.equal(row.javascript, row.python, `both targets share one linker; ${name} diverged`);
  assert.equal(row.rt1, row.javascript, `RT-1 and the emitters share one linker; ${name} diverged`);
  return row.rt1;
}

async function recompute() {
  const contracts = await readFile(CONTRACTS_URL, 'utf8');
  const admissionMap = {};
  for (const name of Object.keys(POSITIONS).sort()) {
    admissionMap[name] = await admissionRow(name, POSITIONS[name]());
  }
  return {
    admission: admissionMap,
    behaviorTableSha256: sha256(BEHAVIOR_TABLE_RAW),
    crossCallTypeContracts: crossCallTypeContracts(),
    crossCallTypeNames: [...LINKED_KIR_CROSS_CALL_TYPE_NAMES],
    linkedExpressionKinds: linkedExpressionKinds(contracts),
  };
}

async function golden() {
  const raw = await readFile(GOLDEN_URL, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(`${JSON.stringify(parsed, null, 2)}\n`, raw, 'the RT-10-X golden must stay canonically serialized');
  return parsed;
}

test('the RT-10-X K0 golden pins linker admission, the cross-call table and the expression union', async () => {
  assert.deepEqual(
    await recompute(),
    await golden(),
    'RT10X_K0_GOLDEN_DRIFT: recomputed admission, the cross-call contract or the expression union moved',
  );
});

test('the cross-call table carries exactly five rows, one of them the scalar integer row', async () => {
  const live = crossCallTypeContracts();
  assert.deepEqual((await golden()).crossCallTypeContracts, live, 'the golden must pin the live cross-call table');
  assert.deepEqual(Object.keys(live).sort(), ['boolean', 'integer', 'list<boolean>', 'list<text>', 'text']);
  assert.deepEqual(live.integer, { element: null, kind: 'integer' });
  assert.deepEqual(live.boolean, { element: null, kind: 'boolean' });
  assert.deepEqual(live['list<text>'], { element: 'text', kind: 'list' });
  const scalars = Object.keys(live).filter((name) => live[name].element === null);
  assert.deepEqual(scalars.sort(), ['boolean', 'integer', 'text'], 'exactly three scalar rows cross a call boundary');
  const elements = [...new Set(Object.values(live).map((row) => row.element).filter((element) => element !== null))];
  assert.deepEqual(elements.sort(), ['boolean', 'text'], 'no list element beyond boolean and text is admitted');
});

test('no deferred cross-call type has a table row, and the names list is the sorted table', async () => {
  const live = crossCallTypeContracts();
  for (const name of DEFERRED_CROSS_CALL_TYPES) {
    assert.equal(Object.hasOwn(live, name), false, `${name} is deferred and must stay fail-closed at link`);
  }
  assert.deepEqual(
    [...LINKED_KIR_CROSS_CALL_TYPE_NAMES],
    Object.keys(LINKED_KIR_CROSS_CALL_TYPES).sort(),
    'the names list is the sorted table and is only ever consumed by a unique kind/element match',
  );
});

test('every row of the cross-call and operator tables is frozen, not just the table', () => {
  assert.equal(linkedKirCrossCallType({ kind: 'boolean' }), 'boolean');
  assert.throws(
    () => {
      LINKED_KIR_CROSS_CALL_TYPES.boolean.kind = 'text';
    },
    TypeError,
    'RT10X_ROW_MUTABLE: a frozen row in ESM strict mode must throw on an assignment attempt',
  );
  assert.equal(
    linkedKirCrossCallType({ kind: 'boolean' }),
    'boolean',
    'RT10X_ROW_MUTABLE: the resolver answer must be unchanged after the mutation attempt',
  );

  assert.throws(
    () => {
      LINKED_KIR_BINARY_OPERATORS['+'].resultType = 'boolean';
    },
    TypeError,
    'RT10X_ROW_MUTABLE: a binary operator row must be frozen too',
  );
  assert.equal(LINKED_KIR_BINARY_OPERATORS['+'].resultType, 'integer');

  assert.throws(
    () => {
      LINKED_KIR_UNARY_OPERATORS['-'].resultType = 'boolean';
    },
    TypeError,
    'RT10X_ROW_MUTABLE: a unary operator row must be frozen too',
  );
  assert.equal(LINKED_KIR_UNARY_OPERATORS['-'].resultType, 'integer');
});

test('this slice adds no expression variant, so the union RT-3 seals does not move', async () => {
  const contracts = await readFile(CONTRACTS_URL, 'utf8');
  assert.deepEqual(linkedExpressionKinds(contracts), [
    'binary',
    'identifier',
    'json-call',
    'list',
    'literal',
    'member',
    'record',
    'unary',
    'user-call',
  ]);
});

test('both type resolvers read one operator table and share one canonical-integer-guarded literal helper', async () => {
  const source = await readFile(EXPRESSION_URL, 'utf8');
  const staticResolver = resolverBody(source, 'staticExpressionType');
  const crossCallResolver = resolverBody(source, 'crossCallExpressionType');
  for (const [name, body] of [
    ['staticExpressionType', staticResolver],
    ['crossCallExpressionType', crossCallResolver],
  ]) {
    assert.ok(
      body.includes('LINKED_KIR_BINARY_OPERATORS[expression.op].resultType'),
      `RT10X_RESOLVER_GAP: ${name} must read the binary operator table's resultType`,
    );
    assert.ok(
      body.includes('LINKED_KIR_UNARY_OPERATORS[expression.op].resultType'),
      `RT10X_RESOLVER_GAP: ${name} must read the unary operator table's resultType`,
    );
    assert.ok(
      body.includes('literalCrossCallType('),
      `RT10X_RESOLVER_GAP: ${name} must answer a literal through the shared literal-type helper`,
    );
  }
  assert.ok(
    staticResolver.includes('returnType.kind'),
    "RT10X_RESOLVER_GAP: staticExpressionType must resolve a user call from the callee's declared return kind",
  );
  assert.ok(
    crossCallResolver.includes('linkedKirCrossCallType(callee.returnType)'),
    'RT10X_RESOLVER_GAP: crossCallExpressionType must resolve a user call through the cross-call table lookup',
  );
  assert.ok(
    !crossCallResolver.includes("element !== 'boolean'"),
    'RT10X_RESOLVER_GAP: the list arm must ask the cross-call table for its element, not a literal name list',
  );
  const literalHelper = resolverBody(source, 'literalCrossCallType');
  assert.ok(
    literalHelper.includes('CANONICAL_INTEGER.test'),
    'RT10X_RESOLVER_GAP: the shared literal helper must guard its integer answer with the canonical regex',
  );
});

test('the frozen behavior table is sealed by digest and every row is distinct', async () => {
  const committed = await golden();
  assert.equal(
    committed.behaviorTableSha256,
    sha256(BEHAVIOR_TABLE_RAW),
    'RT10X_TABLE_DRIFT: an expected value moved without its digest',
  );
  assert.equal(new Set(TABLE_ROWS.map((row) => row.name)).size, TABLE_ROWS.length, 'row names must be unique');
  for (const row of TABLE_ROWS) {
    assert.match(row.expected, /^(?:0|-?[1-9][0-9]*)$/u, `${row.name} must expect a canonical decimal integer`);
    assert.ok(POSITIONS[row.name] !== undefined, `${row.name} must name a real probed position`);
    assert.equal(
      committed.admission[row.name],
      'admitted',
      `RT10X_TABLE_DRIFT: ${row.name} carries a frozen value, so the golden must call it admitted`,
    );
  }
});
