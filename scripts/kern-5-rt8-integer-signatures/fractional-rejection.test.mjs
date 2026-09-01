import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FRACTIONAL_ARGUMENT, FRACTIONAL_REJECTION, INTEGER_ARGUMENT, SPELLINGS, runtimeRequest, threeLegBytes, twin,
} from './k0-support.mjs';

const LEGS = Object.freeze(['direct', 'javascript', 'python']);

function envelopeOf(bytes) {
  const { requestId, ...rest } = JSON.parse(Buffer.from(bytes).toString('utf8'));
  return rest;
}

test('a fractional argument is refused identically at an integer-spelled and a number-spelled parameter', async () => {
  const seen = [];
  for (const spelling of SPELLINGS) {
    const request = runtimeRequest('rt8-fractional', { v: FRACTIONAL_ARGUMENT });
    const { bytes, legs } = await threeLegBytes(twin(spelling, 'parameter'), request);
    assert.deepEqual(envelopeOf(bytes), FRACTIONAL_REJECTION, `${spelling} rejection shape`);
    for (const leg of LEGS) {
      assert.equal(legs[leg].envelope.outcome, 'failure', `${leg} must refuse a fractional at ${spelling}`);
      assert.deepEqual(
        legs[leg].envelope.diagnostics,
        [{ category: 'runtime', code: 'invalid-handler-arguments', phase: 'link' }],
        `${leg} diagnostic shape at ${spelling}`,
      );
    }
    seen.push(Buffer.from(bytes).toString('utf8'));
  }
  assert.equal(seen[0], seen[1], 'the integer and number spellings must refuse a fractional byte-identically');
});

test('the refusal names no expected or received type, so the alias cannot be inferred from it', async () => {
  const { bytes } = await threeLegBytes(
    twin('integer', 'parameter'),
    runtimeRequest('rt8-fractional-opaque', { v: FRACTIONAL_ARGUMENT }),
  );
  const text = Buffer.from(bytes).toString('utf8');
  for (const leak of ['expected', 'decimal', 'wrong type', '1.5', 'integer']) {
    assert.ok(!text.includes(leak), `the envelope must not surface ${leak}`);
  }
});

test('the same boundary accepts a safe integer, so the refusal is about the value not the spelling', async () => {
  for (const spelling of SPELLINGS) {
    const { legs } = await threeLegBytes(
      twin(spelling, 'parameter'),
      runtimeRequest('rt8-integral', { v: INTEGER_ARGUMENT }),
    );
    assert.equal(legs.direct.envelope.outcome, 'success', spelling);
    assert.deepEqual(legs.direct.envelope.result, { presence: 'value', value: INTEGER_ARGUMENT }, spelling);
  }
});
