import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CLI_LIMIT_KEY_DECLARATION,
  declaredLimitKeys,
  ENVELOPE_LIMIT_KEY_DECLARATION,
  ENVELOPE_LIMIT_KEYS,
  executeKernRuntimeHandlerAsync,
  executeKernRuntimeHandlerSync,
  handlerRequest,
  KIR_LIMIT_KEYS,
  kirLimitKeyDeclarations,
  kirLimits,
  LEGACY_ENVELOPE_LIMIT_KEYS,
  legacyLimits,
  limits,
  COUNTING_LOOP,
  registerAllContracts,
  sharedLimitKeyConsumers,
  validateInternalRuntimeLimits,
} from './support.mjs';

registerAllContracts();

test('L1: the envelope limits record admits maxIterations', () => {
  assert.deepEqual([...ENVELOPE_LIMIT_KEYS].sort(), ENVELOPE_LIMIT_KEYS);
  validateInternalRuntimeLimits(limits());
});

test('L1: the envelope limits record refuses a record without maxIterations', () => {
  assert.throws(() => validateInternalRuntimeLimits(legacyLimits()), (error) => {
    assert.equal(error.name, 'InternalRuntimeEnvelopeError');
    assert.equal(error.code, 'invalid-limits');
    assert.equal(error.message, `limits must contain exactly ${ENVELOPE_LIMIT_KEYS.join(',')}`);
    return true;
  });
});

test('L1: maxIterations is enforced as a positive safe integer', () => {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2, '1', null]) {
    assert.throws(
      () => validateInternalRuntimeLimits({ ...legacyLimits(), maxIterations: value }),
      (error) => {
        assert.equal(error.code, 'invalid-limits');
        assert.equal(error.message, 'maxIterations must be a positive safe integer');
        return true;
      },
      `maxIterations=${String(value)} must be refused`,
    );
  }
});

test('L1: the public handler accepts limits carrying maxIterations on both paths', async () => {
  const invocation = handlerRequest(COUNTING_LOOP, [4]);
  const options = { enabled: true, limits: limits() };
  const sync = executeKernRuntimeHandlerSync(invocation, options);
  const asyncEnvelope = await executeKernRuntimeHandlerAsync(invocation, { capabilityTimeoutMs: 100, ...options });
  assert.equal(sync.outcome, 'success');
  assert.deepEqual(sync.result, { presence: 'value', value: { tag: 'integer', value: '4' } });
  assert.deepEqual(asyncEnvelope, sync);
});

test('L1: the public handler refuses limits without maxIterations on both paths', async () => {
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

test('L1: maxIterations is the only key the record gained', () => {
  assert.deepEqual(
    ENVELOPE_LIMIT_KEYS.filter((key) => !LEGACY_ENVELOPE_LIMIT_KEYS.includes(key)),
    ['maxIterations'],
  );
});

test('L1: a KIR limits record is NOT shape-compatible with the envelope record', () => {
  assert.deepEqual(
    KIR_LIMIT_KEYS.filter((key) => !ENVELOPE_LIMIT_KEYS.includes(key)),
    ['maxSteps'],
  );
  assert.deepEqual(
    ENVELOPE_LIMIT_KEYS.filter((key) => !KIR_LIMIT_KEYS.includes(key)),
    ['maxIterations'],
  );
  assert.equal(KIR_LIMIT_KEYS.length, ENVELOPE_LIMIT_KEYS.length);
});

test('L1: spreading a KIR limits record into the envelope fails exact-key validation', () => {
  assert.throws(() => validateInternalRuntimeLimits({ ...kirLimits() }), (error) => {
    assert.equal(error.code, 'invalid-limits');
    assert.equal(error.message, `limits must contain exactly ${ENVELOPE_LIMIT_KEYS.join(',')}`);
    return true;
  });
  assert.throws(
    () => executeKernRuntimeHandlerSync(handlerRequest(COUNTING_LOOP, [1]), { enabled: true, limits: kirLimits() }),
    (error) => {
      assert.equal(error.code, 'invalid-limits');
      return true;
    },
  );
});

test('L1: an envelope limits record is not accepted as a KIR record either', () => {
  assert.ok(!KIR_LIMIT_KEYS.includes('maxIterations'), 'KIR must not learn the envelope name');
  assert.ok(!ENVELOPE_LIMIT_KEYS.includes('maxSteps'), 'the envelope must not reuse the KIR name');
});

test('L1: every shipped KIR limits key list still declares maxSteps and refuses maxIterations', () => {
  const declarations = kirLimitKeyDeclarations();
  assert.equal(declarations.length, 3);
  for (const { keys, path } of declarations) {
    assert.deepEqual(keys, [...KIR_LIMIT_KEYS], path);
  }
});

test('L1: one shared declaration per package carries the envelope limit key set', () => {
  assert.deepEqual(
    declaredLimitKeys(ENVELOPE_LIMIT_KEY_DECLARATION, 'INTERNAL_RUNTIME_ENVELOPE_LIMIT_KEYS'),
    [...ENVELOPE_LIMIT_KEYS],
  );
  assert.deepEqual(declaredLimitKeys(CLI_LIMIT_KEY_DECLARATION, 'DECLARED'), [...ENVELOPE_LIMIT_KEYS]);
});

test('L1: every limit-key consumer imports the shared declaration instead of repeating it', () => {
  const missing = sharedLimitKeyConsumers().filter((row) => !row.imported);
  assert.deepEqual(missing, [], `${missing.length} consumer(s) do not import the shared limit-key declaration`);
});
