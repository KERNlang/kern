import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadPublishedCanonicalizerResidualAnalysisM478 } from './coverage-residual-analysis-m4-78.mjs';
import { loadCanonicalizerPropertyRowHeadroomM479 } from './property-row-headroom-m4-79.mjs';

const RECEIPT_URL = new URL('./property-row-headroom-m4-79.json', import.meta.url);
const RECEIPT_DIGEST = 'd8683f1440e8bb0f8496ab1845c83c7dabe73dbfd26114b78685d8c8e1cf830b';

export function assertCanonicalizerPropertyRowHeadroomM479() {
  assert.equal(
    createHash('sha256').update(readFileSync(RECEIPT_URL)).digest('hex'),
    RECEIPT_DIGEST,
    'M4.79 receipt bytes must remain exact',
  );
  const analysis = loadPublishedCanonicalizerResidualAnalysisM478();
  assert.equal(analysis.digest, 'f63342ef1f4b2754add412232fd4cf24758b0a0f77b8522361ea2f66cd1fadc2');
  assert.equal(analysis.inputCommit, '2ee34545f1a97acd5889f95e52bdd0952eb362bd');
  assert.deepEqual(analysis.record.selectedNextAction, {
    changedLimits: ['maxPropertyRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 461 },
    totalDelta: 8,
    witnesses: ['examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore'],
  });

  const receipt = loadCanonicalizerPropertyRowHeadroomM479();
  assert.equal(receipt.format, 'kern.kir-canonicalizer.property-row-headroom.2');
  assert.deepEqual(receipt.limits, {
    candidateProfile: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 461 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.promotion, {
    disposition: 'rejected-over-budget',
    nextMilestone: 'M4.80',
    requiredFloorReduction: 7_086,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 56_238,
    minimumProductionHeadroom: 9_298,
    promotionBudgetDeficit: 7_086,
    witnessCount: 1,
  });
  assert.deepEqual(receipt.witnesses, [{
    belowFloorOutcome: 'failure',
    exactFloor: 56_238,
    floorOutcome: 'success',
    id: 'examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore',
    parameterRows: 22,
    productionHeadroom: 9_298,
    profileRows: { nodes: 38, properties: 61, values: 460 },
    promotionBudgetDeficit: 7_086,
    roundTrip: true,
  }]);
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.deepEqual(receipt.source, {
    canonicalizerCompositeSha256: '974b8d3ba6fefac4861152be88181c176feda56df9aa820e9f8d3a89e0488f8d',
    canonicalizerPolicySha256: 'ac4983323d0e9da875e75ae12aff079d8d52deee069d77f703280a06f2f42244',
    compositionSha256: '2e8a4f77f6f343e7a16b42522b74afce3fd91272df3261431cb8e8950c17105d',
    inputSourceSha256: [{
      path: 'examples/capstone-checker-subset/checker-while.kern',
      sha256: '84ca20346a655595cbaab095e3b46b964e46acabd90ead29d1d1a3c6813e8b60',
    }],
    publishedCoverageImplementationDigest: 'c8d4a6f063c0021993022ccc5a05360717311fef8934c774a1aee49c86305ea8',
    publishedCoverageSummarySha256: 'e47d481662172a8dbbdd0605f284f2248f9b6631e8653a189117a37d806d4ec7',
    publishedInputCommit: '07c896900a49d9abd6b5bb4946ee891a97684575',
    publishedPrerequisiteSummarySha256: '4c65daf66262f22bd476638a67976b5461f9ae9383e122c0025a7f05eb90fc4f',
    residualAnalysisInputCommit: '2ee34545f1a97acd5889f95e52bdd0952eb362bd',
    residualAnalysisSha256: 'f63342ef1f4b2754add412232fd4cf24758b0a0f77b8522361ea2f66cd1fadc2',
    runtimeHandlerAbi: 'kern.runtime.handler.v1',
    structuralKirCodecSha256: '04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab',
  });
  return receipt;
}
