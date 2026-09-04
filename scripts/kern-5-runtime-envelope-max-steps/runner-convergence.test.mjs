import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  diagnosticCodes,
  differentialNodes,
  executeInternalRuntimeEnvelopeSync,
  executeSourceRunnerAsync,
  executeSourceRunnerSync,
  limits,
  makeEnv,
  registerAllContracts,
} from './support.mjs';

registerAllContracts();

const LOOPS = 20;
const BUDGETS = Object.freeze([1, 5, 19, 20, 21, 10_000]);

function sourceRunnerAborts(iterationBudget) {
  try {
    executeSourceRunnerSync(differentialNodes(LOOPS), makeEnv(), { iterationBudget, policy: 'compatible' });
    return false;
  } catch (error) {
    assert.equal(error.name, 'InternalEffectMachineError', `unexpected source-runner error at ${iterationBudget}`);
    assert.equal(error.message, 'effect machine iteration budget exhausted');
    return true;
  }
}

function envelopeAborts(maxIterations) {
  const envelope = executeInternalRuntimeEnvelopeSync(differentialNodes(LOOPS), makeEnv(), {
    enabled: true,
    limits: limits({ maxCollectionLength: 10_000, maxIterations }),
  });
  if (envelope.outcome === 'success') return false;
  assert.deepEqual(diagnosticCodes(envelope), ['unsupported-runtime-input'], `at maxIterations=${maxIterations}`);
  return true;
}

test('L6: the source runner keeps its own explicit iterationBudget, not a limits record', () => {
  const trace = executeSourceRunnerSync(differentialNodes(LOOPS), makeEnv(), {
    iterationBudget: 10_000,
    policy: 'compatible',
  });
  assert.equal(trace.completion.kind, 'return');
  assert.throws(
    () => executeSourceRunnerSync(differentialNodes(LOOPS), makeEnv(), { iterationBudget: 0, policy: 'compatible' }),
    { code: 'invalid-iteration-budget', name: 'SourceRunnerEngineError' },
  );
});

test('L6: both runners abort at exactly the same budget threshold', () => {
  for (const budget of BUDGETS) {
    assert.equal(
      envelopeAborts(budget),
      sourceRunnerAborts(budget),
      `envelope and source runner disagree at budget ${budget}`,
    );
  }
});

test('L6: the shared threshold is the loop count, on both runners', () => {
  assert.equal(sourceRunnerAborts(LOOPS), false);
  assert.equal(sourceRunnerAborts(LOOPS - 1), true);
  assert.equal(envelopeAborts(LOOPS), false);
  assert.equal(envelopeAborts(LOOPS - 1), true);
});

test('L6: the async source runner converges with the sync one', async () => {
  for (const iterationBudget of [5, 10_000]) {
    let syncAborted = false;
    let asyncAborted = false;
    try {
      executeSourceRunnerSync(differentialNodes(LOOPS), makeEnv(), { iterationBudget, policy: 'compatible' });
    } catch {
      syncAborted = true;
    }
    try {
      await executeSourceRunnerAsync(differentialNodes(LOOPS), makeEnv(), { iterationBudget, policy: 'compatible' });
    } catch {
      asyncAborted = true;
    }
    assert.equal(syncAborted, asyncAborted, `source runner sync/async disagree at ${iterationBudget}`);
  }
});

test('L6: the source runner collection ceiling is not the envelope one', () => {
  const trace = executeSourceRunnerSync(differentialNodes(LOOPS), makeEnv(), {
    iterationBudget: 10_000,
    policy: 'compatible',
  });
  assert.deepEqual(trace.completion.value, [1, 2, 3, 4, 5, 6]);
});
