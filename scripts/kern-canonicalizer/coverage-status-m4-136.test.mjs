import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCanonicalizerNewExpressionPrerequisiteProvenance } from
  './coverage-prerequisite-provenance.mjs';
import { formatM4136NewExpressionHandoffStatus } from './coverage-status-m4-136.mjs';

test('M4.136 status reports the exact immutable new-expression handoff', () => {
  assert.equal(
    formatM4136NewExpressionHandoffStatus(
      loadCanonicalizerNewExpressionPrerequisiteProvenance(),
    ),
    'M4.136 freezes the exact M4.135 new-expression prerequisite ' +
      '(1 catalog fact/41 occurrences; 2-family canonicalize closure with 1 function/15 rows); ' +
      'M4.137 owns cumulative-base promotion.',
  );
});

test('M4.136 status rejects prerequisite digest drift', () => {
  const handoff = structuredClone(loadCanonicalizerNewExpressionPrerequisiteProvenance());
  handoff.digest = '0'.repeat(64);
  assert.throws(
    () => formatM4136NewExpressionHandoffStatus(handoff),
    /exact new-expression prerequisite/u,
  );
});

test('M4.136 status binds the claimed digest to the exact prerequisite record', () => {
  const handoff = structuredClone(loadCanonicalizerNewExpressionPrerequisiteProvenance());
  handoff.record.snapshot.winningClosure.families = ['new-expression'];
  assert.throws(
    () => formatM4136NewExpressionHandoffStatus(handoff),
    /exact new-expression prerequisite|prerequisite provenance rejection/u,
  );
});
