import assert from 'node:assert/strict';
import test from 'node:test';

import { formatM4133ProjectionAnalysisStatus } from './coverage-status-m4-133.mjs';

test('M4.133 status reports the bounded projection frontier and M4.134 handoff', () => {
  assert.equal(
    formatM4133ProjectionAnalysisStatus(null),
    'M4.133 projection analysis finds no actionable KIR/profile candidate: quotesource is ' +
      'canonical-surface-blocked and 2 functions remain unknown-expression-kind; M4.134 ' +
      'investigates source/canonical-surface and expression-support remediation.',
  );
});
