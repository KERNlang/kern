import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASYNC_TEXT_HELPER,
  RELAY_HELPER,
  SYNC_TEXT_HELPER,
  TEXT_INPUT,
  compileJavaScript,
  compilePython,
  entryFn,
  envelopeBytes,
  executeKernKir,
  moduleSource,
  project,
  runJavaScriptChild,
  runPythonChild,
  runtimeRequest,
  textArgs,
} from './k0-support.mjs';

const DEEP_HELPER = Object.freeze({
  body: Object.freeze(['return value="relay(t)"']),
  name: 'deep',
  parameters: TEXT_INPUT,
  returns: 'string',
});

// A print before the call is the whole point: if the provider check were lazy the print would have
// been committed by the time the missing provider was noticed.
const TRANSITIVE = moduleSource([
  ASYNC_TEXT_HELPER,
  RELAY_HELPER,
  DEEP_HELPER,
  entryFn(['print value="t"', 'return value="deep(t)"'], TEXT_INPUT, 'string'),
]);

const DIRECT = moduleSource([
  ASYNC_TEXT_HELPER,
  entryFn(['print value="t"', 'return value="fetchIt(t)"'], TEXT_INPUT, 'string'),
]);

const SYNC_ONLY = moduleSource([SYNC_TEXT_HELPER, entryFn(['print value="t"', 'return value="echo(t)"'], TEXT_INPUT, 'string')]);

async function withoutProvider(source, requestId) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the provider fixture must project');
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  assert.equal(javascript.outcome, 'success', `javascript compile failed: ${javascript.code}`);
  assert.equal(python.outcome, 'success', `python compile failed: ${python.code}`);
  const request = runtimeRequest(requestId, textArgs('needs-a-provider'));
  return {
    direct: await executeKernKir(verified, request, {}),
    javascript: (await runJavaScriptChild(javascript.artifact.bytes, request, { omitProvider: true })).envelope,
    python: (await runPythonChild(python.artifact.bytes, request, { omitProvider: true })).envelope,
  };
}

test('provider-check-pre-execution-transitive: a missing transitive provider commits no event on any leg', async () => {
  const legs = await withoutProvider(TRANSITIVE, 'rt5-provider-transitive');
  const bytes = Buffer.from(envelopeBytes(legs.direct));
  for (const [name, envelope] of Object.entries(legs)) {
    assert.equal(envelope.outcome, 'failure', `${name}: a missing transitive provider must fail`);
    assert.equal(envelope.diagnostics[0].code, 'capability-error', name);
    assert.deepEqual(
      [...envelope.events],
      [],
      `${name}: the provider check runs before execution, so the leading print is never committed`,
    );
    assert.deepEqual(Buffer.from(envelopeBytes(envelope)), bytes, `${name}: legs must agree byte for byte`);
  }
});

test('a missing provider for a directly called async callee fails the same way', async () => {
  const legs = await withoutProvider(DIRECT, 'rt5-provider-direct');
  const bytes = Buffer.from(envelopeBytes(legs.direct));
  for (const [name, envelope] of Object.entries(legs)) {
    assert.equal(envelope.diagnostics[0].code, 'capability-error', name);
    assert.deepEqual([...envelope.events], [], name);
    assert.deepEqual(Buffer.from(envelopeBytes(envelope)), bytes, name);
  }
});

test('a program whose whole closure is synchronous still needs no provider', async () => {
  const legs = await withoutProvider(SYNC_ONLY, 'rt5-provider-sync');
  const bytes = Buffer.from(envelopeBytes(legs.direct));
  for (const [name, envelope] of Object.entries(legs)) {
    assert.equal(envelope.outcome, 'success', `${name}: a capability-free closure must not demand a provider`);
    assert.deepEqual(Buffer.from(envelopeBytes(envelope)), bytes, name);
  }
});

test('the emitted hasCapability constant is baked from the whole reachable closure, not the entry alone', async () => {
  const verified = await project(TRANSITIVE);
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  const jsText = Buffer.from(javascript.artifact.bytes).toString('utf8');
  const pyText = Buffer.from(python.artifact.bytes).toString('utf8');
  assert.ok(
    jsText.includes('if(true&&__options.invoke===undefined)'),
    'the entry has no capability of its own, so only the closure can have set the constant',
  );
  assert.ok(pyText.includes('if True and "invoke" not in _options:'), 'the Python twin bakes the same constant');
});
