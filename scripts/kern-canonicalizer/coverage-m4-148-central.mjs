import assert from 'node:assert/strict';

import {
  loadPublishedCanonicalizerResidualAnalysisM4148,
  measureCanonicalizerResidualAnalysisM4148,
} from './coverage-residual-analysis-m4-148.mjs';
import { formatM4148ResidualAnalysisStatus } from './coverage-status-m4-148.mjs';

const PUBLISHED_DIGEST = 'bf5b7c6886f7f114995f59d916f4a87ecc2ea3f7fffc5289448d7ebb32abde2f';

export function assertM4148ResidualAnalysis() {
  const handoff = loadPublishedCanonicalizerResidualAnalysisM4148();
  const analysis = handoff.record;
  assert.deepEqual(
    measureCanonicalizerResidualAnalysisM4148(),
    analysis,
    'live M4.148 remeasurement must exactly reproduce the published residual analysis',
  );
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '4115914127dc627edf8348af8a487ac1beae941a');
  assert.equal(analysis.baseline.baseCompleteFunctions, 111);
  assert.equal(analysis.baseline.residualFunctionCount, 1);
  assert.equal(analysis.assignments.length, 1);
  assert.equal(
    analysis.assignmentsDigest,
    'e953208c40e51714c3e0338455f67437fb6a6fda6c3f9fb42df0870dda003720',
  );
  assert.equal(analysis.frontier.profileRowsAvailableFunctions, 1);
  assert.equal(analysis.frontier.evaluatedObservedSettings, 0);
  assert.deepEqual(analysis.frontier.actionableCandidates, []);
  assert.equal(analysis.selectedNextAction, null);
  return formatM4148ResidualAnalysisStatus(analysis.selectedNextAction);
}
