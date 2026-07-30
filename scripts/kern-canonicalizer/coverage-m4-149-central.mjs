import assert from 'node:assert/strict';

import {
  loadPublishedCanonicalizerSurfaceAnalysisM4149,
  measureCanonicalizerSurfaceAnalysisM4149,
} from './canonical-surface-analysis-m4-149.mjs';
import { formatM4149CanonicalSurfaceStatus } from './coverage-status-m4-149.mjs';

const PUBLISHED_DIGEST = 'bca47b2e75cd13cbbaa3b54e7e98e92f515e44f15cf92e3edea8c8c6bf59dc1d';

export function assertM4149CanonicalSurfaceAnalysis() {
  const handoff = loadPublishedCanonicalizerSurfaceAnalysisM4149();
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '44ca4feda2901c16f79c7c5c40ede69394e60404');
  assert.deepEqual(
    measureCanonicalizerSurfaceAnalysisM4149(),
    handoff.record,
    'live M4.149 measurement must reproduce the published canonical-surface analysis',
  );
  assert.deepEqual(handoff.record.candidate.profileBlockers, []);
  assert.deepEqual(handoff.record.candidate.profileRows, {
    nodes: 54,
    properties: 82,
    values: 932,
  });
  assert.equal(handoff.record.candidate.parameterRows, 2);
  return formatM4149CanonicalSurfaceStatus(
    handoff.record.selectedNextAction,
    handoff.record.candidate.equivalence,
  );
}
