import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  formatM4122KirDepthHeadroomStatus,
} from './coverage-status-m4-122.mjs';
import {
  m4123CoverageStatus,
} from './coverage-m4-123-kir-depth-promotion.mjs';
import {
  m4124CoverageStatus,
} from './coverage-m4-124-parameter-migration.mjs';
import {
  loadCanonicalizerKirDepthHeadroomM4122,
} from './kir-depth-headroom-m4-122.mjs';

const RECEIPT_URL = new URL('./kir-depth-headroom-m4-122.json', import.meta.url);
const RECEIPT_DIGEST =
  'e9b5e413a81d5c2992cd31eb705728608407e934d0f7c5c3d765865e65ad290e';
const WITNESS_ID =
  'examples/capstone-checker-subset/checker.kern#2:rejectLine';

export function assertM4122KirDepthHeadroom() {
  const receipt = loadCanonicalizerKirDepthHeadroomM4122();
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    RECEIPT_DIGEST,
  );
  assert.deepEqual(receipt.limits, {
    activeKir: { maxBytes: 262_144, maxDepth: 76, maxNodes: 4_096 },
    candidateKir: { maxBytes: 262_144, maxDepth: 77, maxNodes: 4_096 },
    productionBudget: 65_536,
    profile: { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2_411 },
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
    runtimeMaxDepth: 64,
  });
  assert.deepEqual(receipt.promotion, {
    disposition: 'approved-with-headroom',
    kirDepthPromotionApproved: true,
    nextMilestone: 'M4.123',
    requiredDepth: 77,
  });
  assert.deepEqual(receipt.structuralBoundary, {
    belowCandidateDepth: 76,
    belowCandidateOutcome: 'failure',
    candidateDepth: 77,
    candidateOutcome: 'success',
    rejectedWitnesses: [WITNESS_ID],
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 1_007,
    minimumProductionHeadroom: 64_529,
    minimumPromotionHeadroom: 48_145,
    totalArtifactBytes: 7_725,
    totalParameterRows: 5,
    witnessCount: 1,
  });
  assert.deepEqual(receipt.witnesses, [{
    artifactBytes: 7_725,
    belowFloor: 1_006,
    belowFloorOutcome: 'failure',
    exactFloor: 1_007,
    floorOutcome: 'success',
    id: WITNESS_ID,
    parameterRows: 5,
    productionDelta: 64_529,
    promotionDelta: 48_145,
    publicParityVerified: true,
    requiredDepth: 77,
    roundTrip: true,
    structuralRows: { nodes: 8, properties: 15, values: 106 },
  }]);
  assert.equal(
    receipt.source.compiledCoreJavaScriptSha256,
    '502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec',
  );
  assert.equal(
    receipt.source.projectionAnalysisSha256,
    '2579208ec9759c7c31fc76d64dbbe4f09ac9852801506584e78450742a40f1b1',
  );
  assert.equal(
    receipt.source.publishedInputCommit,
    '7161086c0c2c03b3b12e05d3656138d61f374ab0',
  );
  return `${formatM4122KirDepthHeadroomStatus(receipt)} ${m4123CoverageStatus()} ` +
    m4124CoverageStatus();
}
