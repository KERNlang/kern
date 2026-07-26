import assert from 'node:assert/strict';

import { loadCanonicalizerDualRowHeadroomM488 } from './dual-row-headroom-m4-88.mjs';
import { loadCanonicalizerRuntimeCostM489 } from './runtime-cost-m4-89.mjs';

export function verifyCanonicalizerDualRowWitnessM488(index) {
  const historical = loadCanonicalizerDualRowHeadroomM488().witnesses[index];
  const optimized = loadCanonicalizerRuntimeCostM489().witnesses[index];
  assert.ok(historical);
  assert.ok(optimized);
  assert.equal(optimized.id, historical.id);
  assert.equal(optimized.parameterRows, historical.parameterRows);
  assert.deepEqual(optimized.profileRows, historical.profileRows);
  assert.equal(optimized.baselineExactFloor, historical.exactFloor);
  assert.equal(optimized.floorReduction, historical.exactFloor - optimized.exactFloor);
  assert.equal(historical.belowFloorOutcome, 'failure');
  assert.equal(historical.floorOutcome, 'success');
  assert.equal(historical.roundTrip, true);
}

export function verifyCanonicalizerDualRowPolicyM488() {
  const historical = loadCanonicalizerDualRowHeadroomM488();
  const optimized = loadCanonicalizerRuntimeCostM489();
  assert.deepEqual(historical.measurement, {
    disposition: 'diagnostic-only',
    runtimePolicyChanged: false,
  });
  assert.deepEqual(historical.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.equal(optimized.limits.productionMaxCollectionLength, 65_536);
  assert.equal(optimized.limits.maxDepth, 64);
}
