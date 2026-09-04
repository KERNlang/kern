import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  formatM4123KirDepthPromotionStatus,
} from './coverage-status-m4-123.mjs';
import { loadCanonicalizerKirDepthHeadroomM4122 } from './kir-depth-headroom-m4-122.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { loadPublishedCanonicalizerProjectionAnalysisM4121 } from './projection-analysis-m4-121.mjs';

const M4122_RECEIPT_DIGEST =
  'e9b5e413a81d5c2992cd31eb705728608407e934d0f7c5c3d765865e65ad290e';
const ACTIVE_KIR_LIMITS = {
  maxBytes: 262_144,
  maxDepth: 77,
  maxNodes: 4_096,
};
const EXACT_KIR_POLICY = {
  maxBytes: 367_368,
  maxDepth: 122,
  maxNodes: 7_136,
  maxStringBytes: 8_192,
  maxCollectionLength: 1_024,
  maxRecordFields: 512,
  maxMapEntries: 64,
  maxIntegerDigits: 256,
  maxFractionDigits: 256,
  maxDecimalChars: 520,
};
const EXACT_RUNTIME_POLICY = {
  maxBytes: 2_938_944,
  maxCollectionLength: 65_536,
  maxDepth: 64,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxIterations: 65_536,
  maxStringBytes: 1_469_472,
};
const EXACT_PROFILE = {
  maxNodeRows: 205,
  maxPropertyRows: 332,
  maxValueRows: 6_304,
};
const PARAMETER_MIGRATION = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 5,
  witnesses: [{
    id: 'examples/capstone-checker-subset/checker.kern#2:rejectLine',
    parameterRows: 5,
    profileRows: { nodes: 8, properties: 15, values: 106 },
    tool: 'checker',
  }],
};

function receiptDigest() {
  return createHash('sha256')
    .update(readFileSync(new URL('./kir-depth-headroom-m4-122.json', import.meta.url)))
    .digest('hex');
}

export function m4123ActiveKirLimits() {
  return structuredClone(ACTIVE_KIR_LIMITS);
}

export function m4123ParameterMigration() {
  return structuredClone(PARAMETER_MIGRATION);
}

export function assertM4123KirDepthPromotion(policy) {
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4121().record;
  const headroom = loadCanonicalizerKirDepthHeadroomM4122();
  assert.equal(receiptDigest(), M4122_RECEIPT_DIGEST);
  assert.deepEqual(analysis.selectedNextAction, {
    changedLimits: ['maxDepth'],
    completeFunctions: PARAMETER_MIGRATION.completeFunctions,
    completeTools: PARAMETER_MIGRATION.completeTools,
    kirLimits: ACTIVE_KIR_LIMITS,
    migratedParameterRows: PARAMETER_MIGRATION.migratedParameterRows,
    totalDelta: 1,
    witnesses: PARAMETER_MIGRATION.witnesses.map(({ id }) => id),
  });
  assert.deepEqual(
    analysis.requirements
      .filter(({ id }) => analysis.selectedNextAction.witnesses.includes(id))
      .map(({ id, parameterRows, profileRows, tool }) => ({
        id,
        parameterRows,
        profileRows,
        tool,
      })),
    PARAMETER_MIGRATION.witnesses,
  );
  assert.deepEqual(headroom.limits.activeKir, {
    maxBytes: ACTIVE_KIR_LIMITS.maxBytes,
    maxDepth: 76,
    maxNodes: ACTIVE_KIR_LIMITS.maxNodes,
  });
  assert.deepEqual(headroom.limits.candidateKir, ACTIVE_KIR_LIMITS);
  assert.deepEqual(headroom.promotion, {
    disposition: 'approved-with-headroom',
    kirDepthPromotionApproved: true,
    nextMilestone: 'M4.123',
    requiredDepth: ACTIVE_KIR_LIMITS.maxDepth,
  });
  assert.deepEqual(headroom.summary, {
    maxExactFloor: 1_007,
    minimumProductionHeadroom: 64_529,
    minimumPromotionHeadroom: 48_145,
    totalArtifactBytes: 7_725,
    totalParameterRows: PARAMETER_MIGRATION.migratedParameterRows,
    witnessCount: PARAMETER_MIGRATION.completeFunctions,
  });
  assert.deepEqual(policy.kirLimits, EXACT_KIR_POLICY);
  assert.deepEqual(policy.runtimeLimits, EXACT_RUNTIME_POLICY);
  assert.deepEqual(policy.profileLimits, EXACT_PROFILE);
  return m4123ActiveKirLimits();
}

export function m4123CoverageStatus(policy = loadCanonicalizerPolicy()) {
  return formatM4123KirDepthPromotionStatus({
    kirLimits: assertM4123KirDepthPromotion(policy),
    parameterMigration: m4123ParameterMigration(),
  });
}
