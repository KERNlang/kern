import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  VOID_FALLTHROUGH,
  entryOf,
  lastStatementShape,
  moduleSource,
  projectionStatus,
  returnsProperty,
  text,
} from './k0-support.mjs';

const MATRIX_URL = new URL('./probe-matrix.json', import.meta.url);
const TEXT_INPUT = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);
const VOID_LOG = Object.freeze({ body: [text('inner')], name: 'log', returns: 'void' });

const PROJECTION_FIXTURES = Object.freeze({
  bareReturnInVoidHandler: () => entryOf([text('a'), 'return']),
  nonVoidFallthrough: () => entryOf([text('a')], { returns: 'string' }),
  voidEntryFallthrough: () => VOID_FALLTHROUGH,
  voidHelperDeclared: () => `${moduleSource([VOID_LOG])}${VOID_FALLTHROUGH}`,
  voidHelperInCallPosition: () =>
    `${moduleSource([{ ...VOID_LOG, parameters: TEXT_INPUT }])}${entryOf(['return value="log(t)"'], { parameters: TEXT_INPUT, returns: 'string' })}`,
  voidHelperStatementCall: () => `${moduleSource([VOID_LOG])}${entryOf(['log()'])}`,
  voidParameterType: () =>
    entryOf(['return value="true"'], { parameters: [{ name: 'x', type: 'void' }], returns: 'boolean' }),
  voidValueReturn: () => entryOf([text('a'), 'return value="\\"x\\""']),
});

async function recompute() {
  const projection = {};
  for (const name of Object.keys(PROJECTION_FIXTURES).sort()) {
    projection[name] = await projectionStatus(PROJECTION_FIXTURES[name]());
  }
  return {
    bareReturnStatement: await lastStatementShape(entryOf([text('a'), 'return'])),
    projection,
    voidReturnsProperty: await returnsProperty(VOID_FALLTHROUGH),
  };
}

test('the RT-6 probe matrix reproduces the committed F5 facts exactly', async () => {
  assert.deepEqual(
    await recompute(),
    JSON.parse(await readFile(MATRIX_URL, 'utf8')),
    'RT6_PROBE_DRIFT: F5 no longer projects what the RT-6 contract was built on',
  );
});

test('F5 declares returns=void and never infers it from a missing return', async () => {
  assert.deepEqual(await returnsProperty(VOID_FALLTHROUGH), {
    tag: 'record',
    value: [{ key: 'kind', value: { tag: 'text', value: 'void' } }],
  });
  const nonVoid = await returnsProperty(entryOf([text('a')], { returns: 'string' }));
  assert.equal(nonVoid.value[0].value.value, 'text', 'a declared non-void return keeps its own kind');
});

test('void is invalid as a parameter type and F5 refuses it before the linker is reached', async () => {
  assert.deepEqual(await projectionStatus(PROJECTION_FIXTURES.voidParameterType()), {
    diagnostics: ['F5_AUTHORITY_DRIFT'],
    status: 'rejected',
  });
});

test('a void handler has no statement call form, so a void callee position does not exist', async () => {
  assert.equal((await projectionStatus(PROJECTION_FIXTURES.voidHelperStatementCall())).status, 'rejected');
  assert.equal(
    (await projectionStatus(PROJECTION_FIXTURES.voidHelperInCallPosition())).status,
    'projected',
    'the expression-position call projects, so rejecting it is a link decision',
  );
});
