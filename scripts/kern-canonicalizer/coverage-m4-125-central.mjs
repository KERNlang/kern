import assert from 'node:assert/strict';

import {
  loadPublishedCanonicalizerResidualAnalysisM4125,
} from './coverage-residual-analysis-m4-125.mjs';
import { formatM4125ResidualAnalysisStatus } from './coverage-status-m4-125.mjs';

export function assertM4125ResidualAnalysis() {
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4125();
  const analysis = handoff.record;
  assert.equal(
    handoff.digest,
    'eb2b075097025b9f91089a0587e84807279061801850b10402dd0978a2fe9652',
  );
  assert.equal(handoff.inputCommit, 'b2a722f43092ed16eeff45600dd8638fc53d4e05');
  assert.equal(analysis.baseline.baseCompleteFunctions, 103);
  assert.equal(analysis.baseline.residualFunctionCount, 4);
  assert.equal(analysis.assignments.length, 4);
  assert.equal(
    analysis.assignmentsDigest,
    'd56df2cc197c26f4c6f302c32e6447828e1e7359ba6f525f82bda5b6e2b5c481',
  );
  assert.equal(analysis.frontier.evaluatedObservedSettings, 0);
  assert.equal(analysis.frontier.profileRowsAvailableFunctions, 0);
  assert.deepEqual(analysis.frontier.actionableCandidates, []);
  assert.equal(analysis.selectedNextAction, null);
  return formatM4125ResidualAnalysisStatus(analysis.selectedNextAction);
}
