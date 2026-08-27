import assert from 'node:assert/strict';
import test from 'node:test';

import { projectKernModules, verifyKernProjection } from '../../packages/core/dist/frontend-projection.js';
import { executeKernKir, KERN_KIR_RUNTIME_FORMAT } from '../../packages/core/dist/runtime-kir.js';

const LIMITS = Object.freeze({
  maxBytes: 20_000_000,
  maxCollectionLength: 100,
  maxDepth: 20,
  maxDiagnostics: 10,
  maxEvents: 10,
  maxSteps: 100_000,
  maxStringBytes: 10_000_000,
});

async function projection(source, extraModules = []) {
  const request = { modules: [{ moduleId: 'main.kern', source }, ...extraModules] };
  const projected = await projectKernModules(request);
  assert.equal(projected.status, 'projected');
  return verifyKernProjection(request, projected);
}

function request(handlerName, argumentsValue = {}, overrides = {}) {
  return {
    format: KERN_KIR_RUNTIME_FORMAT,
    requestId: 'review-regression',
    entry: { moduleId: 'main.kern', handlerName },
    arguments: argumentsValue,
    control: { preCancelled: false, timeoutMs: null },
    limits: LIMITS,
    ...overrides,
  };
}

function failureCode(envelope) {
  assert.equal(envelope.outcome, 'failure');
  assert.deepEqual(envelope.result, { presence: 'absent' });
  assert.equal(envelope.diagnostics.length, 1);
  return envelope.diagnostics[0].code;
}

test('a failure preserves capability events whose provider calls already committed', async () => {
  const verified = await projection([
    'fn name=commitThenFail export=true returns=string',
    '  param name=text type=string',
    '  handler lang=kern',
    '    capability namespace=ledger operation=charge name=receipt',
    '    let name=parsed value="Json.parse(text)"',
    '    return value="text"',
    '',
  ].join('\n'));
  let calls = 0;
  const envelope = await executeKernKir(
    verified,
    request('commitThenFail', { text: { tag: 'text', value: 'not-json' } }),
    {
      invoke: ({ input }) => {
        calls += 1;
        assert.deepEqual(input, { presence: 'absent' });
        return { presence: 'value', value: { tag: 'text', value: 'charged' } };
      },
    },
  );
  assert.equal(failureCode(envelope), 'unsupported-runtime-input');
  assert.equal(calls, 1);
  assert.deepEqual(envelope.events, [
    {
      input: { presence: 'absent' },
      namespace: 'ledger',
      op: 'capability',
      operation: 'charge',
      result: { presence: 'value', value: { tag: 'text', value: 'charged' } },
    },
  ]);
});

test('timeout covers request inspection and synchronous JSON evaluation and cannot return late success', async () => {
  const verified = await projection([
    'fn name=parse export=true returns=string',
    '  param name=text type=string',
    '  handler lang=kern',
    '    let name=value value="Json.parse(text)"',
    '    return value="text"',
    '',
  ].join('\n'));
  const large = `{"payload":"${'a'.repeat(2_000_000)}"}`;
  const envelope = await executeKernKir(
    verified,
    request('parse', { text: { tag: 'text', value: large } }, { control: { preCancelled: false, timeoutMs: 1 } }),
  );
  assert.equal(failureCode(envelope), 'execution-timeout');
  assert.deepEqual(envelope.events, []);
});

test('abort rejection is armed before a provider can synchronously cancel', async () => {
  const verified = await projection([
    'fn name=cancel export=true returns=string',
    '  handler lang=kern',
    '    capability namespace=test operation=cancel name=result',
    '    return value="result"',
    '',
  ].join('\n'));
  const controller = new AbortController();
  const execution = executeKernKir(verified, request('cancel'), {
    signal: controller.signal,
    invoke: () => {
      controller.abort();
      return new Promise(() => {});
    },
  });
  const envelope = await Promise.race([
    execution,
    new Promise((_, reject) => setTimeout(() => reject(new Error('execution hung after synchronous abort')), 250)),
  ]);
  assert.equal(failureCode(envelope), 'execution-cancelled');
  assert.deepEqual(envelope.events, []);
});

test('envelope encoding does not consume expression steps or apply aggregate JSON to maxStringBytes', async () => {
  const items = Array.from({ length: 20 }, (_, index) => `item-${String(index).padStart(2, '0')}`);
  const sourceList = items.map((item) => JSON.stringify(item)).join(', ');
  const verified = await projection([
    'fn name=items export=true returns=string[]',
    '  handler lang=kern',
    `    return value="[${sourceList}]"`,
    '',
  ].join('\n'));
  const envelope = await executeKernKir(
    verified,
    request('items', {}, { limits: { ...LIMITS, maxStringBytes: 20, maxSteps: 100 } }),
  );
  assert.equal(envelope.outcome, 'success');
  assert.deepEqual(envelope.result.value.value.map((item) => item.value), items);
});

test('module, export, and root link scans are collection-bound and step-metered', async () => {
  const source = [
    'fn name=ok export=true returns=string',
    '  handler lang=kern',
    '    return value="\"ok\""',
    '',
  ].join('\n');
  const verified = await projection(source, [
    { moduleId: 'other.kern', source: source.replaceAll('name=ok', 'name=other') },
  ]);
  const envelope = await executeKernKir(
    verified,
    request('ok', {}, { limits: { ...LIMITS, maxCollectionLength: 1 } }),
  );
  assert.equal(failureCode(envelope), 'runtime-limit-exceeded');
  assert.deepEqual(envelope.events, []);
});

test('request inspection rejects negative zero integers, UTF-8 byte overflow, extended arrays, and zero limits', async () => {
  const verified = await projection([
    'fn name=echo export=true returns=string',
    '  param name=text type=string',
    '  handler lang=kern',
    '    return value="text"',
    '',
  ].join('\n'));
  assert.equal(
    failureCode(await executeKernKir(verified, request('echo', { text: { tag: 'integer', value: '-0' } }))),
    'invalid-handler-arguments',
  );
  assert.equal(
    failureCode(
      await executeKernKir(
        verified,
        request('echo', { text: { tag: 'text', value: '😀😀😀' } }, { limits: { ...LIMITS, maxStringBytes: 11 } }),
      ),
    ),
    'runtime-limit-exceeded',
  );
  const extended = [{ tag: 'text', value: 'ok' }];
  extended.extra = true;
  assert.equal(
    failureCode(await executeKernKir(verified, request('echo', { text: { tag: 'list', value: extended } }))),
    'invalid-handler-arguments',
  );
  assert.equal(
    failureCode(
      await executeKernKir(
        verified,
        request('echo', { text: { tag: 'text', value: 'ok' } }, { limits: { ...LIMITS, maxEvents: 0 } }),
      ),
    ),
    'invalid-handler-arguments',
  );
});

test('bare Json, a missing required property, and a one-child leaf fail during preflight', async () => {
  const cases = [
    [
      'bareJson',
      ['fn name=bareJson export=true returns=string', '  handler lang=kern', '    return value="Json"', ''].join('\n'),
    ],
    [
      'missingReturns',
      ['fn name=missingReturns export=true', '  handler lang=kern', '    return value="\"x\""', ''].join('\n'),
    ],
    [
      'oneChild',
      [
        'fn name=oneChild export=true returns=string',
        '  handler lang=kern',
        '    let name=value value="\"x\""',
        '      print value="value"',
        '    return value="value"',
        '',
      ].join('\n'),
    ],
  ];
  for (const [handlerName, source] of cases) {
    const verified = await projection(source);
    let calls = 0;
    const envelope = await executeKernKir(verified, request(handlerName), {
      invoke: () => {
        calls += 1;
        return { presence: 'value', value: { tag: 'text', value: 'never' } };
      },
    });
    assert.equal(failureCode(envelope), 'handler-entry-unsupported', handlerName);
    assert.deepEqual(envelope.events, []);
    assert.equal(calls, 0);
  }
});

test('maxDepth and collection limits admit values exactly on their boundary', async () => {
  const echo = await projection([
    'fn name=echo export=true returns=string',
    '  param name=text type=string',
    '  handler lang=kern',
    '    return value="text"',
    '',
  ].join('\n'));
  const depth = await executeKernKir(
    echo,
    request('echo', { text: { tag: 'text', value: 'ok' } }, { limits: { ...LIMITS, maxDepth: 1 } }),
  );
  assert.equal(depth.outcome, 'success');

  const parse = await projection([
    'fn name=parse export=true returns=string',
    '  param name=text type=string',
    '  handler lang=kern',
    '    let name=value value="Json.parse(text)"',
    '    return value="text"',
    '',
  ].join('\n'));
  const collection = await executeKernKir(
    parse,
    request(
      'parse',
      { text: { tag: 'text', value: '[1,2]' } },
      { limits: { ...LIMITS, maxCollectionLength: 2 } },
    ),
  );
  assert.equal(collection.outcome, 'success');
});

test('JSON rejects malformed surrogate pairs and raw U+001F', async () => {
  const verified = await projection([
    'fn name=parse export=true returns=string',
    '  param name=text type=string',
    '  handler lang=kern',
    '    let name=value value="Json.parse(text)"',
    '    return value="text"',
    '',
  ].join('\n'));
  for (const value of ['{"x":"\\uD800\\uD800"}', `{"x":"${String.fromCharCode(0x1f)}"}`]) {
    assert.equal(
      failureCode(await executeKernKir(verified, request('parse', { text: { tag: 'text', value } }))),
      'unsupported-runtime-input',
    );
  }
});

test('request text rejects a trailing lone high surrogate', async () => {
  const verified = await projection([
    'fn name=echo export=true returns=string',
    '  param name=text type=string',
    '  handler lang=kern',
    '    return value="text"',
    '',
  ].join('\n'));
  const envelope = await executeKernKir(
    verified,
    request('echo', { text: { tag: 'text', value: `bad${String.fromCharCode(0xd800)}` } }),
  );
  assert.equal(failureCode(envelope), 'invalid-handler-arguments');
});
