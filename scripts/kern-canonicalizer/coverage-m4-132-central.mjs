import assert from 'node:assert/strict';

import {
  loadPublishedCanonicalizerResidualAnalysisM4132,
} from './coverage-residual-analysis-m4-132.mjs';
import { formatM4132ResidualAnalysisStatus } from './coverage-status-m4-132.mjs';

export function assertM4132ResidualAnalysis() {
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4132();
  const analysis = handoff.record;
  assert.equal(
    handoff.digest,
    '1f260e985d3fd8990a387da07144eca4f59c22a3133407b6c408e26e597b521e',
  );
  assert.equal(handoff.inputCommit, 'a92fb14e79cd40fcab8f1c071a2561149028021a');
  assert.equal(analysis.baseline.baseCompleteFunctions, 104);
  assert.equal(analysis.baseline.residualFunctionCount, 3);
  assert.equal(analysis.assignments.length, 3);
  assert.equal(
    analysis.assignmentsDigest,
    'a3383dd12d41a3beaca9bf9c0de49ddadc9333c99ca7b14162e0a01ebdb0d338',
  );
  assert.equal(analysis.frontier.profileRowsAvailableFunctions, 1);
  assert.equal(analysis.frontier.evaluatedObservedSettings, 0);
  assert.deepEqual(analysis.frontier.actionableCandidates, []);
  assert.equal(analysis.selectedNextAction, null);
  return formatM4132ResidualAnalysisStatus(analysis.selectedNextAction);
}
