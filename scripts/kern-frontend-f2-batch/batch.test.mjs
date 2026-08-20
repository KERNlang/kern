import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { runExpression } from '../kern-frontend-f2-expression/worker.mjs';
import { runBatch } from './worker.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('empty documents produce one sealed empty batch', () => {
  const { expressions, receipt: result } = runBatch('text value="plain"\n');
  assert.deepEqual(expressions, []);
  assert.equal(result.status, 'batched');
  assert.deepEqual(result.segments, []);
  assert.deepEqual(result.absoluteSpans, []);
  assert.equal(result.diagnostic, null);
  assert.match(result.seal, /^[0-9a-f]{64}$/u);
});

test('batch binds F1 ordinals and rebases every F2 node span', () => {
  const source = 'first={{ "}}" +\r\n "😀" }}\r\nsecond={{f(a, b)}}\n';
  const { expressions, receipt: result } = runBatch(source);
  assert.equal(result.status, 'batched');
  assert.equal(result.segments.length, 2);

  for (const segment of result.segments) {
    const points = Array.from(source);
    const body = points.slice(segment.bodyStartScalar, segment.bodyEndScalar).join('');
    const direct = runExpression(body);
    assert.equal(direct.decoded.status, 'parsed');
    assert.equal(segment.f2ReceiptSha256, digest(direct.fields));
    assert.deepEqual(expressions[segment.ordinal], direct.fields);
    const spans = result.absoluteSpans.filter((row) => row.segmentOrdinal === segment.ordinal);
    assert.equal(spans.length, direct.decoded.nodes.length);
    for (const row of spans) {
      const node = direct.decoded.nodes[row.nodeId];
      assert.equal(row.startScalar, segment.bodyStartScalar + node.startScalar);
      assert.equal(row.endScalar, segment.bodyStartScalar + node.endScalar);
    }
  }
});

test('adjacent expressions remain distinct ordered segments', () => {
  const { receipt } = runBatch('value={{1}}{{2}}\n');
  assert.equal(receipt.status, 'batched');
  assert.equal(receipt.segments.length, 2);
  assert.equal(receipt.segments[0].outerEndScalar, receipt.segments[1].outerStartScalar);
  assert.ok(receipt.segments[0].lastRecordOrdinal < receipt.segments[1].firstRecordOrdinal);
});

test('nested delimiters and escaped lone CR fail through F2 with absolute spans', () => {
  for (const source of ['value={{1 + {{2}}}}\n', 'value={{"x\\\rb"}}\n']) {
    const { receipt } = runBatch(source);
    assert.equal(receipt.status, 'failure');
    assert.equal(receipt.diagnostic.code, 'BATCH_EXPRESSION_REJECTED');
    assert.equal(receipt.diagnostic.segmentOrdinal, 0);
    assert.ok(receipt.diagnostic.startScalar >= 2);
    assert.ok(receipt.diagnostic.endScalar <= Array.from(source).length);
  }
});

test('one rejected expression atomically erases successful siblings', () => {
  const source = 'first={{1 + 2}}\nsecond={{(}}\nthird={{3 + 4}}\n';
  const { expressions, receipt: result } = runBatch(source);
  assert.deepEqual(expressions, []);
  assert.equal(result.status, 'failure');
  assert.equal(result.diagnostic.code, 'BATCH_EXPRESSION_REJECTED');
  assert.equal(result.diagnostic.segmentOrdinal, 1);
  assert.deepEqual(result.segments, []);
  assert.deepEqual(result.absoluteSpans, []);
  assert.match(result.seal, /^[0-9a-f]{64}$/u);
});

test('first, middle, and last expression failures select their exact ordinal atomically', () => {
  for (const failedOrdinal of [0, 1, 2]) {
    const bodies = ['1', '2', '3'];
    bodies[failedOrdinal] = '(';
    const source = bodies.map((body, index) => `v${index}={{${body}}}`).join('\n') + '\n';
    const { expressions, receipt } = runBatch(source);
    assert.equal(receipt.status, 'failure');
    assert.equal(receipt.diagnostic.code, 'BATCH_EXPRESSION_REJECTED');
    assert.equal(receipt.diagnostic.segmentOrdinal, failedOrdinal);
    assert.deepEqual(expressions, []);
    assert.deepEqual(receipt.segments, []);
    assert.deepEqual(receipt.absoluteSpans, []);
  }
});

test('aggregate segment limits fail atomically at the first excess segment', () => {
  const { expressions, receipt: result } = runBatch('a={{1}}\nb={{2}}\n', { profileLimits: { maxSegments: 1 } });
  assert.deepEqual(expressions, []);
  assert.equal(result.status, 'failure');
  assert.equal(result.diagnostic.code, 'BATCH_LIMIT');
  assert.equal(result.diagnostic.segmentOrdinal, 1);
  assert.deepEqual(result.segments, []);
  assert.deepEqual(result.absoluteSpans, []);
});

test('an earlier malformed expression wins before a later aggregate segment limit', () => {
  const { receipt } = runBatch('a={{(}}\nb={{2}}\n', { profileLimits: { maxSegments: 1 } });
  assert.equal(receipt.status, 'failure');
  assert.equal(receipt.diagnostic.code, 'BATCH_EXPRESSION_REJECTED');
  assert.equal(receipt.diagnostic.segmentOrdinal, 0);
});

test('test-only late failure cannot expose completed batch sections', () => {
  const { expressions, receipt: result } = runBatch('a={{1}}\n', { forceLateFailure: true });
  assert.deepEqual(expressions, []);
  assert.equal(result.status, 'failure');
  assert.equal(result.diagnostic.code, 'FORCED_LATE_FAILURE');
  assert.deepEqual(result.segments, []);
  assert.deepEqual(result.absoluteSpans, []);
});
