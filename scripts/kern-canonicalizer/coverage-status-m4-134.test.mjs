import assert from 'node:assert/strict';
import test from 'node:test';

import { formatM4134RemediationAnalysisStatus } from './coverage-status-m4-134.mjs';

test('M4.134 status reports the selected constructor remediation and M4.135 handoff', () => {
  assert.equal(
    formatM4134RemediationAnalysisStatus({
      completeFunctions: 2,
      id: 'bounded-new-expression-support',
      parameterRows: 21,
    }),
    'M4.134 selects bounded new-expression support for 2 functions/21 parameter rows; ' +
      'M4.135 owns the shared constructor contract while quotesource code-point remediation remains pending.',
  );
});
