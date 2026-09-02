import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonical,
  countingNodes,
  diagnosticCodes,
  executeInternalRuntimeEnvelopeAsync,
  executeInternalRuntimeEnvelopeCompatAsync,
  executeInternalRuntimeEnvelopeCompatSync,
  executeInternalRuntimeEnvelopeSync,
  limits,
  listEnvelope,
  loopEnvelopes,
  makeEnv,
  registerAllContracts,
} from './support.mjs';

registerAllContracts();

const TIGHT_COLLECTION = 16;
const ITERATIONS = 100;

test('L2: a long loop succeeds under a tight collection ceiling and a large maxSteps', async () => {
  const options = { enabled: true, limits: limits({ maxCollectionLength: TIGHT_COLLECTION, maxSteps: 1_000_000 }) };
  const { async: asyncEnvelope, sync } = loopEnvelopes(ITERATIONS, options);
  assert.deepEqual(sync.result, { presence: 'value', value: { tag: 'integer', value: String(ITERATIONS) } });
  assert.deepEqual(sync.diagnostics, []);
  assert.deepEqual(await asyncEnvelope, sync);
});

test('L2: a small maxSteps exhausts the budget regardless of a roomy collection ceiling', async () => {
  const options = { enabled: true, limits: limits({ maxCollectionLength: 1_048_576, maxSteps: 8 }) };
  const { async: asyncEnvelope, sync } = loopEnvelopes(ITERATIONS, options);
  assert.equal(sync.outcome, 'failure');
  assert.deepEqual(diagnosticCodes(sync), ['unsupported-runtime-input']);
  assert.deepEqual(await asyncEnvelope, sync);
});

test('L2: maxSteps admits exactly its own budget and refuses one iteration more', () => {
  const at = loopEnvelopes(ITERATIONS, {
    enabled: true,
    limits: limits({ maxCollectionLength: TIGHT_COLLECTION, maxSteps: ITERATIONS }),
  }).sync;
  const under = loopEnvelopes(ITERATIONS, {
    enabled: true,
    limits: limits({ maxCollectionLength: TIGHT_COLLECTION, maxSteps: ITERATIONS - 1 }),
  }).sync;
  assert.equal(at.outcome, 'success');
  assert.deepEqual(diagnosticCodes(under), ['unsupported-runtime-input']);
});

test('L2: the collection ceiling still bites, with its own distinct diagnostic', () => {
  const options = { enabled: true, limits: limits({ maxCollectionLength: TIGHT_COLLECTION, maxSteps: 1_000_000 }) };
  assert.equal(listEnvelope(TIGHT_COLLECTION, options).outcome, 'success');
  const over = listEnvelope(TIGHT_COLLECTION + 1, options);
  assert.equal(over.outcome, 'failure');
  assert.deepEqual(diagnosticCodes(over), ['invalid-handler-arguments']);
  assert.notDeepEqual(diagnosticCodes(over), ['unsupported-runtime-input']);
});

test('L2: maxCollectionLength no longer influences the iteration budget', async () => {
  const envelopes = [TIGHT_COLLECTION, 64, 1_048_576].map(
    (maxCollectionLength) =>
      loopEnvelopes(ITERATIONS, { enabled: true, limits: limits({ maxCollectionLength, maxSteps: 1_000_000 }) }).sync,
  );
  const [reference] = envelopes;
  for (const envelope of envelopes) assert.equal(canonical(envelope), canonical(reference));
  assert.equal(reference.outcome, 'success');

  const nodes = countingNodes(ITERATIONS);
  for (const maxCollectionLength of [TIGHT_COLLECTION, 1_048_576]) {
    const options = { enabled: true, limits: limits({ maxCollectionLength, maxSteps: 1_000_000 }) };
    assert.equal(
      canonical(executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), options)),
      canonical(executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), { enabled: true, limits: limits({ maxSteps: 1_000_000 }) })),
      `direct sync must ignore maxCollectionLength=${maxCollectionLength}`,
    );
    assert.equal(
      canonical(await executeInternalRuntimeEnvelopeAsync(nodes, makeEnv(), options)),
      canonical(executeInternalRuntimeEnvelopeSync(nodes, makeEnv(), options)),
    );
  }
});

test('L2: the compat path reads the budget from maxSteps too', async () => {
  const nodes = countingNodes(ITERATIONS);
  const roomySteps = { enabled: true, limits: limits({ maxCollectionLength: TIGHT_COLLECTION, maxSteps: 1_000_000 }) };
  const tightSteps = { enabled: true, limits: limits({ maxCollectionLength: 1_048_576, maxSteps: 8 }) };

  const passing = executeInternalRuntimeEnvelopeCompatSync(nodes, makeEnv(), roomySteps);
  assert.deepEqual(passing.result, { presence: 'value', value: { tag: 'integer', value: String(ITERATIONS) } });
  assert.equal(canonical(await executeInternalRuntimeEnvelopeCompatAsync(nodes, makeEnv(), roomySteps)), canonical(passing));

  const failing = executeInternalRuntimeEnvelopeCompatSync(nodes, makeEnv(), tightSteps);
  assert.deepEqual(diagnosticCodes(failing), ['unsupported-runtime-input']);
  assert.equal(canonical(await executeInternalRuntimeEnvelopeCompatAsync(nodes, makeEnv(), tightSteps)), canonical(failing));
});
