import assert from 'node:assert/strict';

import {
  loadPublishedCanonicalizerRemediationAnalysisM4134,
} from './remediation-analysis-m4-134.mjs';
import { formatM4134RemediationAnalysisStatus } from './coverage-status-m4-134.mjs';

export function assertM4134RemediationAnalysis() {
  const handoff = loadPublishedCanonicalizerRemediationAnalysisM4134();
  const analysis = handoff.record;
  assert.equal(
    handoff.digest,
    '0023de4d890d0a1b25783f3a6f6ded2985285bb98664df210533744b6ac9e286',
  );
  assert.equal(handoff.inputCommit, '6222871ce7e8025a4654ff1b0d4c3a43afe3f494');
  assert.equal(
    analysis.input.projectionAnalysisDigest,
    '89da63518b22003642eabba46177dce3e835d2fde82aebfb4ebe10bd3273bf0a',
  );
  assert.equal(analysis.input.baseCompleteFunctions, 104);
  assert.equal(analysis.input.functionCount, 112);
  assert.equal(analysis.input.residualFunctions, 3);
  assert.equal(analysis.requirements.length, 3);
  assert.deepEqual(analysis.summary, {
    canonicalSurfaceFunctions: 1,
    constructorFunctions: 2,
    constructorOccurrences: 21,
    remediationCandidates: 2,
  });
  assert.equal(analysis.candidates.length, 2);
  assert.equal(analysis.selectedNextAction.id, 'bounded-new-expression-support');
  assert.equal(analysis.selectedNextAction.completeFunctions, 2);
  assert.equal(analysis.selectedNextAction.parameterRows, 21);
  return formatM4134RemediationAnalysisStatus(analysis.selectedNextAction);
}
