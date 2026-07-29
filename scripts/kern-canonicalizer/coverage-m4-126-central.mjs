import assert from 'node:assert/strict';

import {
  loadPublishedCanonicalizerProjectionAnalysisM4126,
} from './projection-analysis-m4-126.mjs';
import { formatM4126ProjectionAnalysisStatus } from './coverage-status-m4-126.mjs';

const VALIDATE_ID = 'examples/selfhost-validator/validator.kern#20:validate';
const SELECTED_ACTION = {
  changedKirLimits: ['maxBytes', 'maxDepth', 'maxNodes'],
  changedProfileLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
  completeFunctions: 1,
  completeTools: 1,
  kirLimits: { maxBytes: 273051, maxDepth: 98, maxNodes: 5313 },
  migratedParameterRows: 41,
  profileLimits: { maxNodeRows: 202, maxPropertyRows: 308, maxValueRows: 4493 },
  totalDelta: 14422,
  witnesses: [VALIDATE_ID],
};

export function assertM4126ProjectionAnalysis() {
  const handoff = loadPublishedCanonicalizerProjectionAnalysisM4126();
  const analysis = handoff.record;
  assert.equal(
    handoff.digest,
    '25f1ba6ed40efdff909a6c95a11c385c12f9eba2b0025375ed4943f14393e369',
  );
  assert.equal(handoff.inputCommit, '9b5a5dc7c64a257356c412b6e1d98d85404d538b');
  assert.equal(
    analysis.input.assignmentDigest,
    'd56df2cc197c26f4c6f302c32e6447828e1e7359ba6f525f82bda5b6e2b5c481',
  );
  assert.deepEqual(analysis.input.baseKirLimits, {
    maxBytes: 262144,
    maxDepth: 77,
    maxNodes: 4096,
  });
  assert.deepEqual(analysis.input.profileLimits, {
    maxNodeRows: 122,
    maxPropertyRows: 193,
    maxValueRows: 2411,
  });
  assert.equal(analysis.requirements.length, 4);
  assert.deepEqual(analysis.summary, {
    observedSettings: 2,
    projectedFunctions: 2,
    unsupportedFunctions: 2,
  });
  assert.deepEqual(analysis.candidates, [SELECTED_ACTION]);
  assert.deepEqual(analysis.selectedNextAction, SELECTED_ACTION);
  return formatM4126ProjectionAnalysisStatus(analysis.selectedNextAction);
}
