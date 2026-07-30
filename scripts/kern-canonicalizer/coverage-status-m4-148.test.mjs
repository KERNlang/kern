import assert from 'node:assert/strict';
import test from 'node:test';

import { formatM4148ResidualAnalysisStatus } from './coverage-status-m4-148.mjs';

test('M4.148 status reports exact residual exhaustion and the M4.149 handoff', () => {
  assert.equal(
    formatM4148ResidualAnalysisStatus(null),
    'M4.148 publishes the exact one-function quotesource residual analysis with no actionable ' +
      'profile widening; M4.149 investigates the six canonical-surface text-character blockers.',
  );
  assert.throws(
    () => formatM4148ResidualAnalysisStatus({}),
    /M4\.148 residual analysis must not select a profile widening/u,
  );
});
