import assert from 'node:assert/strict';
import test from 'node:test';

import { flattenJson, kernStringLiteral } from './flatten.mjs';

test('flattenJson: scalar root produces a single row', () => {
  assert.deepEqual(flattenJson(42), [{ parentIdx: -1, keyStr: '', keyIdx: -1, type: 'num', value: '42' }]);
  assert.deepEqual(flattenJson('hi'), [{ parentIdx: -1, keyStr: '', keyIdx: -1, type: 'str', value: '"hi"' }]);
  assert.deepEqual(flattenJson(true), [{ parentIdx: -1, keyStr: '', keyIdx: -1, type: 'bool', value: 'true' }]);
  assert.deepEqual(flattenJson(null), [{ parentIdx: -1, keyStr: '', keyIdx: -1, type: 'null', value: 'null' }]);
});

test('flattenJson: empty containers get childCount "0"', () => {
  assert.deepEqual(flattenJson([]), [{ parentIdx: -1, keyStr: '', keyIdx: -1, type: 'list', value: '0' }]);
  assert.deepEqual(flattenJson({}), [{ parentIdx: -1, keyStr: '', keyIdx: -1, type: 'map', value: '0' }]);
});

// Golden fixture: {a: 1, b: [true, null]} — 5 rows, document order, root first.
test('flattenJson: golden fixture {a:1,b:[true,null]}', () => {
  const rows = flattenJson({ a: 1, b: [true, null] });
  assert.deepEqual(rows, [
    { parentIdx: -1, keyStr: '', keyIdx: -1, type: 'map', value: '2' },
    { parentIdx: 0, keyStr: 'a', keyIdx: -1, type: 'num', value: '1' },
    { parentIdx: 0, keyStr: 'b', keyIdx: -1, type: 'list', value: '2' },
    { parentIdx: 2, keyStr: '', keyIdx: 0, type: 'bool', value: 'true' },
    { parentIdx: 2, keyStr: '', keyIdx: 1, type: 'null', value: 'null' },
  ]);
});

// Golden fixture: deep 4-level nesting, one path per level (mirrors the
// spec's "deep descent" discriminating fixture shape).
test('flattenJson: golden fixture deep nesting {a:{b:{c:{d:1}}}}', () => {
  const rows = flattenJson({ a: { b: { c: { d: 1 } } } });
  assert.deepEqual(rows, [
    { parentIdx: -1, keyStr: '', keyIdx: -1, type: 'map', value: '1' },
    { parentIdx: 0, keyStr: 'a', keyIdx: -1, type: 'map', value: '1' },
    { parentIdx: 1, keyStr: 'b', keyIdx: -1, type: 'map', value: '1' },
    { parentIdx: 2, keyStr: 'c', keyIdx: -1, type: 'map', value: '1' },
    { parentIdx: 3, keyStr: 'd', keyIdx: -1, type: 'num', value: '1' },
  ]);
});

// Golden fixture: hostile keys are VERBATIM data, never escaped/parsed.
test('flattenJson: golden fixture hostile keys {"a.b":1,"":2,"[0]":"x"}', () => {
  const rows = flattenJson({ 'a.b': 1, '': 2, '[0]': 'x' });
  assert.deepEqual(rows, [
    { parentIdx: -1, keyStr: '', keyIdx: -1, type: 'map', value: '3' },
    { parentIdx: 0, keyStr: 'a.b', keyIdx: -1, type: 'num', value: '1' },
    { parentIdx: 0, keyStr: '', keyIdx: -1, type: 'num', value: '2' },
    { parentIdx: 0, keyStr: '[0]', keyIdx: -1, type: 'str', value: '"x"' },
  ]);
});

// Golden fixture: NaN is not valid JSON, but the flattener must still be
// exercised on the exact numeric encodings the fixture corpus relies on for
// NaN-isolation (JSON.stringify(NaN) === 'null' — the corpus therefore
// encodes NaN-standing-in fixtures as sentinel strings, not raw JS NaN; this
// test documents/locks that JSON.stringify(number) boundary so a future
// fixture author does not accidentally rely on JS NaN surviving the
// flattener, which it cannot: `type=num` always carries a JSON.stringify'd
// finite number).
test('flattenJson: throws on a JS value with no JSON representation', () => {
  assert.throws(() => flattenJson(undefined), /unsupported JSON value/);
  assert.throws(() => flattenJson(() => {}), /unsupported JSON value/);
});

// NaN is not valid JSON, but the shared fixture corpus is JS data (never
// round-tripped through JSON.parse), so a fixture CAN carry a raw JS NaN.
// The flattener's "fixed dumb rule" (JSON.stringify per scalar) happens to
// canonicalize NaN to the 3-char string "null" — matching the TS assertion
// core's own JSON.stringify(sortValue(v)) canonicalization exactly, so two
// NaNs compare EQUAL under this encoding without any NaN special-case in the
// .kern engine (both rows land on type="num", value="null"). This is the
// load-bearing property behind the "NaN isolation" discriminating fixture:
// [NaN,1] vs [NaN,2] must match at index 0 and differ only at index 1.
test('flattenJson: NaN canonicalizes to type=num value="null" (matches JSON.stringify(NaN))', () => {
  assert.equal(JSON.stringify(Number.NaN), 'null');
  const rows = flattenJson([Number.NaN, 1]);
  assert.deepEqual(rows, [
    { parentIdx: -1, keyStr: '', keyIdx: -1, type: 'list', value: '2' },
    { parentIdx: 0, keyStr: '', keyIdx: 0, type: 'num', value: 'null' },
    { parentIdx: 0, keyStr: '', keyIdx: 1, type: 'num', value: '1' },
  ]);
});

test('flattenJson: array-of-arrays preserves order-sensitive keyIdx per level', () => {
  const rows = flattenJson([
    [1, 2],
    [3],
  ]);
  assert.deepEqual(rows, [
    { parentIdx: -1, keyStr: '', keyIdx: -1, type: 'list', value: '2' },
    { parentIdx: 0, keyStr: '', keyIdx: 0, type: 'list', value: '2' },
    { parentIdx: 1, keyStr: '', keyIdx: 0, type: 'num', value: '1' },
    { parentIdx: 1, keyStr: '', keyIdx: 1, type: 'num', value: '2' },
    { parentIdx: 0, keyStr: '', keyIdx: 1, type: 'list', value: '1' },
    { parentIdx: 4, keyStr: '', keyIdx: 0, type: 'num', value: '3' },
  ]);
});

test('kernStringLiteral: escapes for double-nested attribute embedding', () => {
  assert.equal(kernStringLiteral('hi'), '\\"hi\\"');
  assert.equal(kernStringLiteral('a"b'), '\\"a\\\\\\"b\\"');
  assert.equal(kernStringLiteral(''), '\\"\\"');
  assert.equal(kernStringLiteral('a\\b'), '\\"a\\\\\\\\b\\"');
});
