import assert from 'node:assert/strict';

import { loadPublishedCanonicalizerResidualAnalysisM4114 } from './coverage-residual-analysis-m4-114.mjs';
import { formatM4114ResidualAnalysisStatus } from './coverage-status.mjs';

const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2411 },
  totalDelta: 412,
  witnesses: [
    'examples/capstone-checker-subset/checker.kern#24:checkModule',
  ],
};

export function assertM4114ResidualAnalysis() {
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4114();
  const analysis = handoff.record;
  assert.equal(
    handoff.digest,
    '23fd8f52fa70e2a72fb4b4b1b7ae4c477b369a5f46853691b86b7506a9717e0c',
  );
  assert.equal(handoff.inputCommit, '2cb03f0e84f6c586dd28404d331a67dd2bb839bb');
  assert.equal(analysis.assignments.length, 6);
  assert.equal(
    analysis.assignmentsDigest,
    '7922f23766d95c5492800a9ae2b5f66217027a0214e716a0f6c96efb1c6ebb55',
  );
  assert.equal(analysis.frontier.evaluatedObservedSettings, 1);
  assert.equal(analysis.frontier.profileRowsAvailableFunctions, 1);
  assert.deepEqual(analysis.frontier.actionableCandidates, [EXPECTED_SELECTION]);
  assert.deepEqual(analysis.selectedNextAction, EXPECTED_SELECTION);
  return formatM4114ResidualAnalysisStatus(analysis.selectedNextAction);
}
