import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { LINKED_KIR_BINARY_OPERATORS } from '../../packages/core/dist/kir-runtime/linked-kir-program/index.js';
import { BEHAVIOR_TABLE_RAW, POSITIONS, PRECISION_PROBE_RAW, TABLE_ROWS, admission } from './k0-support.mjs';

const GOLDEN_URL = new URL('./k0-golden.json', import.meta.url);
const CONTRACTS_URL = new URL('../../packages/core/src/kir-runtime/linked-kir-program/contracts.ts', import.meta.url);

const DEFERRED_OPERATORS = Object.freeze(['/', '%', '**', '<<', '>>', '&', '|', '^']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function declaredUnion(source, name) {
  const start = source.indexOf(`export type ${name} =`);
  if (start < 0) return [];
  const end = source.indexOf(';', start);
  assert.ok(end > start, `the ${name} declaration must be terminated`);
  return [...new Set([...source.slice(start, end).matchAll(/'([^']+)'/gu)].map((match) => match[1]))].sort();
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

function binaryOperatorContracts() {
  return Object.fromEntries(
    Object.keys(LINKED_KIR_BINARY_OPERATORS)
      .sort()
      .map((operator) => {
        const contract = LINKED_KIR_BINARY_OPERATORS[operator];
        return [
          operator,
          Object.fromEntries(
            Object.keys(contract)
              .sort()
              .map((key) => [key, contract[key]]),
          ),
        ];
      }),
  );
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
    binaryOperatorContracts: binaryOperatorContracts(),
    linkedExpressionKinds: linkedExpressionKinds(contracts),
    linkedUnaryOperators: declaredUnion(contracts, 'LinkedKernKirUnaryOperator'),
    precisionProbeSha256: sha256(PRECISION_PROBE_RAW),
  };
}

async function golden() {
  const raw = await readFile(GOLDEN_URL, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(`${JSON.stringify(parsed, null, 2)}\n`, raw, 'the RT-10-pre golden must stay canonically serialized');
  return parsed;
}

test('the RT-10-pre K0 golden pins linker admission, both operator tables and the expression union', async () => {
  assert.deepEqual(
    await recompute(),
    await golden(),
    'RT10PRE_K0_GOLDEN_DRIFT: recomputed admission, an operator contract or the expression union moved',
  );
});

test('the binary operator table carries exactly the eleven admitted operators, three of them integer-producing', async () => {
  const live = binaryOperatorContracts();
  assert.deepEqual((await golden()).binaryOperatorContracts, live, 'the golden must pin the live operator table');
  const operators = Object.keys(live).sort();
  assert.deepEqual(operators, ['!=', '&&', '*', '+', '-', '<', '<=', '==', '>', '>=', '||']);
  const arithmetic = operators.filter((operator) => live[operator].resultType === 'integer');
  assert.deepEqual(arithmetic, ['*', '+', '-']);
  for (const operator of arithmetic) {
    assert.equal(live[operator].family, 'arithmetic', `${operator} must not share the logical laziness arm`);
    assert.equal(live[operator].operandType, 'integer', operator);
  }
  for (const operator of operators.filter((name) => !arithmetic.includes(name))) {
    assert.equal(live[operator].resultType, 'boolean', operator);
  }
});

test('the unary table admits exactly negation and the expression union carries the unary variant', async () => {
  const contracts = await readFile(CONTRACTS_URL, 'utf8');
  assert.deepEqual(declaredUnion(contracts, 'LinkedKernKirUnaryOperator'), ['-']);
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

test('no deferred operator has a table row', async () => {
  const live = binaryOperatorContracts();
  const unary = declaredUnion(await readFile(CONTRACTS_URL, 'utf8'), 'LinkedKernKirUnaryOperator');
  for (const operator of DEFERRED_OPERATORS) {
    assert.equal(
      Object.hasOwn(live, operator),
      false,
      `${operator} is deferred and must stay fail-closed at link`,
    );
    assert.equal(unary.includes(operator), false, operator);
  }
  assert.equal(unary.includes('!'), false, 'unary ! stays out of profile');
  assert.equal(unary.includes('+'), false, 'unary + stays out of profile');
});

test('the frozen behavior table is sealed by digest and every row is distinct', async () => {
  const committed = await golden();
  assert.equal(
    committed.behaviorTableSha256,
    sha256(BEHAVIOR_TABLE_RAW),
    'RT10PRE_TABLE_DRIFT: an expected value moved without its digest',
  );
  assert.equal(
    committed.precisionProbeSha256,
    sha256(PRECISION_PROBE_RAW),
    'RT10PRE_TABLE_DRIFT: the non-gating precision probe moved without its digest',
  );
  assert.equal(new Set(TABLE_ROWS.map((row) => row.name)).size, TABLE_ROWS.length, 'row names must be unique');
  assert.equal(
    new Set(TABLE_ROWS.map((row) => row.expression)).size,
    TABLE_ROWS.length,
    'no two rows may pin the same expression',
  );
  for (const row of TABLE_ROWS) {
    assert.match(row.expected, /^(?:0|-?[1-9][0-9]*)$/u, `${row.name} must expect a canonical decimal integer`);
  }
});

test('every position the golden calls admitted links, and every refusal is the closed link code', async () => {
  const committed = await golden();
  const refused = Object.entries(committed.admission).filter(([, value]) => value !== 'admitted');
  for (const [name, value] of refused) {
    assert.ok(
      value === 'handler-entry-unsupported' || value === 'not-projected',
      `${name} must fail closed, not with ${value}`,
    );
  }
  assert.deepEqual(
    refused.filter(([, value]) => value === 'not-projected').map(([name]) => name).sort(),
    ['refuse-leading-zero', 'refuse-neg-zero-literal'],
  );
  assert.equal(
    Object.values(committed.admission).filter((value) => value === 'admitted').length,
    25,
    'twenty-five positions are admitted by this slice',
  );
});
