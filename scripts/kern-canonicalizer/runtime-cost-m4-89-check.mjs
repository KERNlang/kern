import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadCanonicalizerDualRowHeadroomM488 } from './dual-row-headroom-m4-88.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { loadCanonicalizerRuntimeCostM489 } from './runtime-cost-m4-89.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function repositoryBytes(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url));
}

export function checkCanonicalizerRuntimeCostM489() {
  const baseline = loadCanonicalizerDualRowHeadroomM488();
  const receipt = loadCanonicalizerRuntimeCostM489();
  const policy = loadCanonicalizerPolicy();
  if (receipt.baseline.m488ReceiptSha256 !== digest(
    repositoryBytes('scripts/kern-canonicalizer/dual-row-headroom-m4-88.json'),
  )) {
    throw new Error('M4.89 must bind the exact M4.88 receipt bytes');
  }
  if (receipt.baseline.maxExactFloor !== baseline.summary.maxExactFloor) {
    throw new Error('M4.89 must consume the exact M4.88 maximum floor');
  }
  if (receipt.result.floorReduction < baseline.promotion.requiredFloorReduction) {
    throw new Error('M4.89 must satisfy the exact M4.88 required reduction');
  }
  if (receipt.result.maxExactFloor > receipt.limits.promotionBudget) {
    throw new Error('M4.89 maximum floor must fit the promotion budget');
  }
  if (receipt.source.canonicalizerCompositeSha256 !== digest(
    repositoryBytes('examples/kern-canonicalizer/canonicalizer.composed.kern'),
  )) {
    throw new Error('M4.89 must bind the live canonicalizer composite');
  }
  if (JSON.stringify(receipt.limits.activeProfile) !== JSON.stringify(policy.profileLimits)) {
    throw new Error('M4.89 must preserve the active profile');
  }
  return receipt;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const receipt = checkCanonicalizerRuntimeCostM489();
  process.stdout.write(
    `KERN canonicalizer M4.89 runtime cost: ${receipt.result.maxExactFloor} maximum floor, ` +
    `${receipt.result.floorReduction} steps removed, ${receipt.result.promotionHeadroom} promotion headroom.\n`,
  );
}
