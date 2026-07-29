import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  formatM4130CombinedPromotionStatus,
} from './coverage-status-m4-130.mjs';
import {
  loadPublishedCanonicalizerProjectionAnalysisM4126,
} from './projection-analysis-m4-126.mjs';
import {
  loadCanonicalizerRuntimeCostM4129,
} from './runtime-cost-m4-129.mjs';

const M4126_RECEIPT_DIGEST =
  '25f1ba6ed40efdff909a6c95a11c385c12f9eba2b0025375ed4943f14393e369';
const M4129_RECEIPT_DIGEST =
  'e4bd57760198241cbe295ef6dcc7e35b1b7ddbb41026ca066d4016de0cfccd7c';
const ACTIVE_KIR_LIMITS = {
  maxBytes: 273_051,
  maxDepth: 98,
  maxNodes: 5_313,
};
const ACTIVE_PROFILE = {
  maxNodeRows: 202,
  maxPropertyRows: 308,
  maxValueRows: 4_493,
};
const ACTIVE_RUNTIME_BYTE_LIMITS = {
  maxBytes: 2_184_408,
  maxStringBytes: 1_092_204,
};
const EXACT_KIR_POLICY = {
  maxBytes: 273_051,
  maxDepth: 98,
  maxNodes: 5_313,
  maxStringBytes: 8_192,
  maxCollectionLength: 1_024,
  maxRecordFields: 512,
  maxMapEntries: 64,
  maxIntegerDigits: 256,
  maxFractionDigits: 256,
  maxDecimalChars: 520,
};
const EXACT_RUNTIME_POLICY = {
  maxBytes: ACTIVE_RUNTIME_BYTE_LIMITS.maxBytes,
  maxCollectionLength: 65_536,
  maxDepth: 64,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxStringBytes: ACTIVE_RUNTIME_BYTE_LIMITS.maxStringBytes,
};
const PARAMETER_MIGRATION = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 41,
  witnesses: [{
    id: 'examples/selfhost-validator/validator.kern#20:validate',
    parameterRows: 41,
    profileRows: { nodes: 202, properties: 308, values: 4_493 },
    tool: 'validator',
  }],
};

function m4129ReceiptDigest() {
  return createHash('sha256')
    .update(readFileSync(new URL('./runtime-cost-m4-129.json', import.meta.url)))
    .digest('hex');
}

export function m4130ActiveKirLimits() {
  return structuredClone(ACTIVE_KIR_LIMITS);
}

export function m4130ActiveProfile() {
  return structuredClone(ACTIVE_PROFILE);
}

export function m4130ActiveRuntimeByteLimits() {
  return structuredClone(ACTIVE_RUNTIME_BYTE_LIMITS);
}

export function m4130ParameterMigration() {
  return structuredClone(PARAMETER_MIGRATION);
}

export function assertM4130CombinedPromotion(policy) {
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4126();
  const runtime = loadCanonicalizerRuntimeCostM4129();
  assert.equal(analysis.digest, M4126_RECEIPT_DIGEST);
  assert.equal(m4129ReceiptDigest(), M4129_RECEIPT_DIGEST);
  assert.deepEqual(analysis.record.selectedNextAction, {
    changedKirLimits: ['maxBytes', 'maxDepth', 'maxNodes'],
    changedProfileLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    completeFunctions: PARAMETER_MIGRATION.completeFunctions,
    completeTools: PARAMETER_MIGRATION.completeTools,
    kirLimits: ACTIVE_KIR_LIMITS,
    migratedParameterRows: PARAMETER_MIGRATION.migratedParameterRows,
    profileLimits: ACTIVE_PROFILE,
    totalDelta: 14_422,
    witnesses: PARAMETER_MIGRATION.witnesses.map(({ id }) => id),
  });
  assert.deepEqual(
    analysis.record.requirements
      .filter(({ id }) => analysis.record.selectedNextAction.witnesses.includes(id))
      .map(({ id, parameterRows, profileRows, tool }) => ({
        id,
        parameterRows,
        profileRows,
        tool,
      })),
    PARAMETER_MIGRATION.witnesses,
  );
  assert.deepEqual(runtime.limits.candidateKir, ACTIVE_KIR_LIMITS);
  assert.deepEqual(runtime.limits.candidateProfile, ACTIVE_PROFILE);
  assert.deepEqual(runtime.promotion, {
    combinedPromotionApproved: false,
    disposition: 'promotion-budget-headroom-authenticated',
    nextMilestone: 'M4.130',
    promotionReady: true,
  });
  assert.deepEqual(runtime.result, {
    belowFloor: 45_907,
    belowFloorOutcome: 'failure',
    exactFloor: 45_908,
    floorOutcome: 'success',
    floorReduction: 8_986,
    productionHeadroom: 19_628,
    promotionBudgetHeadroom: 3_244,
    roundTrip: true,
  });
  assert.deepEqual(runtime.optimization, {
    exactFloorReduction: 8_986,
    recordfieldExecutions: 0,
    removedRecordfieldIterations: 8_986,
    runtimeEngineChanged: false,
    strategy: 'reuse-authenticated-type-field-projection-for-assignment-target-kind',
    tableWideLoopAdded: false,
    typefieldTableProjectionExecutions: 1,
  });
  assert.deepEqual(policy.kirLimits, EXACT_KIR_POLICY);
  assert.deepEqual(policy.profileLimits, ACTIVE_PROFILE);
  assert.deepEqual(policy.runtimeLimits, EXACT_RUNTIME_POLICY);
  assert.deepEqual(policy.expansionLimits, {
    kirToSourceMaxFactor: 4,
    runtimeEnvelopeMaxFactor: 2,
  });
  assert.equal(
    policy.runtimeLimits.maxStringBytes,
    policy.kirLimits.maxBytes * policy.expansionLimits.kirToSourceMaxFactor,
  );
  assert.equal(
    policy.runtimeLimits.maxBytes,
    policy.runtimeLimits.maxStringBytes *
      policy.expansionLimits.runtimeEnvelopeMaxFactor,
  );
  return {
    kirLimits: m4130ActiveKirLimits(),
    profileLimits: m4130ActiveProfile(),
    runtimeByteLimits: m4130ActiveRuntimeByteLimits(),
  };
}

export function m4130CoverageStatus(policy) {
  assertM4130CombinedPromotion(policy);
  return formatM4130CombinedPromotionStatus({
    kirLimits: m4130ActiveKirLimits(),
    parameterMigration: m4130ParameterMigration(),
    profileLimits: m4130ActiveProfile(),
    runtimeByteLimits: m4130ActiveRuntimeByteLimits(),
  });
}
