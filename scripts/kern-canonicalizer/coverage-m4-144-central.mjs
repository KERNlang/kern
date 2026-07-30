import assert from 'node:assert/strict';

import {
  loadPublishedCanonicalizerProjectionAnalysisM4144,
  measureCanonicalizerProjectionAnalysisM4144,
} from './projection-analysis-m4-144.mjs';
import { formatM4144ProjectionAnalysisStatus } from './coverage-status-m4-144.mjs';

const PUBLISHED_DIGEST = '0aa57f2721cd76c9fed61ab5aaf22deccb868277e3627587712c92c907a6b086';

export function assertM4144ProjectionAnalysis() {
  const handoff = loadPublishedCanonicalizerProjectionAnalysisM4144();
  const analysis = handoff.record;
  assert.deepEqual(
    measureCanonicalizerProjectionAnalysisM4144(),
    analysis,
    'live M4.144 remeasurement must exactly reproduce the published projection analysis',
  );
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, 'e3cc1d133ef90c4e802d8df5318935e3c826398b');
  assert.deepEqual(analysis.input, {
    assignmentDigest: '1da9a57ec132a8147f75ab0d252e188aa86b2744b23d58cf3dfa3510b7bcc106',
    baseKirLimits: { maxBytes: 273_051, maxDepth: 98, maxNodes: 5_313 },
    inputCommit: 'e3cc1d133ef90c4e802d8df5318935e3c826398b',
    profileLimits: { maxNodeRows: 202, maxPropertyRows: 308, maxValueRows: 4_493 },
    residualAnalysisDigest: '22639a2453389244611a91560afcd8d03ecefca8874089015f338622e5ba6e3e',
    residualFunctions: 2,
  });
  assert.equal(analysis.requirements.length, 2);
  assert.deepEqual(analysis.summary, {
    canonicalSurfaceFunctions: 1,
    observedSettings: 1,
    projectedFunctions: 2,
    unsupportedFunctions: 0,
  });
  assert.equal(analysis.candidates.length, 1);
  assert.deepEqual(analysis.candidates[0], analysis.selectedNextAction);
  return formatM4144ProjectionAnalysisStatus(analysis.selectedNextAction);
}
