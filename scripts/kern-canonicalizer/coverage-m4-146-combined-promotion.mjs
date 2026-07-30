import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  loadCanonicalizerCombinedHeadroomM4145,
} from './combined-headroom-m4-145.mjs';
import {
  formatM4146CombinedPromotionStatus,
} from './coverage-status-m4-146.mjs';

const RECEIPT_URL = new URL('./combined-headroom-m4-145.json', import.meta.url);
const M4145_RECEIPT_DIGEST =
  'e61beda6a311742d0475fdcd52ab0147cffe74300c1ee339ea79acceb3f147ba';
const ACTIVE_KIR_LIMITS = {
  maxBytes: 367_368,
  maxDepth: 122,
  maxNodes: 7_136,
};
const ACTIVE_PROFILE = {
  maxNodeRows: 205,
  maxPropertyRows: 332,
  maxValueRows: 6_304,
};
const ACTIVE_RUNTIME_BYTE_LIMITS = {
  maxBytes: 2_938_944,
  maxStringBytes: 1_469_472,
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
  migratedParameterRows: 6,
  witnesses: [{
    id: 'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
    parameterRows: 6,
    profileRows: { nodes: 205, properties: 332, values: 6_304 },
    tool: 'canonicalizer',
  }],
};

function receiptDigest() {
  return createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex');
}

export function m4146ActiveKirLimits() {
  return structuredClone(ACTIVE_KIR_LIMITS);
}

export function m4146ActiveProfile() {
  return structuredClone(ACTIVE_PROFILE);
}

export function m4146ActiveRuntimeByteLimits() {
  return structuredClone(ACTIVE_RUNTIME_BYTE_LIMITS);
}

export function m4146ParameterMigration() {
  return structuredClone(PARAMETER_MIGRATION);
}

export function assertM4146CombinedPromotion(policy) {
  const receipt = loadCanonicalizerCombinedHeadroomM4145();
  assert.equal(receiptDigest(), M4145_RECEIPT_DIGEST);
  assert.deepEqual(receipt.limits.candidateKir, ACTIVE_KIR_LIMITS);
  assert.deepEqual(receipt.limits.candidateProfile, ACTIVE_PROFILE);
  assert.deepEqual(receipt.limits.derivedRuntimeBytes, ACTIVE_RUNTIME_BYTE_LIMITS);
  assert.deepEqual(receipt.promotion, {
    combinedPromotionApproved: true,
    disposition: 'promotion-budget-headroom-authenticated',
    nextMilestone: 'M4.146',
    productionHeadroom: 22_482,
    promotionBudgetHeadroom: 6_098,
    promotionReady: true,
  });
  assert.deepEqual(receipt.measurement, {
    disposition: 'authenticated-evidence-only',
    kirPolicyChanged: false,
    profilePolicyChanged: false,
    runtimePolicyChanged: false,
  });
  assert.deepEqual(receipt.structuralBoundary, {
    candidateKir: ACTIVE_KIR_LIMITS,
    candidateOutcome: 'success',
    rejectedLimits: [
      { code: 'limit-bytes', limit: 367_367, name: 'maxBytes' },
      { code: 'limit-depth', limit: 121, name: 'maxDepth' },
      { code: 'limit-nodes', limit: 7_135, name: 'maxNodes' },
    ],
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 43_054,
    minimumProductionHeadroom: 22_482,
    minimumPromotionHeadroom: 6_098,
    totalArtifactBytes: 367_368,
    totalParameterRows: 6,
    witnessCount: 1,
  });
  assert.deepEqual(
    receipt.witnesses.map(({
      id,
      observerParityVerified,
      parameterRows,
      profileRows,
      publicParityVerified,
      roundTrip,
    }) => ({
      id,
      observerParityVerified,
      parameterRows,
      profileRows,
      publicParityVerified,
      roundTrip,
    })),
    PARAMETER_MIGRATION.witnesses.map(({
      id,
      parameterRows,
      profileRows,
    }) => ({
      id,
      observerParityVerified: true,
      parameterRows,
      profileRows,
      publicParityVerified: true,
      roundTrip: true,
    })),
  );
  assert.deepEqual(receipt.witnesses[0].loopIterations, {
    attemptedByType: { for: 42_666, while: 388 },
    attemptedTotal: 43_054,
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
    kirLimits: m4146ActiveKirLimits(),
    profileLimits: m4146ActiveProfile(),
    runtimeByteLimits: m4146ActiveRuntimeByteLimits(),
  };
}

export function m4146CoverageStatus(policy) {
  assertM4146CombinedPromotion(policy);
  return formatM4146CombinedPromotionStatus({
    kirLimits: m4146ActiveKirLimits(),
    parameterMigration: m4146ParameterMigration(),
    profileLimits: m4146ActiveProfile(),
    runtimeByteLimits: m4146ActiveRuntimeByteLimits(),
  });
}
