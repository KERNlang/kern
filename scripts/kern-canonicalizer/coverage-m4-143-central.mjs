import assert from 'node:assert/strict';

import {
  loadPublishedCanonicalizerResidualAnalysisM4143,
  measureCanonicalizerResidualAnalysisM4143,
} from './coverage-residual-analysis-m4-143.mjs';
import { formatM4143ResidualAnalysisStatus } from './coverage-status-m4-143.mjs';

const PUBLISHED_DIGEST = '22639a2453389244611a91560afcd8d03ecefca8874089015f338622e5ba6e3e';

export function assertM4143ResidualAnalysis() {
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4143();
  const analysis = handoff.record;
  assert.deepEqual(
    measureCanonicalizerResidualAnalysisM4143(),
    analysis,
    'live M4.143 remeasurement must exactly reproduce the published residual analysis',
  );
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '91a2fda256cc16b62bd2faf1f2fdfb8cf0581f90');
  assert.equal(analysis.baseline.baseCompleteFunctions, 110);
  assert.equal(analysis.baseline.residualFunctionCount, 2);
  assert.equal(analysis.assignments.length, 2);
  assert.equal(
    analysis.assignmentsDigest,
    '1da9a57ec132a8147f75ab0d252e188aa86b2744b23d58cf3dfa3510b7bcc106',
  );
  assert.equal(analysis.frontier.profileRowsAvailableFunctions, 1);
  assert.equal(analysis.frontier.evaluatedObservedSettings, 0);
  assert.deepEqual(analysis.frontier.actionableCandidates, []);
  assert.equal(analysis.selectedNextAction, null);
  return formatM4143ResidualAnalysisStatus(analysis.selectedNextAction);
}
