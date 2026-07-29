import assert from 'node:assert/strict';

import {
  loadPublishedCanonicalizerProjectionAnalysisM4133,
} from './projection-analysis-m4-133.mjs';
import { formatM4133ProjectionAnalysisStatus } from './coverage-status-m4-133.mjs';

export function assertM4133ProjectionAnalysis() {
  const handoff = loadPublishedCanonicalizerProjectionAnalysisM4133();
  const analysis = handoff.record;
  assert.equal(
    handoff.digest,
    '89da63518b22003642eabba46177dce3e835d2fde82aebfb4ebe10bd3273bf0a',
  );
  assert.equal(handoff.inputCommit, '0899f689fbe1b91471d89b380447f3bcf27dd3a0');
  assert.equal(
    analysis.input.residualAnalysisDigest,
    '1f260e985d3fd8990a387da07144eca4f59c22a3133407b6c408e26e597b521e',
  );
  assert.equal(
    analysis.input.assignmentDigest,
    'a3383dd12d41a3beaca9bf9c0de49ddadc9333c99ca7b14162e0a01ebdb0d338',
  );
  assert.deepEqual(analysis.input.baseKirLimits, {
    maxBytes: 273_051,
    maxDepth: 98,
    maxNodes: 5_313,
  });
  assert.deepEqual(analysis.input.profileLimits, {
    maxNodeRows: 202,
    maxPropertyRows: 308,
    maxValueRows: 4_493,
  });
  assert.equal(analysis.input.residualFunctions, 3);
  assert.equal(analysis.requirements.length, 3);
  assert.deepEqual(analysis.summary, {
    canonicalSurfaceFunctions: 1,
    observedSettings: 0,
    projectedFunctions: 1,
    unsupportedFunctions: 2,
  });
  assert.deepEqual(analysis.candidates, []);
  assert.equal(analysis.selectedNextAction, null);
  return formatM4133ProjectionAnalysisStatus(analysis.selectedNextAction);
}
