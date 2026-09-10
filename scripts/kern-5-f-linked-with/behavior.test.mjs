import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BEHAVIOR_ROWS,
  BEHAVIOR_TABLE,
  BEHAVIOR_TABLE_FORMAT,
  POSITIONS,
  SHAPE_NAMES,
  envelopeBytes,
  fixtureArguments,
  runtimeRequest,
  withTwoLegBytes,
} from './k0-support.mjs';

function requestFor(name, args) {
  const source = POSITIONS[name]();
  return { request: runtimeRequest(`f-behavior-${name}-${args}`, fixtureArguments(source, args)), source };
}

test('the behavior table is the slice-F format and every row names a real fixture', () => {
  assert.equal(BEHAVIOR_TABLE.format, BEHAVIOR_TABLE_FORMAT);
  assert.ok(BEHAVIOR_ROWS.length >= 28, `F_BEHAVIOR_THIN: ${BEHAVIOR_ROWS.length} rows is thinner than the pinned table`);
  for (const row of BEHAVIOR_ROWS) {
    assert.equal(typeof POSITIONS[row.name], 'function', `F_BEHAVIOR_ORPHAN: ${row.name} is not a fixture`);
    if (row.outcome === 'success') {
      assert.match(row.result, /^-?[0-9]+$/u, `F_BEHAVIOR_SHAPE: ${row.name} must pin an integer result`);
    } else {
      assert.ok(Array.isArray(row.diagnostics), `F_BEHAVIOR_SHAPE: ${row.name} must pin its diagnostic codes`);
    }
  }
  const keys = BEHAVIOR_ROWS.map((row) => `${row.name}/${row.args}`);
  assert.equal(new Set(keys).size, keys.length, 'F_BEHAVIOR_DUPLICATE: a fixture/argument pair is pinned twice');
});

for (const row of BEHAVIOR_ROWS) {
  test(`${row.name} at ${row.args} behaves identically on RT-1 and the emitted JavaScript`, async () => {
    const { request, source } = requestFor(row.name, row.args);
    const { legs } = await withTwoLegBytes(source, request);
    const envelope = legs.direct.envelope;
    assert.equal(envelope.outcome, row.outcome, `F_BEHAVIOR_OUTCOME: ${row.name} must be ${row.outcome}`);
    if (row.outcome === 'success') {
      assert.deepEqual(
        envelope.result,
        { presence: 'value', value: { tag: 'integer', value: row.result } },
        `F_BEHAVIOR_RESULT: ${row.name} at ${row.args} must return ${row.result}`,
      );
    } else {
      assert.deepEqual(
        envelope.diagnostics.map((diagnostic) => diagnostic.code),
        [...row.diagnostics],
        `F_BEHAVIOR_DIAGNOSTIC: ${row.name} must fail with exactly the pinned codes`,
      );
    }
    assert.deepEqual(
      [...envelope.events],
      row.events.map((event) => ({ ...event })),
      `F_BEHAVIOR_EVENTS: ${row.name} at ${row.args} must emit exactly the pinned event sequence`,
    );
  });
}

// The behaviour half of the expansion claim: for every exit path, the surface `with` and its
// hand-written twin must produce the SAME envelope bytes, not merely the same result. The envelope
// carries its own requestId, so the pair is driven through ONE request -- a per-fixture id would
// make every comparison fail on the id alone and hide whatever the bytes really say.
for (const shape of SHAPE_NAMES) {
  test(`the ${shape} with and its expansion twin produce identical envelopes on both legs`, async () => {
    const surfaceSource = POSITIONS[`with-${shape}`]();
    const twinSource = POSITIONS[`twin-${shape}`]();
    assert.ok(surfaceSource.includes('with name='), `F_TWIN_VACUOUS: with-${shape} must actually spell a with`);
    assert.equal(twinSource.includes('with name='), false, `F_TWIN_VACUOUS: twin-${shape} must spell no with`);
    const request = runtimeRequest(`f-twin-${shape}`, fixtureArguments(surfaceSource, 'one-element'));
    const surface = await withTwoLegBytes(surfaceSource, request);
    const twin = await withTwoLegBytes(twinSource, request);
    for (const leg of ['direct', 'javascript']) {
      assert.deepEqual(
        Buffer.from(envelopeBytes(twin.legs[leg].envelope)),
        Buffer.from(envelopeBytes(surface.legs[leg].envelope)),
        `F_TWIN_DIVERGENCE: the ${shape} with and its expansion twin diverged on the ${leg} leg`,
      );
    }
  });
}

// Order is the whole content of the cleanup contract, and identical texts would hide a reversal.
// These three rows read the sequence directly rather than through a pinned table row.
test('a fallthrough runs the body before the cleanup, never after', async () => {
  const { request, source } = requestFor('with-fallthrough', 'one-element');
  const { legs } = await withTwoLegBytes(source, request);
  assert.deepEqual(
    legs.direct.envelope.events.map((event) => event.text),
    ['body', 'cleanup'],
    'F_CLEANUP_ORDER: the cleanup must run after the body, and only once',
  );
});

test('a throw runs the cleanup before the catch body it lands in', async () => {
  const { request, source } = requestFor('with-caught-throw', 'one-element');
  const { legs } = await withTwoLegBytes(source, request);
  assert.deepEqual(
    legs.direct.envelope.events.map((event) => event.text),
    ['cleanup', 'caught'],
    'F_CLEANUP_ORDER: the cleanup effects must precede the catch body effects',
  );
});

test('nested with cleanups run innermost first', async () => {
  const { request, source } = requestFor('with-nested', 'one-element');
  const { legs } = await withTwoLegBytes(source, request);
  assert.deepEqual(
    legs.direct.envelope.events.map((event) => event.text),
    ['inner', 'outer'],
    'F_CLEANUP_ORDER: the inner cleanup must run before the outer one',
  );
});

// A loop inside the body must not multiply the cleanup: an implementation that pushed the trap per
// trip would emit one cleanup per iteration.
test('a loop inside the body leaves the cleanup running exactly once, after the loop', async () => {
  for (const name of ['with-break-inner-loop', 'with-continue-inner-loop', 'for-in-with', 'while-in-with']) {
    const { request, source } = requestFor(name, 'one-element');
    const { legs } = await withTwoLegBytes(source, request);
    assert.deepEqual(
      legs.direct.envelope.events.map((event) => event.text),
      ['cleanup'],
      `F_CLEANUP_ORDER: ${name} must run its cleanup exactly once`,
    );
  }
});

// The binding carries the acquire's VALUE, not merely its name. The acquire prints it on the way in
// and the cleanup prints it again on the way out, with the body's own marker between them: an
// implementation that rebound `r`, or that evaluated the cleanup against something else, breaks the
// bracket without touching the middle event.
test('the binding is readable with the acquire value in the body and in the cleanup', async () => {
  const { request, source } = requestFor('with-value-visible', 'one-element');
  const { legs } = await withTwoLegBytes(source, request);
  const texts = legs.direct.envelope.events.map((event) => event.text);
  assert.deepEqual(
    texts,
    ['acquired', 'body', 'acquired'],
    'F_BINDING_VALUE: the acquire and the cleanup must bracket the body with the same acquired value',
  );
  assert.equal(texts.at(0), texts.at(-1), 'F_BINDING_VALUE: the cleanup must see the value the acquire produced');
});

// `protocol=""` is the same source meaning as omitting it, so the two must be indistinguishable in
// the envelope -- every byte of it, under one request id, on both legs. Comparing only the events and
// the result would let a difference in diagnostics or completion through.
test('an empty protocol is byte-identical to omitting it', async () => {
  const emptySource = POSITIONS['with-protocol-empty']();
  const omittedSource = POSITIONS['with-protocol-omitted']();
  assert.ok(emptySource.includes('protocol=""'), 'F_PROTOCOL_EMPTY: the fixture must actually spell protocol=""');
  assert.equal(omittedSource.includes('protocol='), false, 'F_PROTOCOL_EMPTY: the twin must omit the property');
  const request = runtimeRequest('f-protocol-empty', fixtureArguments(emptySource, 'one-element'));
  const empty = await withTwoLegBytes(emptySource, request);
  const omitted = await withTwoLegBytes(omittedSource, request);
  for (const leg of ['direct', 'javascript']) {
    assert.deepEqual(
      Buffer.from(envelopeBytes(empty.legs[leg].envelope)),
      Buffer.from(envelopeBytes(omitted.legs[leg].envelope)),
      `F_PROTOCOL_EMPTY: protocol="" diverged from the omitted spelling on the ${leg} leg`,
    );
  }
});

// A sibling reuse is legal precisely because the binding dies with its block. Both cleanups must
// run, in source order, and the second binding must be the second acquire.
test('a sibling with reusing the name runs both blocks and both cleanups in order', async () => {
  const { request, source } = requestFor('with-sibling-reuse', 'one-element');
  const { legs } = await withTwoLegBytes(source, request);
  assert.deepEqual(legs.direct.envelope.events.map((event) => event.text), ['cleanup', 'cleanup']);
  assert.deepEqual(legs.direct.envelope.result, { presence: 'value', value: { tag: 'integer', value: '3' } });
});
