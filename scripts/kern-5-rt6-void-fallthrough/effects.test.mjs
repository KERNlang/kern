import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENTRY,
  LIMITS,
  VOID_FALLTHROUGH,
  emittedArtifacts,
  entryOf,
  executeKernKir,
  project,
  runtimeRequest,
  text,
  threeLegBytes,
} from './k0-support.mjs';

const ABSENT = Object.freeze({ presence: 'absent' });
const LEGS = Object.freeze(['direct', 'javascript', 'python']);

const CAPABILITY_VOID = entryOf([
  text('before'),
  'capability namespace=fixture operation=resolve name=reply',
  'print value="reply"',
]);

const CAPABILITY_ONLY_VOID = entryOf(['capability namespace=fixture operation=resolve name=reply']);

test('a void handler completes after an awaited capability, byte-identically on all three legs', async () => {
  const { legs } = await threeLegBytes(CAPABILITY_VOID, runtimeRequest('rt6-cap-void', {}));
  for (const leg of LEGS) {
    const { envelope } = legs[leg];
    assert.equal(envelope.outcome, 'success', `${leg}: ${JSON.stringify(envelope.diagnostics)}`);
    assert.deepEqual(envelope.result, ABSENT, `${leg} must still complete with the absent result`);
    assert.deepEqual(
      envelope.events.map((event) => event.op),
      ['stdout', 'capability', 'stdout'],
      `${leg} must keep the effect order across the await`,
    );
    assert.equal(envelope.events[2].text, 'reply-value', `${leg} must observe the resolved capability value`);
    assert.equal(legs[leg].calls.length, 1, `${leg} must invoke the provider exactly once`);
  }
});

test('a void handler whose only statement is a capability still completes with the absent result', async () => {
  const { legs } = await threeLegBytes(CAPABILITY_ONLY_VOID, runtimeRequest('rt6-cap-only', {}));
  assert.deepEqual(legs.direct.envelope.result, ABSENT);
  assert.deepEqual(
    legs.direct.envelope.events.map((event) => event.op),
    ['capability'],
  );
});

test('a void handler with a capability still requires a provider, and both targets bake that in', async () => {
  const verified = await project(CAPABILITY_VOID);
  assert.ok(verified !== undefined);
  const direct = await executeKernKir(verified, runtimeRequest('rt6-cap-missing', {}), {});
  assert.equal(direct.outcome, 'failure');
  assert.equal(direct.diagnostics[0].code, 'capability-error');
  assert.deepEqual([...direct.events], [], 'RT-1 commits no effect when the provider is absent');
  const { javascript, python } = await emittedArtifacts(CAPABILITY_VOID);
  assert.ok(
    javascript.includes('if(true&&__options.invoke===undefined)'),
    'the emitted JavaScript must bake the capability requirement in as a compile-time constant',
  );
  assert.ok(
    python.includes('if True and "invoke" not in _options:'),
    'the emitted Python must bake the same constant, so a void handler cannot lose it',
  );
  const free = await emittedArtifacts(VOID_FALLTHROUGH);
  assert.ok(
    free.javascript.includes('if(false&&__options.invoke===undefined)'),
    'and a capability-free void handler must bake in the opposite constant',
  );
});

test('an abort delivered before the provider resolves fails the void run closed on all three legs', async () => {
  const { legs } = await threeLegBytes(CAPABILITY_VOID, {
    ...runtimeRequest('rt6-cap-precancel', {}),
    control: { preCancelled: true, timeoutMs: null },
  });
  for (const leg of LEGS) {
    assert.equal(legs[leg].envelope.outcome, 'failure', leg);
    assert.equal(legs[leg].envelope.diagnostics[0].code, 'execution-cancelled', leg);
    assert.deepEqual(legs[leg].envelope.events, [], `${leg} must not commit the pre-capability stdout`);
    assert.equal(legs[leg].calls.length, 0, `${leg} must not reach the provider at all`);
  }
});

test('the void event budget is consumed by capability and stdout alike on all three legs', async () => {
  const body = [
    ...Array.from({ length: LIMITS.maxEvents }, (_unused, index) => text(`e${index}`)),
    'capability namespace=fixture operation=resolve name=reply',
  ];
  const { legs } = await threeLegBytes(entryOf(body), runtimeRequest('rt6-cap-budget', {}));
  for (const leg of LEGS) {
    assert.equal(legs[leg].envelope.outcome, 'failure', leg);
    assert.equal(legs[leg].envelope.diagnostics[0].code, 'runtime-limit-exceeded', leg);
  }
});

test('the void fixtures really do reach the entry the request names', async () => {
  const { legs } = await threeLegBytes(CAPABILITY_VOID, runtimeRequest('rt6-cap-entry', {}));
  assert.equal(legs.direct.envelope.requestId, 'rt6-cap-entry');
  assert.equal(ENTRY.handlerName, 'route');
});
