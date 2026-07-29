import assert from 'node:assert/strict';
import test from 'node:test';

import { formatM4135BoundedNewExpressionStatus } from './coverage-status-m4-135.mjs';

const PREREQUISITE = {
  minimumFamilyCount: 2,
  outcome: 'selected',
  ranking: [{
    completeFunctions: 1,
    migratedParameterRows: 15,
    witnesses: [{
      id: 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
    }],
  }],
  selectedPrerequisite: {
    family: 'new-expression',
    occurrences: 41,
  },
};

test('M4.135 status reports the exact bounded constructor handoff', () => {
  assert.equal(
    formatM4135BoundedNewExpressionStatus(PREREQUISITE),
    'M4.135 publishes bounded new-expression support and selects new-expression ' +
      'inside the exact 2-family canonicalize closure (1 function/15 parameter rows); ' +
      'expressionsources remains projection-limited and quotesource remediation remains pending.',
  );
});

test('M4.135 status rejects drift from the selected prerequisite', () => {
  assert.throws(
    () => formatM4135BoundedNewExpressionStatus({
      ...PREREQUISITE,
      selectedPrerequisite: { family: 'exception-flow', occurrences: 41 },
    }),
    /exact bounded new-expression handoff/u,
  );
});
