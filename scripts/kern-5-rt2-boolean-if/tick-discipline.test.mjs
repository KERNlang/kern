import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileJavaScript,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  handlerSource,
  project,
  provider,
  queueAbort,
  runtimeRequest,
  threeLegs,
} from './k0-support.mjs';

const FLAG = Object.freeze([{ name: 'flag', type: 'boolean' }]);

const SINGLE_BRANCH_SOURCE = handlerSource('string', FLAG, [
  'print value="\"before\""',
  'if cond="flag"',
  '  print value="\"inside\""',
  'return value="\"done\""',
]);

const NESTED_BRANCH_SOURCE = handlerSource(
  'string',
  [
    { name: 'outer', type: 'boolean' },
    { name: 'inner', type: 'boolean' },
  ],
  [
    'print value="\"before\""',
    'if cond="outer"',
    '  if cond="inner"',
    '    print value="\"deep\""',
    'return value="\"done\""',
  ],
);

const QUEUE_DEPTHS = Object.freeze([0, 1, 2, 3, 4]);

async function comparedUnderQueuedAbort(source, args, abortAfterMicrotasks) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the tick-discipline source');
  const compiled = compileJavaScript(verified);
  assert.equal(compiled.outcome, 'success', `javascript compile failed: ${compiled.code}`);
  const request = runtimeRequest(`rt2-tick-${abortAfterMicrotasks}`, args);
  const direct = await executeKernKir(verified, request, {
    ...provider([]),
    signal: queueAbort(abortAfterMicrotasks),
  });
  const emitted = await executeJavaScriptChild(compiled.artifact.bytes, request, { abortAfterMicrotasks });
  return { direct, emitted };
}

for (const depth of QUEUE_DEPTHS) {
  test(`RT-2 entering a branch adds no RT-1-only checkpoint: abort queued at microtask depth ${depth}`, async () => {
    const { direct, emitted } = await comparedUnderQueuedAbort(
      SINGLE_BRANCH_SOURCE,
      { flag: { tag: 'boolean', value: true } },
      depth,
    );
    assert.deepEqual(
      Buffer.from(envelopeBytes(emitted.envelope)),
      Buffer.from(envelopeBytes(direct)),
      'RT2_TICK_DISCIPLINE_DIVERGENCE: entering a linked branch must not add an RT-1-only await point',
    );
  });
}

for (const depth of QUEUE_DEPTHS) {
  test(`RT-2 nested branches add no RT-1-only checkpoint: abort queued at microtask depth ${depth}`, async () => {
    const { direct, emitted } = await comparedUnderQueuedAbort(
      NESTED_BRANCH_SOURCE,
      { inner: { tag: 'boolean', value: true }, outer: { tag: 'boolean', value: true } },
      depth,
    );
    assert.deepEqual(
      Buffer.from(envelopeBytes(emitted.envelope)),
      Buffer.from(envelopeBytes(direct)),
      'RT2_TICK_DISCIPLINE_DIVERGENCE: branch depth must not change the RT-1 cancellation checkpoint',
    );
  });
}

test('RT-2 branch execution without cancellation stays byte-identical on all three legs', async () => {
  const legs = await threeLegs(
    SINGLE_BRANCH_SOURCE,
    runtimeRequest('rt2-tick-control', { flag: { tag: 'boolean', value: true } }),
  );
  const direct = envelopeBytes(legs.direct.envelope);
  assert.equal(legs.direct.envelope.outcome, 'success');
  assert.deepEqual([...legs.direct.envelope.events], [
    { op: 'stdout', text: 'before' },
    { op: 'stdout', text: 'inside' },
  ]);
  assert.deepEqual(Buffer.from(envelopeBytes(legs.javascript.envelope)), Buffer.from(direct));
  assert.deepEqual(Buffer.from(envelopeBytes(legs.python.envelope)), Buffer.from(direct));
});

test('RT-2 pre-cancellation still fails closed before any branch effect on both JavaScript legs', async () => {
  const verified = await project(SINGLE_BRANCH_SOURCE);
  const compiled = compileJavaScript(verified);
  const request = runtimeRequest(
    'rt2-tick-pre-cancel',
    { flag: { tag: 'boolean', value: true } },
    { preCancelled: true, timeoutMs: null },
  );
  const direct = await executeKernKir(verified, request, provider([]));
  const emitted = await executeJavaScriptChild(compiled.artifact.bytes, request);
  assert.equal(direct.outcome, 'failure');
  assert.equal(direct.diagnostics[0]?.code, 'execution-cancelled');
  assert.deepEqual([...direct.events], []);
  assert.deepEqual(Buffer.from(envelopeBytes(emitted.envelope)), Buffer.from(envelopeBytes(direct)));
});
