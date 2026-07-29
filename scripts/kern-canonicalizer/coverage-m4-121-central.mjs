import assert from 'node:assert/strict';

import { formatM4121ProjectionAnalysisStatus } from './coverage-status.mjs';
import {
  assertM4122KirDepthHeadroom,
} from './coverage-m4-122-central.mjs';
import { loadPublishedCanonicalizerProjectionAnalysisM4121 } from './projection-analysis-m4-121.mjs';

export function assertM4121ProjectionAnalysis() {
  const handoff = loadPublishedCanonicalizerProjectionAnalysisM4121();
  const analysis = handoff.record;
  assert.equal(
    handoff.digest,
    '2579208ec9759c7c31fc76d64dbbe4f09ac9852801506584e78450742a40f1b1',
  );
  assert.equal(handoff.inputCommit, '195e3fbadc48146c520a5cbcfcbb1b3567db2717');
  assert.equal(
    analysis.input.assignmentDigest,
    '7590a3a7dbc3bbd11ca4a05c81e52a907d8cdd5619e4b2a78e198975673c84fe',
  );
  assert.deepEqual(analysis.input.baseKirLimits, {
    maxBytes: 262144,
    maxDepth: 76,
    maxNodes: 4096,
  });
  assert.equal(analysis.requirements.length, 5);
  assert.equal(analysis.summary.observedSettings, 3);
  assert.equal(analysis.summary.projectedFunctions, 3);
  assert.equal(analysis.summary.unsupportedFunctions, 2);
  assert.equal(analysis.candidates.length, 3);
  assert.deepEqual(analysis.selectedNextAction, {
    changedLimits: ['maxDepth'],
    completeFunctions: 1,
    completeTools: 1,
    kirLimits: { maxBytes: 262144, maxDepth: 77, maxNodes: 4096 },
    migratedParameterRows: 5,
    totalDelta: 1,
    witnesses: [
      'examples/capstone-checker-subset/checker.kern#2:rejectLine',
    ],
  });
  return `${formatM4121ProjectionAnalysisStatus(analysis.selectedNextAction)} ` +
    assertM4122KirDepthHeadroom();
}
