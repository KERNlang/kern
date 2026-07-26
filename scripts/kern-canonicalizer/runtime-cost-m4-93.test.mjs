import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import {
  loadCanonicalizerRuntimeCostM493,
  measureCanonicalizerRuntimeCostM493,
  validateCanonicalizerRuntimeCostM493,
} from './runtime-cost-m4-93.mjs';

const summaryUrl = new URL('./runtime-cost-m4-93.json', import.meta.url);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('M4.93 publishes the table-validation runtime-cost evidence', () => {
  const receipt = loadCanonicalizerRuntimeCostM493();
  assert.deepEqual(receipt, measureCanonicalizerRuntimeCostM493());
  assert.equal(receipt.format, 'kern.kir-canonicalizer.runtime-cost-reduction.3');
  assert.equal(receipt.baseline.m492ReceiptSha256, sha256(readFileSync(
    new URL('./coverage-residual-analysis-m4-92.json', import.meta.url),
  )));
  assert.equal(receipt.baseline.attemptedLoopEntries, 30_261);
  assert.deepEqual(receipt.result.optimizedLoopEntries, {
    nodeIndex: 53,
    propertyOwnershipIndex: 95,
    propertyIndex: 95,
    valueIndex: 832,
  });
  assert.equal(receipt.result.exactFloor, 1_075);
  assert.equal(receipt.result.belowFloor, 1_074);
  assert.equal(receipt.result.floorOutcome, 'success');
  assert.equal(receipt.result.belowFloorOutcome, 'failure');
  assert.equal(receipt.productionObservation.terminalEnvelopeObserved, false);
  assert.equal(receipt.productionObservation.outcome, 'not-claimed');
  assert.deepEqual(receipt.promotion, {
    disposition: 'table-replay-eliminated-parameter-queue-ready-headroom-unproven',
    nextMilestone: 'M4.94',
    parameterMigration: {
      completeFunctions: 1,
      completeTools: 1,
      migratedParameterRows: 12,
      witnesses: [{
        id: 'examples/kern-canonicalizer/canonicalizer.kern#4:tablesok',
        parameterRows: 12,
        profileRows: { nodes: 19, properties: 33, values: 156 },
        tool: 'canonicalizer',
      }],
    },
  });
  assert.equal(receipt.source.runtimeHandlerAbi, KERN_RUNTIME_HANDLER_ABI);
  assert.equal(
    receipt.source.structuralKirCodecSha256,
    sha256(readFileSync(new URL('../../packages/core/src/kir-structural/canonical.ts', import.meta.url))),
  );
  assert.equal(
    sha256(readFileSync(summaryUrl)),
    sha256(Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)),
  );
});

test('M4.93 rejects receipt drift, decoration, cycles, and shared references', () => {
  const receipt = measureCanonicalizerRuntimeCostM493();
  for (const mutate of [
    (copy) => { copy.result.exactFloor += 1; },
    (copy) => { copy.productionObservation.outcome = 'success'; },
    (copy) => { copy.promotion.nextMilestone = 'M4.95'; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeCostM493(copy),
      /coverage M4\.93 runtime-cost rejection/u,
    );
  }
  const decorated = structuredClone(receipt);
  decorated.extra = true;
  assert.throws(
    () => validateCanonicalizerRuntimeCostM493(decorated),
    /coverage M4\.93 runtime-cost rejection/u,
  );
  const cyclic = structuredClone(receipt);
  cyclic.result.self = cyclic;
  assert.throws(
    () => validateCanonicalizerRuntimeCostM493(cyclic),
    /coverage M4\.93 runtime-cost rejection/u,
  );
  const shared = structuredClone(receipt);
  shared.limits.activeProfile = shared.limits.candidateProfile;
  assert.throws(
    () => validateCanonicalizerRuntimeCostM493(shared),
    /coverage M4\.93 runtime-cost rejection/u,
  );
  const nonEnumerableElement = structuredClone(receipt);
  Object.defineProperty(nonEnumerableElement.optimization.helpers, '0', {
    enumerable: false,
    value: nonEnumerableElement.optimization.helpers[0],
  });
  assert.throws(
    () => validateCanonicalizerRuntimeCostM493(nonEnumerableElement),
    /coverage M4\.93 runtime-cost rejection/u,
  );
  const accessorElement = structuredClone(receipt);
  let getterCalls = 0;
  Object.defineProperty(accessorElement.optimization.helpers, '0', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return receipt.optimization.helpers[0];
    },
  });
  assert.throws(
    () => validateCanonicalizerRuntimeCostM493(accessorElement),
    /coverage M4\.93 runtime-cost rejection/u,
  );
  assert.equal(getterCalls, 0);
});
