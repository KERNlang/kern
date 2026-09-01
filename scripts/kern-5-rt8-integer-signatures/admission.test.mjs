import assert from 'node:assert/strict';
import test from 'node:test';

import { SHAPES, projectionOf, routeSource, twin } from './k0-support.mjs';

test('every integer-spelled signature position projects exactly as its number twin', () => {
  for (const shape of SHAPES) {
    assert.deepEqual(projectionOf(twin('integer', shape)), { codes: [], status: 'projected' }, shape);
    assert.deepEqual(projectionOf(twin('number', shape)), { codes: [], status: 'projected' }, `${shape} twin`);
  }
});

test('the alias admits no spelling beyond integer and integer[]', () => {
  for (const spelling of ['Integer', 'INTEGER', 'int', 'Int', 'integers', 'integer[][]']) {
    assert.deepEqual(
      projectionOf(routeSource({ parameter: spelling, returns: 'number' })),
      { codes: ['F5_AUTHORITY_DRIFT'], status: 'fatal' },
      `parameter ${spelling} must stay outside the admitted domain`,
    );
  }
});

test('a whitespace-padded spelling is refused by the lexer before F5 sees it', () => {
  assert.deepEqual(projectionOf(routeSource({ parameter: ' integer[]', returns: 'number' })), {
    codes: ['UNEXPECTED_TOKEN'],
    status: 'rejected',
  });
});

test('the alias does not widen the return-only void rule or admit void parameters', () => {
  assert.deepEqual(projectionOf(routeSource({ parameter: 'void', returns: 'number' })).status, 'fatal');
  assert.deepEqual(projectionOf(routeSource({ parameter: 'integer', returns: 'void' })).status, 'projected');
  assert.deepEqual(projectionOf(routeSource({ parameter: 'void[]', returns: 'number' })).status, 'fatal');
  assert.deepEqual(projectionOf(routeSource({ parameter: 'integer[]', returns: 'void' })).status, 'projected');
});

test('unknown scalar and list element spellings still drift', () => {
  for (const spelling of ['decimal', 'json', 'unknown', 'decimal[]', 'json[]', 'unknown[]']) {
    assert.equal(projectionOf(routeSource({ parameter: spelling, returns: 'number' })).status, 'fatal', spelling);
  }
});

test('the RT-4 integer-signature projection negative is superseded and now links on every leg', async () => {
  const { admission, moduleSource, ENTRY } = await import('../kern-5-rt4-user-fn-call/k0-support.mjs');
  const source = moduleSource([
    { body: ['return value="n"'], name: 'inc', parameters: [{ name: 'n', type: 'integer' }], returns: 'integer' },
    { body: ['return value="true"'], exported: 'true', name: ENTRY.handlerName, parameters: [], returns: 'boolean' },
  ]);
  const row = await admission(source);
  assert.equal(row.projection, 'projected', 'RT-4 pinned this as F5_AUTHORITY_DRIFT; RT-8 admits it');
  assert.equal(row.javascript, 'admitted');
  assert.equal(row.python, 'admitted');
  assert.equal(row.rt1, 'admitted');
});
