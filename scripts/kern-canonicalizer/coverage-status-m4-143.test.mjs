import assert from 'node:assert/strict';
import test from 'node:test';

import { formatM4143ResidualAnalysisStatus } from './coverage-status-m4-143.mjs';

test('M4.143 status reports bounded residual exhaustion and the M4.144 handoff', () => {
  assert.equal(
    formatM4143ResidualAnalysisStatus(null),
    'M4.143 published analysis found no actionable profile widening across the two-function ' +
      'residual frontier; M4.144 investigates structural projection and canonical-surface ' +
      'blockers.',
  );
  assert.throws(
    () => formatM4143ResidualAnalysisStatus({}),
    /M4\.143 residual analysis must not select a profile widening/u,
  );
});
