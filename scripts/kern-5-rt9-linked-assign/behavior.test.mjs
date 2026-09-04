import assert from 'node:assert/strict';
import test from 'node:test';

import { POSITIONS, envelopeBytes, flagArgs, runtimeRequest, textArgs, threeLegBytes } from './k0-support.mjs';

async function envelope(name, args, requestId) {
  const { legs } = await threeLegBytes(POSITIONS[name](), runtimeRequest(requestId, args));
  return legs.direct.envelope;
}

function textResult(value) {
  return { presence: 'value', value: { tag: 'text', value } };
}

function boolResult(value) {
  return { presence: 'value', value: { tag: 'boolean', value } };
}

test('a reassigned let carries the assigned value, not the declared one', async () => {
  const result = await envelope('simple-reassign', {}, 'rt9-simple');
  assert.equal(result.outcome, 'success');
  assert.deepEqual(result.result, textResult('b'));
  assert.deepEqual([...result.events], []);
});

test('an assign inside a taken then-branch writes through to the enclosing binding', async () => {
  const taken = await envelope('branch-then', flagArgs(true), 'rt9-then-true');
  assert.deepEqual(taken.result, textResult('b'));
});

test('an assign inside a skipped then-branch leaves the binding untouched', async () => {
  const skipped = await envelope('branch-then', flagArgs(false), 'rt9-then-false');
  assert.deepEqual(skipped.result, textResult('a'));
});

test('each arm of an if/else writes its own value through to the enclosing binding', async () => {
  assert.deepEqual((await envelope('branch-else', flagArgs(true), 'rt9-else-true')).result, textResult('b'));
  assert.deepEqual((await envelope('branch-else', flagArgs(false), 'rt9-else-false')).result, textResult('c'));
});

test('a return that follows an assign in the same branch observes the assigned value', async () => {
  assert.deepEqual((await envelope('branch-return', flagArgs(true), 'rt9-ret-true')).result, textResult('b'));
  assert.deepEqual((await envelope('branch-return', flagArgs(false), 'rt9-ret-false')).result, textResult('a'));
});

test('an assign takes effect at its own position, so a later print sees it and a later assign overrides it', async () => {
  const result = await envelope('ordering-print', {}, 'rt9-ordering');
  assert.deepEqual([...result.events], [{ op: 'stdout', text: 'b' }]);
  assert.deepEqual(result.result, textResult('c'));
});

test('the last of two assigns wins', async () => {
  assert.deepEqual((await envelope('two-assigns', {}, 'rt9-two')).result, textResult('c'));
});

test('a binary expression is a legal assign value on every leg', async () => {
  const result = await envelope('binary-value', {}, 'rt9-binary');
  assert.deepEqual(result.result, { presence: 'value', value: { tag: 'boolean', value: true } });
});

test('an identifier is a legal assign value and carries the other binding integer', async () => {
  const result = await envelope('integer-from-identifier', {}, 'rt9-integer');
  assert.deepEqual(result.result, { presence: 'value', value: { tag: 'integer', value: '2' } });
});

test('a list literal is a legal assign value and replaces the whole list', async () => {
  const result = await envelope('list-assign', flagArgs(true), 'rt9-list');
  assert.deepEqual(result.result, {
    presence: 'value',
    value: { tag: 'list', value: [{ tag: 'boolean', value: true }] },
  });
});

test('an async helper call is a legal assign value and suspends exactly as a let does', async () => {
  const result = await envelope('async-value', textArgs('q'), 'rt9-async');
  assert.deepEqual(result.result, textResult('reply-value'));
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].op, 'capability');
});

test('a void handler may contain an assign and still completes by falling through', async () => {
  const result = await envelope('void-with-assign', {}, 'rt9-void');
  assert.deepEqual(result.completion, { kind: 'return' });
  assert.deepEqual(result.result, { presence: 'absent' });
  assert.deepEqual([...result.events], [{ op: 'stdout', text: 'b' }]);
});

test('assigning one capability result into another capability binding is admitted on every leg', async () => {
  const { legs } = await threeLegBytes(
    POSITIONS['capability-to-capability'](),
    runtimeRequest('rt9-cap', {}),
  );
  const direct = legs.direct.envelope;
  assert.deepEqual(direct.result, textResult('reply-value'));
  assert.deepEqual(
    direct.events.map(({ op }) => op),
    ['capability', 'capability'],
  );
  assert.deepEqual(Buffer.from(envelopeBytes(legs.python.envelope)), Buffer.from(envelopeBytes(direct)));
});

test('a trailing comment on an assign line is dropped by F5 and changes nothing downstream', async () => {
  const commented = await envelope('trailing-comment', {}, 'rt9-comment');
  const plain = await envelope('simple-reassign', {}, 'rt9-comment-control');
  assert.deepEqual(
    Buffer.from(envelopeBytes({ ...commented, requestId: 'x' })),
    Buffer.from(envelopeBytes({ ...plain, requestId: 'x' })),
  );
});

test('the list assign is not silently a no-op: the declaration has two elements and the result has one', async () => {
  const result = await envelope('list-assign', flagArgs(false), 'rt9-list-len');
  assert.equal(result.result.value.value.length, 1, 'a two-element declaration must be replaced by one');
});

test('an assign whose value reads its own target sees the pre-assign value under &&', async () => {
  const result = await envelope('self-referential-and', {}, 'rt9-self-and');
  assert.deepEqual(result.result, boolResult(false), 'true && false is false: the target was read before it was written');
  assert.deepEqual([...result.events], []);
});

test('an assign whose value reads its own target sees the pre-assign value under ||', async () => {
  assert.deepEqual((await envelope('self-referential-or', flagArgs(true), 'rt9-self-or-true')).result, boolResult(true));
  assert.deepEqual((await envelope('self-referential-or', flagArgs(false), 'rt9-self-or-false')).result, boolResult(false));
});

test('a target holding true still holds it while its own value is evaluated', async () => {
  const held = await envelope('self-referential-or-held', flagArgs(false), 'rt9-self-or-held');
  assert.deepEqual(held.result, boolResult(true), 'true || false is true; a target cleared to false would answer false');
  assert.deepEqual((await envelope('self-referential-or-held', flagArgs(true), 'rt9-self-or-held-true')).result, boolResult(true));
});

test('a call-typed binding accepts another call of the same helper', async () => {
  const result = await envelope('call-typed-positive', {}, 'rt9-call-typed');
  assert.deepEqual(result.result, boolResult(true));
  assert.deepEqual([...result.events], []);
});

test('a call-typed binding accepts a literal of the type the call signature recorded', async () => {
  assert.deepEqual((await envelope('call-typed-literal', {}, 'rt9-call-typed-lit')).result, boolResult(false));
});

test('a call-typed list binding accepts a list literal of the same element type', async () => {
  const result = await envelope('call-typed-list', flagArgs(false), 'rt9-call-typed-list');
  assert.deepEqual(result.result, {
    presence: 'value',
    value: { tag: 'list', value: [{ tag: 'boolean', value: false }] },
  });
});

test('an assign after an async suspension writes the resumed frame, and a later branch assign overrides it', async () => {
  const { legs } = await threeLegBytes(
    POSITIONS['after-async-suspension'](),
    runtimeRequest('rt9-after-async-true', { ...textArgs('q'), ...flagArgs(true) }),
  );
  const taken = legs.direct.envelope;
  assert.deepEqual(taken.result, textResult('c'));
  assert.equal(taken.events.length, 1);
  assert.equal(taken.events[0].op, 'capability', 'the capability dispatch is ordered before both assigns');
  const skipped = await envelope(
    'after-async-suspension',
    { ...textArgs('q'), ...flagArgs(false) },
    'rt9-after-async-false',
  );
  assert.deepEqual(skipped.result, textResult('reply-value'), 'the fetched text survives the assign that copied it');
  assert.equal(skipped.events[0].op, 'capability');
});

test('an assign inside a helper body rebinds the helper local and the caller observes the result', async () => {
  const result = await envelope('helper-body-assign', {}, 'rt9-helper-body');
  assert.deepEqual(result.result, textResult('q'));
  assert.deepEqual([...result.events], []);
});
