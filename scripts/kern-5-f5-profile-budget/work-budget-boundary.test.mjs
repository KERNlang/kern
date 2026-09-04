import assert from 'node:assert/strict';
import test from 'node:test';

import { projectKernModules } from '../../packages/core/dist/frontend-projection.js';
import { __test, runProjection } from '../kern-frontend-f5-projection/worker.mjs';
import {
  ASSET_MANIFEST_PATH,
  BASE_WORK_STEPS,
  F5_POLICY_PATH,
  RAISED_WORK_STEPS,
  assetManifest,
  bytes,
  policy,
  sha256,
  smallModule,
} from './support.mjs';

test('B3: charged work steps are invariant under the digit width of maxWorkSteps', () => {
  const modules = smallModule();
  const baseline = runProjection(modules);
  assert.equal(baseline.receipt.status, 'projected');
  assert.ok(baseline.receipt.workSteps > 1);
  for (const cap of [BASE_WORK_STEPS, RAISED_WORK_STEPS, 1_073_741_824]) {
    const result = __test.runProjectionWithProfileLimits(modules, { maxWorkSteps: cap });
    assert.equal(result.receipt.status, 'projected', `cap ${cap} status`);
    assert.equal(result.receipt.workSteps, baseline.receipt.workSteps, `cap ${cap} charged work`);
  }
});

test('B3: the F5_LIMIT gate still fires on the exact crossing', () => {
  const modules = smallModule();
  const baseline = runProjection(modules);
  const exact = __test.runProjectionWithProfileLimits(modules, { maxWorkSteps: baseline.receipt.workSteps });
  assert.equal(exact.receipt.status, 'projected');
  const crossing = __test.runProjectionWithProfileLimits(modules, { maxWorkSteps: baseline.receipt.workSteps - 1 });
  assert.equal(crossing.receipt.status, 'fatal');
  assert.equal(crossing.receipt.diagnostics[0].code, 'F5_LIMIT');
  assert.equal(crossing.bytes, null);
});

test('B3: the packaged manifest carries the raised ceiling and the live policy digest', () => {
  const manifest = assetManifest();
  assert.equal(manifest.profileLimits.maxWorkSteps, RAISED_WORK_STEPS);
  assert.equal(manifest.f5PolicyDigest, sha256(bytes(F5_POLICY_PATH)),
    `${ASSET_MANIFEST_PATH} is stale — rebuild the projection assets`);
});

test('B3: a public caller may request a budget between the old and the new cap', async () => {
  const modules = smallModule();
  const shipped = policy().profileLimits.maxWorkSteps;
  const admitted = await projectKernModules({ budgets: { maxWorkSteps: RAISED_WORK_STEPS }, modules });
  assert.equal(admitted.status, 'projected', 'the raised cap must be requestable');
  const refused = await projectKernModules({ budgets: { maxWorkSteps: shipped + 1 }, modules });
  assert.equal(refused.status, 'rejected');
  assert.equal(refused.diagnostics[0].code, 'projection-request-invalid');
});
