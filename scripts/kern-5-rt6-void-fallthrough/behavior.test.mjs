import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VOID_FALLTHROUGH,
  emittedArtifacts,
  entryOf,
  linkedProgram,
  runtimeRequest,
  text,
  threeLegBytes,
} from './k0-support.mjs';

const ABSENT = Object.freeze({ presence: 'absent' });
const LEGS = Object.freeze(['direct', 'javascript', 'python']);
const BOOLEAN_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);

test('a void handler completes by falling through and agrees byte for byte on all three legs', async () => {
  const { bytes, legs } = await threeLegBytes(VOID_FALLTHROUGH, runtimeRequest('rt6-fallthrough', {}));
  assert.equal(
    Buffer.from(bytes).toString('utf8'),
    '{"completion":{"kind":"return"},"diagnostics":[],"events":[{"op":"stdout","text":"first"},{"op":"stdout","text":"second"}],"format":"kern.runtime.kir.v1","outcome":"success","requestId":"rt6-fallthrough","result":{"presence":"absent"}}',
  );
  for (const leg of LEGS) {
    const { envelope } = legs[leg];
    assert.equal(envelope.outcome, 'success', `${leg}: ${JSON.stringify(envelope.diagnostics)}`);
    assert.deepEqual(envelope.completion, { kind: 'return' }, `${leg} must complete, not error`);
    assert.deepEqual(envelope.result, ABSENT, `${leg} must reuse the existing absent-result envelope`);
    assert.deepEqual(Object.keys(envelope.result), ['presence'], `${leg} must not carry a fabricated result value`);
    assert.deepEqual(
      envelope.events.map((event) => event.text),
      ['first', 'second'],
      `${leg} must keep stdout ordered`,
    );
  }
});

test('a void handler runs its branches and falls through past them identically on all three legs', async () => {
  const source = entryOf(['if cond="flag"', `  ${text('then')}`, 'else', `  ${text('else')}`, text('after')], {
    parameters: BOOLEAN_FLAG,
  });
  for (const flag of [true, false]) {
    const { legs } = await threeLegBytes(
      source,
      runtimeRequest(`rt6-branch-${flag}`, { flag: { tag: 'boolean', value: flag } }),
    );
    assert.deepEqual(legs.direct.envelope.result, ABSENT);
    assert.deepEqual(
      legs.direct.envelope.events.map((event) => event.text),
      [flag ? 'then' : 'else', 'after'],
    );
  }
});

test('the linked program carries the void return type as metadata, not a body-shape inference', async () => {
  const linked = await linkedProgram(VOID_FALLTHROUGH);
  assert.deepEqual(linked.program.returnType, { kind: 'void' });
  assert.equal(linked.helpers, undefined, 'a call-free void program links no helper');
  assert.equal(
    linked.program.statements.filter((statement) => statement.kind === 'return').length,
    0,
    'the void completion is declared, never derived from a trailing return',
  );
});

test('neither emitted target can leak a host undefined or None as a KERN value', async () => {
  const { javascript, python } = await emittedArtifacts(VOID_FALLTHROUGH);
  assert.ok(javascript.includes(`Object.freeze({presence:'absent'})`), 'the JS void tail must build the absent slot');
  assert.ok(python.includes('{"presence": "absent"}'), 'the Python void tail must build the absent slot');
  assert.ok(!/result:\s*undefined/u.test(javascript), 'no emitted JS path may put undefined in the result slot');
  assert.ok(!/"result":\s*None/u.test(python), 'no emitted Python path may put None in the result slot');
  const { legs } = await threeLegBytes(VOID_FALLTHROUGH, runtimeRequest('rt6-no-leak', {}));
  for (const leg of LEGS) {
    assert.ok(
      !JSON.stringify(legs[leg].envelope.result).includes('null'),
      `${leg} must not encode a fabricated null result`,
    );
  }
});

test('a void entry that never returns still refuses a pre-cancelled request identically', async () => {
  const { legs } = await threeLegBytes(VOID_FALLTHROUGH, {
    ...runtimeRequest('rt6-cancelled', {}),
    control: { preCancelled: true, timeoutMs: null },
  });
  for (const leg of LEGS) {
    assert.equal(legs[leg].envelope.outcome, 'failure', leg);
    assert.equal(legs[leg].envelope.diagnostics[0].code, 'execution-cancelled', leg);
    assert.deepEqual(legs[leg].envelope.events, [], `${leg} commits no stdout event`);
  }
});
