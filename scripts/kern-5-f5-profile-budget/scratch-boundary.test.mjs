import assert from 'node:assert/strict';
import test from 'node:test';

import { runProjection } from '../kern-frontend-f5-projection/worker.mjs';
import { disposeScratchRoots, projectUnderScratchPolicy } from './scratch-policy.mjs';
import { RAISED_WORK_STEPS, smallModule } from './support.mjs';

const setWorkSteps = (value) => (policy) => { policy.profileLimits.maxWorkSteps = value; };

test.after(disposeScratchRoots);

test('B6: the F5_LIMIT boundary follows the policy scalar on disk', async () => {
  const modules = smallModule();
  const baseline = runProjection(modules);
  assert.equal(baseline.receipt.status, 'projected');
  assert.ok(baseline.receipt.workSteps > 1);
  const admitting = await projectUnderScratchPolicy(modules, setWorkSteps(baseline.receipt.workSteps));
  assert.equal(admitting.policy.profileLimits.maxWorkSteps, baseline.receipt.workSteps);
  assert.equal(admitting.result.receipt.status, 'projected', 'the exact crossing must project');
  assert.equal(admitting.result.receipt.workSteps, baseline.receipt.workSteps);
  const crossing = await projectUnderScratchPolicy(modules, setWorkSteps(baseline.receipt.workSteps - 1));
  assert.equal(crossing.result.receipt.status, 'fatal', 'one under the crossing must fail');
  assert.equal(crossing.result.receipt.diagnostics[0].code, 'F5_LIMIT');
  assert.equal(crossing.result.bytes, null);
});

test('B6: a scratch policy carrying the raised pair loads, validates and projects', async () => {
  const raised = await projectUnderScratchPolicy(smallModule(), (policy) => {
    policy.profileLimits.maxWorkSteps = RAISED_WORK_STEPS;
    policy.runtimeLimits.maxIterations = RAISED_WORK_STEPS;
  });
  assert.equal(raised.policy.profileLimits.maxWorkSteps, RAISED_WORK_STEPS);
  assert.equal(raised.result.receipt.status, 'projected');
});

test('B6: the scratch policy reaches the worker rather than the repository policy', async () => {
  const modules = smallModule();
  const baseline = runProjection(modules);
  const starved = await projectUnderScratchPolicy(modules, setWorkSteps(1));
  assert.equal(starved.result.receipt.status, 'fatal');
  assert.equal(starved.result.receipt.diagnostics[0].code, 'F5_LIMIT');
  assert.notEqual(starved.result.receipt.status, baseline.receipt.status,
    'a starved scratch policy must change the outcome, or the copy is not being read');
});
