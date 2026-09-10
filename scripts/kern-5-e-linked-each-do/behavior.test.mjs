import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BEHAVIOR_ROWS,
  POSITIONS,
  eachTwoLegBytes,
  fixtureArguments,
  runtimeRequest,
} from './k0-support.mjs';

function requestFor(name, args) {
  const source = POSITIONS[name]();
  return { request: runtimeRequest(`e-behavior-${name}-${args}`, fixtureArguments(source, args)), source };
}

test('the behavior table is the slice-E format and every row names a real fixture', () => {
  assert.ok(BEHAVIOR_ROWS.length >= 26, `E_BEHAVIOR_THIN: ${BEHAVIOR_ROWS.length} rows is thinner than the pinned table`);
  for (const row of BEHAVIOR_ROWS) {
    assert.equal(typeof POSITIONS[row.name], 'function', `E_BEHAVIOR_ORPHAN: ${row.name} is not a fixture`);
    assert.match(row.result, /^-?[0-9]+$/u, `E_BEHAVIOR_SHAPE: ${row.name} must pin an integer result`);
  }
  const keys = BEHAVIOR_ROWS.map((row) => `${row.name}/${row.args}`);
  assert.equal(new Set(keys).size, keys.length, 'E_BEHAVIOR_DUPLICATE: a fixture/argument pair is pinned twice');
});

for (const row of BEHAVIOR_ROWS) {
  test(`${row.name} at ${row.args} returns ${row.result} identically on RT-1 and the emitted JavaScript`, async () => {
    const { request, source } = requestFor(row.name, row.args);
    const { legs } = await eachTwoLegBytes(source, request);
    assert.equal(legs.direct.envelope.outcome, 'success', `E_BEHAVIOR_OUTCOME: ${row.name} must succeed`);
    assert.deepEqual(
      legs.direct.envelope.result,
      { presence: 'value', value: { tag: 'integer', value: row.result } },
      `E_BEHAVIOR_RESULT: ${row.name} at ${row.args} must return ${row.result}`,
    );
    assert.deepEqual(
      [...legs.direct.envelope.events],
      row.events.map((event) => ({ ...event })),
      `E_BEHAVIOR_EVENTS: ${row.name} at ${row.args} must emit exactly the pinned event sequence`,
    );
  });
}

// The one row that would pass under a for-of lowering AND under a cursor lowering must not be the
// only iteration evidence: an implementation that iterated the list backwards, or that rebound the
// item after the body, still has to reproduce these three lengths and this event ORDER.
test('a plain each is length-driven: zero, one and three elements give zero, one and three trips', async () => {
  for (const [args, expected] of [['empty-list', '0'], ['one-element', '1'], ['three-elements', '3']]) {
    const { request, source } = requestFor('each-plain', args);
    const { legs } = await eachTwoLegBytes(source, request);
    assert.deepEqual(legs.direct.envelope.result, { presence: 'value', value: { tag: 'integer', value: expected } });
  }
});

test('an each body prints one event per trip, in list order, on both legs', async () => {
  const { request, source } = requestFor('each-print-body', 'three-elements');
  const { legs } = await eachTwoLegBytes(source, request);
  assert.deepEqual(
    legs.direct.envelope.events.map((event) => event.text),
    ['e0', 'e1', 'e2'],
    'E_EACH_ORDER: the trips must run in list order, not reversed and not deduplicated',
  );
});

// An index binding must be an INTEGER, not a decimal: a `for` bound only accepts integer, so this
// row is the type check disguised as a behaviour row.
test('the index binding is an integer, provable through a for bound that only accepts integer', async () => {
  const { request, source } = requestFor('each-index-as-for-bound', 'three-elements');
  const { legs } = await eachTwoLegBytes(source, request);
  assert.deepEqual(legs.direct.envelope.result, { presence: 'value', value: { tag: 'integer', value: '3' } });
});
