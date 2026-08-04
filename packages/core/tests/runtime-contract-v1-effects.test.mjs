import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  executeKernRuntimeHandlerAsync,
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
  KernRuntimeHandlerError,
} from '@kernlang/core/runtime/handler';

const goldens = JSON.parse(readFileSync('scripts/runtime-contract-v1/goldens.json', 'utf8'));
const proofInventory = JSON.parse(readFileSync('scripts/runtime-contract-v1/proof-inventory.json', 'utf8'));

function request(source, arguments_ = [], abi = KERN_RUNTIME_HANDLER_ABI) {
  return { abi, arguments: arguments_, identity: { handlerName: 'answer', sourcePath: 'a' }, source };
}

function source(parameters, returns, body) {
  return [
    `fn name=answer returns=${returns}`,
    ...parameters.map((parameter) => `  param ${parameter}`),
    '  handler lang="kern"',
    ...body.map((line) => `    ${line}`),
  ].join('\n');
}

function options(capabilities, override = {}) {
  return { capabilities, enabled: true, limits: { ...goldens.limits }, ...override };
}

const providerSource = source([], 'string', [
  'capability namespace=demo operation=first name=value',
  'capability namespace=demo operation=later name=later',
  'return value="value"',
]);

test('every pre-provider rejection keeps providers, publications, timers, and state untouched', async () => {
  assert.deepEqual(
    proofInventory.effects.slice(0, 7).map(({ id }) => id),
    [
      'pre-invalid-abi',
      'pre-invalid-request',
      'pre-invalid-options',
      'pre-invalid-limits',
      'pre-unsupported-handler',
      'pre-invalid-arguments',
      'pre-invalid-capability-input',
    ],
  );
  const cases = [
    { id: 'pre-invalid-abi', invocation: request(providerSource, [], 'wrong-abi'), override: {} },
    { id: 'pre-invalid-request', invocation: { ...request(providerSource), arguments: {} }, override: {} },
    { id: 'pre-invalid-options', invocation: request(providerSource), override: { unknown: true } },
    {
      id: 'pre-invalid-limits',
      invocation: request(providerSource),
      override: { limits: { ...goldens.limits, maxBytes: 0 } },
    },
    {
      id: 'pre-unsupported-handler',
      invocation: request(source(['name=value type=Custom'], 'Custom', [
        'capability namespace=demo operation=first name=result',
        'return value="value"',
      ]), ['wrong']),
      override: {},
    },
    {
      id: 'pre-invalid-arguments',
      invocation: request(source(['name=value type=number'], 'number', [
        'capability namespace=demo operation=first name=result',
        'return value="value"',
      ]), ['wrong']),
      override: {},
    },
    {
      id: 'pre-invalid-capability-input',
      invocation: request(source([], 'string', [
        'capability namespace=demo operation=first input="{ value: 1, value: 2 }" name=value',
        'capability namespace=demo operation=later name=later',
        'return value="value"',
      ])),
      override: {},
    },
  ];
  const originalSetTimeout = globalThis.setTimeout;
  for (const fixture of cases) {
    for (const mode of ['sync', 'async']) {
      const state = { first: 0, later: 0, timers: 0 };
      const capabilities = {
        demo: {
          first() { state.first += 1; return 'first'; },
          later() { state.later += 1; return 'later'; },
        },
      };
      globalThis.setTimeout = (...arguments_) => {
        state.timers += 1;
        return originalSetTimeout(...arguments_);
      };
      try {
        const accepted = options(capabilities, fixture.override);
        let envelope;
        if (mode === 'sync') {
          try {
            envelope = executeKernRuntimeHandlerSync(fixture.invocation, accepted);
          } catch (error) {
            assert.ok(error instanceof KernRuntimeHandlerError, fixture.id);
          }
        } else {
          try {
            envelope = await executeKernRuntimeHandlerAsync(fixture.invocation, {
              ...accepted,
              asyncCapabilities: capabilities,
              capabilityTimeoutMs: 20,
            });
          } catch (error) {
            assert.ok(error instanceof KernRuntimeHandlerError, fixture.id);
          }
        }
        if (envelope) {
          assert.deepEqual(envelope.events, [], `${fixture.id} ${mode} events`);
          assert.deepEqual(envelope.result, { presence: 'absent' }, `${fixture.id} ${mode} result`);
        }
        assert.deepEqual(state, { first: 0, later: 0, timers: 0 }, `${fixture.id} ${mode} effects`);
      } finally {
        globalThis.setTimeout = originalSetTimeout;
      }
    }
  }
});

test('post-provider rejection permits one provider and blocks later publication and dispatch', async () => {
  const invalidProviderSource = source([], 'string', [
    'capability namespace=llm operation=complete name=value',
    'capability namespace=demo operation=later name=later',
    'return value="value"',
  ]);
  for (const mode of ['sync', 'async']) {
    const state = { first: 0, later: 0 };
    const capabilities = {
      llm: { complete() { state.first += 1; return () => 'invalid'; } },
      demo: { later() { state.later += 1; return 'later'; } },
    };
    const invocation = request(invalidProviderSource);
    const envelope = mode === 'sync'
      ? executeKernRuntimeHandlerSync(invocation, options(capabilities))
      : await executeKernRuntimeHandlerAsync(invocation, {
          ...options(capabilities),
          asyncCapabilities: capabilities,
          capabilityTimeoutMs: 20,
        });
    assert.deepEqual(state, { first: 1, later: 0 });
    assert.deepEqual(envelope.events, []);
    assert.deepEqual(envelope.result, { presence: 'absent' });
    assert.equal(envelope.diagnostics[0]?.code, 'capability-error');
  }
});

test('declared-result mismatch preserves the authorized call but suppresses public effects', async () => {
  const mismatchSource = source([], 'number', [
    'capability namespace=llm operation=complete name=value',
    'print value="value"',
    'return value="value"',
  ]);
  for (const mode of ['sync', 'async']) {
    let calls = 0;
    const capabilities = { llm: { complete() { calls += 1; return 'text'; } } };
    const invocation = request(mismatchSource);
    const envelope = mode === 'sync'
      ? executeKernRuntimeHandlerSync(invocation, options(capabilities))
      : await executeKernRuntimeHandlerAsync(invocation, {
          ...options(capabilities),
          asyncCapabilities: capabilities,
          capabilityTimeoutMs: 20,
        });
    assert.equal(calls, 1);
    assert.equal(envelope.diagnostics[0]?.code, 'invalid-handler-result');
    assert.deepEqual(envelope.events, []);
    assert.deepEqual(envelope.result, { presence: 'absent' });
  }
});
