import assert from 'node:assert/strict';
import test from 'node:test';

import { formatM4132ResidualAnalysisStatus } from './coverage-status-m4-132.mjs';

test('M4.132 status reports bounded residual exhaustion and the M4.133 handoff', () => {
  assert.equal(
    formatM4132ResidualAnalysisStatus(null),
    'M4.132 published analysis found no actionable profile widening across the three-function ' +
      'residual frontier; M4.133 investigates projection and canonical-surface blockers.',
  );
  assert.throws(
    () => formatM4132ResidualAnalysisStatus({}),
    /M4\.132 residual analysis must not select a profile widening/u,
  );
});
