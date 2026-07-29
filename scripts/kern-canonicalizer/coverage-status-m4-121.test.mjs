import assert from 'node:assert/strict';
import test from 'node:test';

import { formatM4121ProjectionAnalysisStatus } from './coverage-status.mjs';

test('coverage status records the M4.121 projection recommendation', () => {
  assert.equal(
    formatM4121ProjectionAnalysisStatus({
      changedLimits: ['maxDepth'],
      completeFunctions: 1,
      completeTools: 1,
      kirLimits: { maxDepth: 77 },
      migratedParameterRows: 5,
    }),
    'M4.121 projection analysis selects maxDepth 77 for 1 function/5 rows across 1 tool; ' +
      'M4.122 authenticates structural KIR and runtime-envelope safety.',
  );
  assert.throws(
    () => formatM4121ProjectionAnalysisStatus(null),
    /must select only maxDepth/u,
  );
});
