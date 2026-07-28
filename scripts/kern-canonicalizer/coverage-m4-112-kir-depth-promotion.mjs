import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadCanonicalizerKirDepthHeadroomM4111 } from './kir-depth-headroom-m4-111.mjs';
import { formatM4112KirDepthPromotionStatus } from './coverage-status.mjs';
import { loadPublishedCanonicalizerProjectionAnalysisM4110 } from './projection-analysis-m4-110.mjs';

const M4111_RECEIPT_DIGEST =
  '0acd91174c05caa96587876209abe1e3aa8744d3d8643204d07028c3e0526be9';
const ACTIVE_KIR_LIMITS = {
  maxBytes: 262_144,
  maxDepth: 76,
  maxNodes: 4_096,
};
const EXACT_KIR_POLICY = {
  maxBytes: 262_144,
  maxDepth: 76,
  maxNodes: 4_096,
  maxStringBytes: 8_192,
  maxCollectionLength: 1_024,
  maxRecordFields: 512,
  maxMapEntries: 64,
  maxIntegerDigits: 256,
  maxFractionDigits: 256,
  maxDecimalChars: 520,
};
const EXACT_RUNTIME_POLICY = {
  maxBytes: 2_097_152,
  maxCollectionLength: 65_536,
  maxDepth: 64,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxStringBytes: 1_048_576,
};
const EXACT_PROFILE = {
  maxNodeRows: 89,
  maxPropertyRows: 125,
  maxValueRows: 2_100,
};
const PARAMETER_MIGRATION = {
  completeFunctions: 9,
  completeTools: 4,
  migratedParameterRows: 134,
  witnesses: [
    {
      id: 'examples/capstone-assertion-engine/compare.kern#2:compareList',
      parameterRows: 13,
      profileRows: { nodes: 38, properties: 69, values: 432 },
      tool: 'assertion-engine',
    },
    {
      id: 'examples/capstone-assertion-engine/compare.kern#3:compareMap',
      parameterRows: 13,
      profileRows: { nodes: 44, properties: 78, values: 606 },
      tool: 'assertion-engine',
    },
    {
      id: 'examples/capstone-checker-subset/checker-while.kern#11:lengthReceiverProven',
      parameterRows: 12,
      profileRows: { nodes: 34, properties: 57, values: 464 },
      tool: 'checker',
    },
    {
      id: 'examples/capstone-checker-subset/checker-while.kern#9:numericBindingProven',
      parameterRows: 16,
      profileRows: { nodes: 54, properties: 80, values: 639 },
      tool: 'checker',
    },
    {
      id: 'examples/capstone-checker-subset/checker.kern#17:paramCallsitesOk',
      parameterRows: 23,
      profileRows: { nodes: 39, properties: 71, values: 325 },
      tool: 'checker',
    },
    {
      id: 'examples/capstone-checker-subset/checker.kern#20:mapKeyToken',
      parameterRows: 9,
      profileRows: { nodes: 21, properties: 33, values: 230 },
      tool: 'checker',
    },
    {
      id: 'examples/capstone-checker-subset/checker.kern#21:mapKnownBefore',
      parameterRows: 12,
      profileRows: { nodes: 31, properties: 48, values: 391 },
      tool: 'checker',
    },
    {
      id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#4:emitstatement',
      parameterRows: 15,
      profileRows: { nodes: 70, properties: 115, values: 1_377 },
      tool: 'canonicalizer',
    },
    {
      id: 'examples/selfhost-validator/validator.kern#15:exportkind',
      parameterRows: 21,
      profileRows: { nodes: 39, properties: 69, values: 483 },
      tool: 'validator',
    },
  ],
};

function receiptDigest() {
  return createHash('sha256')
    .update(readFileSync(new URL('./kir-depth-headroom-m4-111.json', import.meta.url)))
    .digest('hex');
}

export function m4112ActiveKirLimits() {
  return structuredClone(ACTIVE_KIR_LIMITS);
}

export function m4112ParameterMigration() {
  return structuredClone(PARAMETER_MIGRATION);
}

export function assertM4112KirDepthPromotion(policy) {
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4110().record;
  const headroom = loadCanonicalizerKirDepthHeadroomM4111();
  assert.equal(receiptDigest(), M4111_RECEIPT_DIGEST);
  assert.deepEqual(analysis.selectedNextAction, {
    changedLimits: ['maxDepth'],
    completeFunctions: PARAMETER_MIGRATION.completeFunctions,
    completeTools: PARAMETER_MIGRATION.completeTools,
    kirLimits: ACTIVE_KIR_LIMITS,
    migratedParameterRows: PARAMETER_MIGRATION.migratedParameterRows,
    totalDelta: 12,
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
    maxDepth: 64,
    maxNodes: ACTIVE_KIR_LIMITS.maxNodes,
  });
  assert.deepEqual(headroom.limits.candidateKir, ACTIVE_KIR_LIMITS);
  assert.deepEqual(headroom.promotion, {
    disposition: 'approved-with-headroom',
    kirDepthPromotionApproved: true,
    nextMilestone: 'M4.112',
    requiredDepth: ACTIVE_KIR_LIMITS.maxDepth,
  });
  assert.deepEqual(headroom.summary, {
    maxExactFloor: 31_028,
    minimumProductionHeadroom: 34_508,
    minimumPromotionHeadroom: 18_124,
    totalArtifactBytes: 334_655,
    totalParameterRows: PARAMETER_MIGRATION.migratedParameterRows,
    witnessCount: PARAMETER_MIGRATION.completeFunctions,
  });
  assert.deepEqual(policy.kirLimits, EXACT_KIR_POLICY);
  assert.deepEqual(policy.runtimeLimits, EXACT_RUNTIME_POLICY);
  assert.deepEqual(policy.profileLimits, EXACT_PROFILE);
  return m4112ActiveKirLimits();
}

export function m4112CoverageStatus(policy) {
  return formatM4112KirDepthPromotionStatus({
    kirLimits: assertM4112KirDepthPromotion(policy),
    parameterMigration: m4112ParameterMigration(),
  });
}
