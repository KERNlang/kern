import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ENVELOPE_LIMIT_KEYS,
  executeKernRuntimeHandlerAsync,
  executeKernRuntimeHandlerSync,
  handlerRequest,
  LEGACY_ENVELOPE_LIMIT_KEYS,
  legacyLimits,
  limits,
  COUNTING_LOOP,
  registerAllContracts,
  validateInternalRuntimeLimits,
} from './support.mjs';

registerAllContracts();

test('L1: the envelope limits record admits maxSteps', () => {
  assert.deepEqual([...ENVELOPE_LIMIT_KEYS].sort(), ENVELOPE_LIMIT_KEYS);
  validateInternalRuntimeLimits(limits());
});

test('L1: the envelope limits record refuses a record without maxSteps', () => {
  assert.throws(() => validateInternalRuntimeLimits(legacyLimits()), (error) => {
    assert.equal(error.name, 'InternalRuntimeEnvelopeError');
    assert.equal(error.code, 'invalid-limits');
    assert.equal(error.message, `limits must contain exactly ${ENVELOPE_LIMIT_KEYS.join(',')}`);
    return true;
  });
});

test('L1: maxSteps is enforced as a positive safe integer', () => {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2, '1', null]) {
    assert.throws(
      () => validateInternalRuntimeLimits({ ...legacyLimits(), maxSteps: value }),
      (error) => {
        assert.equal(error.code, 'invalid-limits');
        assert.equal(error.message, 'maxSteps must be a positive safe integer');
        return true;
      },
      `maxSteps=${String(value)} must be refused`,
    );
  }
});

test('L1: the public handler accepts limits carrying maxSteps on both paths', async () => {
  const invocation = handlerRequest(COUNTING_LOOP, [4]);
  const options = { enabled: true, limits: limits() };
  const sync = executeKernRuntimeHandlerSync(invocation, options);
  const asyncEnvelope = await executeKernRuntimeHandlerAsync(invocation, { capabilityTimeoutMs: 100, ...options });
  assert.equal(sync.outcome, 'success');
  assert.deepEqual(sync.result, { presence: 'value', value: { tag: 'integer', value: '4' } });
  assert.deepEqual(asyncEnvelope, sync);
});

test('L1: the public handler refuses limits without maxSteps on both paths', async () => {
  const invocation = handlerRequest(COUNTING_LOOP, [4]);
  const options = { enabled: true, limits: legacyLimits() };
  const expected = (error) => {
    assert.equal(error.name, 'KernRuntimeHandlerError');
    assert.equal(error.code, 'invalid-limits');
    assert.equal(error.message, 'runtime handler limits are invalid');
    return true;
  };
  assert.throws(() => executeKernRuntimeHandlerSync(invocation, options), expected);
  await assert.rejects(
    () => executeKernRuntimeHandlerAsync(invocation, { capabilityTimeoutMs: 100, ...options }),
    expected,
  );
});

test('L1: the public handler still refuses an unknown limit key', () => {
  assert.throws(
    () => executeKernRuntimeHandlerSync(handlerRequest(COUNTING_LOOP, [1]), {
      enabled: true,
      limits: { ...limits(), maxTicks: 4 },
    }),
    (error) => {
      assert.equal(error.code, 'invalid-limits');
      return true;
    },
  );
});

test('L1: maxSteps is the only key the record gained', () => {
  assert.deepEqual(
    ENVELOPE_LIMIT_KEYS.filter((key) => !LEGACY_ENVELOPE_LIMIT_KEYS.includes(key)),
    ['maxSteps'],
  );
});
