import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonical,
  diagnosticCodes,
  DIFFERENTIAL_LIST,
  differentialNodes,
  executeInternalRuntimeEnvelopeAsync,
  executeInternalRuntimeEnvelopeCompatAsync,
  executeInternalRuntimeEnvelopeCompatSync,
  executeInternalRuntimeEnvelopeSync,
  executeKernRuntimeHandlerAsync,
  executeKernRuntimeHandlerSync,
  handlerRequest,
  limits,
  listEnvelope,
  loopEnvelopes,
  makeEnv,
  registerAllContracts,
} from './support.mjs';

registerAllContracts();

const LOOPS = 20;
const LIST_LENGTH = 6;

const SITES = Object.freeze([
  {
    name: 'envelope-sync',
    run: (options) => executeInternalRuntimeEnvelopeSync(differentialNodes(LOOPS), makeEnv(), options),
  },
  {
    name: 'envelope-async',
    run: (options) => executeInternalRuntimeEnvelopeAsync(differentialNodes(LOOPS), makeEnv(), options),
  },
  {
    name: 'compat-sync',
    run: (options) => executeInternalRuntimeEnvelopeCompatSync(differentialNodes(LOOPS), makeEnv(), options),
  },
  {
    name: 'compat-async',
    run: (options) => executeInternalRuntimeEnvelopeCompatAsync(differentialNodes(LOOPS), makeEnv(), options),
  },
  {
    name: 'handler-sync',
    run: (options) => executeKernRuntimeHandlerSync(handlerRequest(DIFFERENTIAL_LIST, [LOOPS]), options),
  },
  {
    name: 'handler-async',
    run: (options) =>
      executeKernRuntimeHandlerAsync(handlerRequest(DIFFERENTIAL_LIST, [LOOPS]), {
        capabilityTimeoutMs: 100,
        ...options,
      }),
  },
]);

const options = (maxIterations, maxCollectionLength) => ({
  enabled: true,
  limits: limits({ maxCollectionLength, maxIterations }),
});

test('L2: the ignored-key trap — a tiny maxIterations must flip a known-good program', async () => {
  for (const site of SITES) {
    const good = await site.run(options(10_000, 10_000));
    assert.equal(good.outcome, 'success', `${site.name} control must succeed`);

    const trapped = await site.run(options(2, 10_000));
    assert.equal(trapped.outcome, 'failure', `${site.name}: maxIterations=2 was accepted but not consumed`);
    assert.deepEqual(diagnosticCodes(trapped), ['unsupported-runtime-input'], site.name);
  }
});

test('L2: differential pair A — budget aborts while collections stay unclamped', async () => {
  for (const site of SITES) {
    const envelope = await site.run(options(5, 10_000));
    assert.equal(envelope.outcome, 'failure', site.name);
    assert.deepEqual(diagnosticCodes(envelope), ['unsupported-runtime-input'], site.name);
  }
});

test('L2: differential pair B — the collection ceiling fires while iterations run', async () => {
  for (const site of SITES) {
    const envelope = await site.run(options(10_000, LIST_LENGTH - 1));
    assert.equal(envelope.outcome, 'failure', site.name);
    const [code] = diagnosticCodes(envelope);
    assert.notEqual(code, 'unsupported-runtime-input', `${site.name}: pair B must not report the budget diagnostic`);
    assert.ok(
      code === 'non-portable-value',
      `${site.name}: unexpected pair B diagnostic ${code}`,
    );
  }
});

test('L2: pair A and pair B are distinguished by diagnostic code, not by degree', async () => {
  for (const site of SITES) {
    const [pairA] = diagnosticCodes(await site.run(options(5, 10_000)));
    const [pairB] = diagnosticCodes(await site.run(options(10_000, LIST_LENGTH - 1)));
    assert.notEqual(pairA, pairB, `${site.name}: the two limits must fail differently`);
  }
});

test('L2: maxCollectionLength no longer influences the iteration budget', async () => {
  for (const site of SITES) {
    const envelopes = [];
    for (const maxCollectionLength of [LIST_LENGTH, 64, 1_048_576]) {
      envelopes.push(await site.run(options(10_000, maxCollectionLength)));
    }
    const [reference] = envelopes;
    assert.equal(reference.outcome, 'success', site.name);
    for (const envelope of envelopes) assert.equal(canonical(envelope), canonical(reference), site.name);
  }
});

test('L2: a long loop succeeds under a tight collection ceiling', async () => {
  const tight = { enabled: true, limits: limits({ maxCollectionLength: 16, maxIterations: 1_000_000 }) };
  const { async: asyncEnvelope, sync } = loopEnvelopes(100, tight);
  assert.deepEqual(sync.result, { presence: 'value', value: { tag: 'integer', value: '100' } });
  assert.deepEqual(sync.diagnostics, []);
  assert.deepEqual(await asyncEnvelope, sync);
});

test('L2: maxIterations admits exactly its own budget and refuses one iteration more', () => {
  const budgeted = (maxIterations) =>
    loopEnvelopes(100, { enabled: true, limits: limits({ maxCollectionLength: 16, maxIterations }) }).sync;
  assert.equal(budgeted(100).outcome, 'success');
  assert.deepEqual(diagnosticCodes(budgeted(99)), ['unsupported-runtime-input']);
});

test('L2: the argument collection ceiling keeps its own distinct diagnostic', () => {
  const opts = { enabled: true, limits: limits({ maxCollectionLength: 16, maxIterations: 1_000_000 }) };
  assert.equal(listEnvelope(16, opts).outcome, 'success');
  assert.deepEqual(diagnosticCodes(listEnvelope(17, opts)), ['invalid-handler-arguments']);
});
