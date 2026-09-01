import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INTEGER_ARGUMENT, SHAPES, canonicalKir, emittedArtifacts, runtimeRequest, threeLegBytes, twin,
} from './k0-support.mjs';

const LIST_ARGUMENT = Object.freeze({ tag: 'list', value: [INTEGER_ARGUMENT] });

test('leg 1: an integer-spelled signature yields byte-identical canonical KIR to its number twin', () => {
  for (const shape of SHAPES) {
    const integer = canonicalKir(twin('integer', shape));
    const number = canonicalKir(twin('number', shape));
    assert.deepEqual(integer, number, `${shape} canonical KIR must be byte-identical`);
    assert.ok(integer.length > 0, `${shape} produced empty KIR`);
  }
});

test('legs 2 and 3: emitted JavaScript and Python are byte-identical across the twins', async () => {
  for (const shape of SHAPES) {
    const integer = await emittedArtifacts(twin('integer', shape));
    const number = await emittedArtifacts(twin('number', shape));
    assert.equal(integer.javascript, number.javascript, `${shape} emitted JavaScript diverged`);
    assert.equal(integer.python, number.python, `${shape} emitted Python diverged`);
  }
});

test('leg 4: the RT-1 envelope is byte-identical across the twins on all three execution legs', async () => {
  for (const shape of SHAPES) {
    const argument = shape === 'list' ? LIST_ARGUMENT : INTEGER_ARGUMENT;
    const request = runtimeRequest('rt8-alias', { v: argument });
    const integer = await threeLegBytes(twin('integer', shape), request);
    const number = await threeLegBytes(twin('number', shape), request);
    assert.deepEqual(Buffer.from(integer.bytes), Buffer.from(number.bytes), `${shape} envelope diverged`);
    assert.equal(integer.legs.direct.envelope.outcome, 'success', shape);
  }
});

test('the alias is a spelling, not a distinct KIR kind: both twins lower to kind integer', () => {
  const bytes = canonicalKir(twin('integer', 'both')).toString('utf8');
  assert.match(bytes, /integer/u);
  assert.ok(!bytes.includes('"number"'), 'no number kind may survive into canonical KIR');
});
