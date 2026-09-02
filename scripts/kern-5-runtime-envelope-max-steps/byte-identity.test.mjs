import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonical,
  countingNodes,
  executeInternalRuntimeEnvelopeAsync,
  executeInternalRuntimeEnvelopeCompatAsync,
  executeInternalRuntimeEnvelopeCompatSync,
  executeInternalRuntimeEnvelopeSync,
  limits,
  listEnvelope,
  loopEnvelopes,
  makeEnv,
  readGolden,
  registerAllContracts,
} from './support.mjs';

registerAllContracts();

const golden = readGolden();
const nodes = countingNodes(100);

async function produced(maxSteps) {
  const tight = { enabled: true, limits: limits({ maxCollectionLength: 16, maxSteps }) };
  const roomy = { enabled: true, limits: limits({ maxCollectionLength: 1_024, maxSteps }) };
  const loop = loopEnvelopes(10, tight);
  return {
    'compat-loop-async': await executeInternalRuntimeEnvelopeCompatAsync(nodes, makeEnv(), roomy),
    'compat-loop-sync': executeInternalRuntimeEnvelopeCompatSync(nodes, makeEnv(), roomy),
    'envelope-loop-async': await executeInternalRuntimeEnvelopeAsync(nodes, makeEnv(), roomy),
    'envelope-loop-sync': executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), roomy),
    'handler-list': listEnvelope(3, tight),
    'handler-loop-async': await loop.async,
    'handler-loop-sync': loop.sync,
  };
}

test('L3: the golden pins every case captured at the base commit', () => {
  assert.equal(golden.format, 'kern.5.runtime-envelope-max-steps.byte-identity.1');
  assert.equal(golden.base, '1a88c705');
  assert.deepEqual(Object.keys(golden.cases).sort(), [
    'compat-loop-async',
    'compat-loop-sync',
    'envelope-loop-async',
    'envelope-loop-sync',
    'handler-list',
    'handler-loop-async',
    'handler-loop-sync',
  ]);
  for (const envelope of Object.values(golden.cases)) {
    assert.equal(envelope.outcome, 'success');
    assert.deepEqual(envelope.diagnostics, []);
  }
});

test('L3: a non-exhausting program yields byte-identical envelopes after the change', async () => {
  const actual = await produced(1_048_576);
  for (const [name, envelope] of Object.entries(actual)) {
    assert.equal(canonical(envelope), canonical(golden.cases[name]), `${name} must be byte-identical`);
  }
});

test('L3: maxSteps never leaks into the envelope, at any budget', async () => {
  for (const maxSteps of [128, 4_096, 1_048_576, 33_554_432]) {
    const actual = await produced(maxSteps);
    for (const [name, envelope] of Object.entries(actual)) {
      assert.equal(canonical(envelope), canonical(golden.cases[name]), `${name} at maxSteps=${maxSteps}`);
    }
  }
});

test('L3: the envelope format identity is unchanged', async () => {
  const actual = await produced(1_048_576);
  assert.equal(actual['envelope-loop-sync'].format, 'kern.runtime.internal.r0');
  assert.equal(actual['compat-loop-sync'].format, 'kern.runtime.internal.r0');
  assert.equal(actual['handler-loop-sync'].format, 'kern.runtime.handler.v1');
});
