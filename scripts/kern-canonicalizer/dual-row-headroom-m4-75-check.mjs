import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadPublishedCanonicalizerResidualAnalysisM474 } from './coverage-residual-analysis-m4-74.mjs';
import { loadPublishedCanonicalizerDualRowHeadroomM475 } from './dual-row-headroom-m4-75.mjs';

const RECEIPT_URL = new URL('./dual-row-headroom-m4-75.json', import.meta.url);
const RECEIPT_DIGEST = 'c70022af6c90620c9ade8c03cff85eba41c53966f515b5523bd774985cb877f6';

export function assertCanonicalizerDualRowHeadroomM475() {
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    RECEIPT_DIGEST,
    'M4.75 receipt bytes must remain exact',
  );
  const analysis = loadPublishedCanonicalizerResidualAnalysisM474();
  assert.equal(analysis.digest, 'dae5ecfb09bd07575a8436771ff770c6ea544ea5efecba16ae45010b8f0df6e0');
  assert.equal(analysis.inputCommit, '1fe7851101cf2a25e1aebfd561655bb458aec66b');
  assert.deepEqual(analysis.record.selectedNextAction, {
    changedLimits: ['maxNodeRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: { maxNodeRows: 38, maxPropertyRows: 53, maxValueRows: 461 },
    totalDelta: 80,
    witnesses: ['examples/kern-canonicalizer/canonicalizer.kern#0:typesource'],
  });

  const handoff = loadPublishedCanonicalizerDualRowHeadroomM475();
  assert.equal(handoff.digest, RECEIPT_DIGEST);
  assert.equal(handoff.sourceCommit, '177212fc4cc1ba0c15f04e1092657b4d335067e9');
  const receipt = handoff.record;
  assert.equal(receipt.format, 'kern.kir-canonicalizer.dual-row-headroom.3');
  assert.deepEqual(receipt.limits, {
    candidateProfile: { maxNodeRows: 38, maxPropertyRows: 53, maxValueRows: 461 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 46_255,
    minimumProductionHeadroom: 19_281,
    minimumPromotionHeadroom: 2_897,
    witnessCount: 1,
  });
  assert.deepEqual(receipt.witnesses, [{
    belowFloorOutcome: 'failure',
    exactFloor: 46_255,
    floorOutcome: 'success',
    id: 'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
    parameterRows: 6,
    productionHeadroom: 19_281,
    profileRows: { nodes: 38, properties: 51, values: 461 },
    promotionHeadroom: 2_897,
    roundTrip: true,
  }]);
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.deepEqual(receipt.source, {
    canonicalizerCompositeSha256: 'c1b42e6183731a757cdad7150339ec38090c11aeaa6404095ae16f34412a3b89',
    canonicalizerPolicySha256: 'a4b53907df9507d12606fafb1bbf42fd5e129589e389e5ac349c154a8e3ab964',
    compositionSha256: '25303c8fc07467fe5eb20dd0ba4b0e2aa074e4e133ace9919d4a82e8c6c87289',
    inputSourceSha256: [{
      path: 'examples/kern-canonicalizer/canonicalizer.kern',
      sha256: 'a04ae8f9af4f61c1560889277247963572de6a1c32c2f2cf63e4c341525b7019',
    }],
    publishedCoverageImplementationDigest: '025fbf7ea33aecf8e1ee36fc6ef2334fbb2a71641777660473953e9da38a36ee',
    publishedCoverageSummarySha256: '728cf911c27bd81ccbd466d9dbb2c3a7ef08fd7131eda446168cd05a8d8b3e2d',
    publishedInputCommit: 'b867c5d5b67917f7abc7cdc3da5c76b867c69cf5',
    publishedPrerequisiteSummarySha256: '57f140620f1d8b604b709708e7a2480d2e08311ab045f5c02a77b6d754f8b4be',
    residualAnalysisInputCommit: '1fe7851101cf2a25e1aebfd561655bb458aec66b',
    residualAnalysisSha256: 'dae5ecfb09bd07575a8436771ff770c6ea544ea5efecba16ae45010b8f0df6e0',
    runtimeHandlerAbi: 'kern.runtime.handler.v1',
    structuralKirCodecSha256: '04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab',
  });
  return receipt;
}
