import assert from 'node:assert/strict';
import test from 'node:test';

import { projectKernModules, verifyKernProjection } from '../../packages/core/dist/frontend-projection.js';
import {
  executeKernKir,
  KERN_KIR_RUNTIME_FORMAT,
  KERN_KIR_RUNTIME_OWNER,
} from '../../packages/core/dist/runtime-kir.js';

const LIMITS = Object.freeze({
  maxBytes: 100_000,
  maxCollectionLength: 100,
  maxDepth: 20,
  maxDiagnostics: 10,
  maxEvents: 10,
  maxSteps: 10_000,
  maxStringBytes: 10_000,
});

const SOURCE = [
  'fn name=compose export=true returns=string',
  '  param name=text type=string',
  '  param name=textList type=string[]',
  '  handler lang=kern',
  '    let name=payload value="Json.parse(text)"',
  '    capability namespace=r0fixture operation=resolve name=reply',
  '    let name=result value="Json.stringify({ labels: textList, payload: payload, reply: reply })"',
  '    print value="result"',
  '    return value="result"',
  '',
].join('\n');

async function projection(source = SOURCE) {
  const request = { modules: [{ moduleId: 'main.kern', source }] };
  const projected = await projectKernModules(request);
  assert.equal(projected.status, 'projected');
  return verifyKernProjection(request, projected);
}

function request(id, text, textList, overrides = {}) {
  return {
    format: KERN_KIR_RUNTIME_FORMAT,
    requestId: id,
    entry: { moduleId: 'main.kern', handlerName: 'compose' },
    arguments: {
      text: { tag: 'text', value: text },
      textList: { tag: 'list', value: textList.map((value) => ({ tag: 'text', value })) },
    },
    control: { preCancelled: false, timeoutMs: null },
    limits: LIMITS,
    ...overrides,
  };
}

function failureCode(envelope) {
  assert.equal(envelope.outcome, 'failure');
  assert.deepEqual(envelope.events, []);
  assert.deepEqual(envelope.result, { presence: 'absent' });
  assert.equal(envelope.diagnostics.length, 1);
  return envelope.diagnostics[0].code;
}

const verified = await projection();

test('owner identity and direct structural execution are exact for two dynamic requests', async () => {
  assert.equal(KERN_KIR_RUNTIME_OWNER, 'kern.runtime.kir.owner.v1');
  const cases = [
    {
      id: 'dynamic-one',
      json: '{"items":[1,[2]],"meta":{"mode":"one"}}',
      labels: ['one', 'two'],
      reply: 'capability-one',
      expected: '{"labels":["one","two"],"payload":{"items":[1,[2]],"meta":{"mode":"one"}},"reply":"capability-one"}',
    },
    {
      id: 'dynamic-two',
      json: '{"items":[3,[4,5]],"meta":{"mode":"two"}}',
      labels: ['three'],
      reply: 'capability-two',
      expected: '{"labels":["three"],"payload":{"items":[3,[4,5]],"meta":{"mode":"two"}},"reply":"capability-two"}',
    },
  ];
  for (const item of cases) {
    const calls = [];
    const envelope = await executeKernKir(verified, request(item.id, item.json, item.labels), {
      invoke: async (call) => {
        calls.push(call);
        await new Promise((resolve) => setImmediate(resolve));
        return { presence: 'value', value: { tag: 'text', value: item.reply } };
      },
    });
    assert.equal(envelope.outcome, 'success');
    assert.deepEqual(envelope, {
      completion: { kind: 'return' },
      diagnostics: [],
      events: [
        {
          input: { presence: 'absent' },
          namespace: 'r0fixture',
          op: 'capability',
          operation: 'resolve',
          result: { presence: 'value', value: { tag: 'text', value: item.reply } },
        },
        { op: 'stdout', text: item.expected },
      ],
      format: KERN_KIR_RUNTIME_FORMAT,
      outcome: 'success',
      requestId: item.id,
      result: { presence: 'value', value: { tag: 'text', value: item.expected } },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].namespace, 'r0fixture');
    assert.equal(calls[0].operation, 'resolve');
    assert.ok(calls[0].signal instanceof AbortSignal);
  }
});

test('projection authentication rejects clones, reconstructions, and byte tampering before effects', async () => {
  let calls = 0;
  const invoke = async () => {
    calls += 1;
    return { presence: 'value', value: { tag: 'text', value: 'never' } };
  };
  const input = request('auth', '{"ok":true}', ['auth']);
  assert.equal(failureCode(await executeKernKir({ ...verified }, input, { invoke })), 'projection-authentication-error');
  const reconstructed = structuredClone(verified);
  assert.equal(failureCode(await executeKernKir(reconstructed, input, { invoke })), 'projection-authentication-error');
  const mutable = await projection();
  mutable.bytes[0] ^= 1;
  assert.equal(failureCode(await executeKernKir(mutable, input, { invoke })), 'projection-authentication-error');
  assert.equal(calls, 0);
});

test('a smuggled Json intrinsic member after a capability is rejected by complete preflight with no provider call', async () => {
  const unsupportedSource = [
    'fn name=compose export=true returns=string',
    '  param name=text type=string',
    '  param name=textList type=string[]',
    '  handler lang=kern',
    '    capability namespace=r0fixture operation=resolve name=reply',
    '    let name=intrinsic value="Json.stringify"',
    '    return value="text"',
    '',
  ].join('\n');
  const unsupported = await projection(unsupportedSource);
  let calls = 0;
  const envelope = await executeKernKir(unsupported, request('unsupported', 'x', []), {
    invoke: async () => {
      calls += 1;
      return { presence: 'value', value: { tag: 'text', value: 'bad' } };
    },
  });
  assert.equal(failureCode(envelope), 'handler-entry-unsupported');
  assert.equal(calls, 0);
});

test('pre-cancellation, timeout, event/string/collection/depth/step/byte limits fail closed', async () => {
  let calls = 0;
  const provider = async () => {
    calls += 1;
    return { presence: 'value', value: { tag: 'text', value: 'reply' } };
  };
  const base = request('limits', '{"x":[1]}', ['x']);
  assert.equal(
    failureCode(await executeKernKir(verified, { ...base, control: { preCancelled: true, timeoutMs: null } }, { invoke: provider })),
    'execution-cancelled',
  );
  assert.equal(calls, 0);
  assert.equal(
    failureCode(await executeKernKir(verified, { ...base, control: { preCancelled: false, timeoutMs: 5 } }, { invoke: () => new Promise(() => {}) })),
    'execution-timeout',
  );
  for (const [key, value] of [
    ['maxEvents', 1],
    ['maxStringBytes', 4],
    ['maxCollectionLength', 1],
    ['maxDepth', 1],
    ['maxSteps', 1],
    ['maxBytes', 100],
  ]) {
    const envelope = await executeKernKir(verified, { ...base, limits: { ...LIMITS, [key]: value } }, { invoke: provider });
    if (key === 'maxEvents') {
      assert.equal(envelope.outcome, 'failure');
      assert.equal(envelope.diagnostics[0]?.code, 'runtime-limit-exceeded');
      assert.equal(envelope.events.length, 1, 'the committed capability event remains observable');
      assert.equal(envelope.events[0]?.op, 'capability');
    } else {
      assert.equal(failureCode(envelope), 'runtime-limit-exceeded', key);
    }
  }
});

test('external cancellation interrupts an unresolved capability and reaches its signal', async () => {
  const controller = new AbortController();
  let deliveredSignal;
  const pending = executeKernKir(verified, request('external-cancel', '{"x":1}', ['x']), {
    signal: controller.signal,
    invoke: ({ signal }) => {
      deliveredSignal = signal;
      return new Promise(() => {});
    },
  });
  setImmediate(() => controller.abort());
  assert.equal(failureCode(await pending), 'execution-cancelled');
  assert.equal(deliveredSignal.aborted, true);
});

test('concurrent requests remain isolated when capability completions resolve out of order', async () => {
  const resolvers = new Map();
  const invoke = (mode) => () => new Promise((resolve) => resolvers.set(mode, resolve));
  const one = executeKernKir(verified, request('concurrent-one', '{"mode":"one"}', ['one']), { invoke: invoke('one') });
  const two = executeKernKir(verified, request('concurrent-two', '{"mode":"two"}', ['two']), { invoke: invoke('two') });
  while (resolvers.size !== 2) await new Promise((resolve) => setImmediate(resolve));
  resolvers.get('two')({ presence: 'value', value: { tag: 'text', value: 'reply-two' } });
  resolvers.get('one')({ presence: 'value', value: { tag: 'text', value: 'reply-one' } });
  const [oneResult, twoResult] = await Promise.all([one, two]);
  assert.equal(oneResult.requestId, 'concurrent-one');
  assert.equal(twoResult.requestId, 'concurrent-two');
  assert.match(oneResult.result.value.value, /reply-one/u);
  assert.match(twoResult.result.value.value, /reply-two/u);
  assert.doesNotMatch(oneResult.result.value.value, /reply-two/u);
});

test('KERN-owned JSON preserves big integers and code-point order while rejecting divergent forms', async () => {
  const noCapabilitySource = [
    'fn name=compose export=true returns=string',
    '  param name=text type=string',
    '  param name=textList type=string[]',
    '  handler lang=kern',
    '    let name=payload value="Json.parse(text)"',
    '    let name=result value="Json.stringify(payload)"',
    '    return value="result"',
    '',
  ].join('\n');
  const direct = await projection(noCapabilitySource);
  const accepted = await executeKernKir(direct, request('json-exact', '{"😀":9007199254740993,"":2}', []));
  assert.equal(accepted.result.value.value, '{"":2,"😀":9007199254740993}');
  for (const source of ['{"x":1e3}', '{"x":1,"x":2}', '{"x":-0}']) {
    assert.equal(failureCode(await executeKernKir(direct, request('json-reject', source, []))), 'unsupported-runtime-input');
  }
});
