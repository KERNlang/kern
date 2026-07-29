import assert from 'node:assert/strict';

import { loadPublishedCanonicalizerResidualAnalysisM4120 } from './coverage-residual-analysis-m4-120.mjs';
import { formatM4120ResidualAnalysisStatus } from './coverage-status.mjs';

export function assertM4120ResidualAnalysis() {
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4120();
  const analysis = handoff.record;
  assert.equal(
    handoff.digest,
    '02789e8cc4f0fff5da641942cf1716e5fdc6c71975170afd82524fccef487bc5',
  );
  assert.equal(handoff.inputCommit, '2ffe06f0c31e7b6cbdea62f47df97f5a94b66dad');
  assert.equal(analysis.baseline.baseCompleteFunctions, 102);
  assert.equal(analysis.baseline.residualFunctionCount, 5);
  assert.equal(analysis.assignments.length, 5);
  assert.equal(
    analysis.assignmentsDigest,
    '7590a3a7dbc3bbd11ca4a05c81e52a907d8cdd5619e4b2a78e198975673c84fe',
  );
  assert.equal(analysis.frontier.evaluatedObservedSettings, 0);
  assert.equal(analysis.frontier.profileRowsAvailableFunctions, 0);
  assert.deepEqual(analysis.frontier.actionableCandidates, []);
  assert.equal(analysis.selectedNextAction, null);
  return formatM4120ResidualAnalysisStatus(analysis.selectedNextAction);
}
