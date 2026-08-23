import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeInstructionStream, decodeResult } from './decoder.mjs';

const LIMITS = Object.freeze({
  maxCollectionLength: 8, maxDepth: 4, maxNodes: 16, maxStringCodePoints: 8,
});
const POLICY = Object.freeze({ resultFormat: 'kern.frontend.f5-projection.1', profileLimits: LIMITS });

function rejects(tape, pattern = /F5 projection decoder/u) {
  assert.throws(() => decodeInstructionStream(tape, LIMITS), pattern, tape);
}

test('A10 canonical instruction tags decode exactly at their scalar boundaries', () => {
  assert.deepEqual(decodeInstructionStream('N', LIMITS), { tag: 'null' });
  assert.deepEqual(decodeInstructionStream('T2:\ud83c\udf0da', LIMITS), { tag: 'text', value: '\ud83c\udf0da' });
  assert.deepEqual(decodeInstructionStream('I2:-1', LIMITS), { tag: 'int', value: '-1' });
  assert.deepEqual(decodeInstructionStream('D4:1.25', LIMITS), { tag: 'decimal', value: '1.25' });
  assert.deepEqual(decodeInstructionStream('B1', LIMITS), { tag: 'bool', value: true });
  assert.deepEqual(decodeInstructionStream('L2[NB0]', LIMITS).value.length, 2);
  assert.deepEqual(decodeInstructionStream('R2{K1:aNK1:bB1}', LIMITS).value.map(({ key }) => key), ['a', 'b']);
});

test('A10 deletion, duplication, count drift, suffix, tag, scalar, number, order and depth mutants die', () => {
  for (const tape of [
    '', 'NN', 'L2[N]', 'L1[NN]', 'N!', 'X', 'T2:a', 'T1:ab', 'I2:01', 'I2:-0',
    'D3:1.0x', 'D4:-0.0', 'B2', 'R2{K1:bNK1:aN}', 'R2{K1:aNK1:aN}',
    'L1[L1[L1[L1[L1[N]]]]]',
  ]) rejects(tape);
});

test('A10 exact and one-over node, collection, string, and depth limits discriminate', () => {
  assert.doesNotThrow(() => decodeInstructionStream('L2[NN]', { ...LIMITS, maxNodes: 3, maxCollectionLength: 2 }));
  assert.throws(() => decodeInstructionStream('L2[NN]', { ...LIMITS, maxNodes: 2 }), /nodes/u);
  assert.throws(() => decodeInstructionStream('L2[NN]', { ...LIMITS, maxCollectionLength: 1 }), /list limit/u);
  assert.doesNotThrow(() => decodeInstructionStream('T2:\ud83c\udf0da', { ...LIMITS, maxStringCodePoints: 2 }));
  assert.throws(() => decodeInstructionStream('T2:\ud83c\udf0da', { ...LIMITS, maxStringCodePoints: 1 }), /payload/u);
  assert.doesNotThrow(() => decodeInstructionStream('L1[L1[N]]', { ...LIMITS, maxDepth: 3 }));
  assert.throws(() => decodeInstructionStream('L1[L1[N]]', { ...LIMITS, maxDepth: 2 }), /depth/u);
});

test('A10 projected/fatal result envelopes are mutually exclusive and atomic', () => {
  const projected = ['kern.frontend.f5-projection.1', 'projected', '', 'N', '1', 'projection:closed'];
  assert.equal(decodeResult(projected, POLICY).status, 'projected');
  for (const fields of [
    [...projected, 'suffix'],
    [projected[0], 'projected', 'F5_LIMIT', 'N', '1', projected[5]],
    [projected[0], 'projected', '', '', '1', projected[5]],
    [projected[0], 'fatal', 'F5_LIMIT', 'N', '1', 'failure'],
    [projected[0], 'fatal', 'F5_UNKNOWN', '', '1', 'failure'],
    [projected[0], 'fatal', 'F5_LIMIT', '', '1', 'projection:closed'],
  ]) assert.throws(() => decodeResult(fields, POLICY), /projection decoder/u);
  assert.deepEqual(decodeResult([projected[0], 'fatal', 'F5_LIMIT', '', '2', 'failure'], POLICY), {
    status: 'fatal', code: 'F5_LIMIT', instructions: null, workSteps: 2, seal: 'failure',
  });
});
