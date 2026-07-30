import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCanonicalizerExceptionFlowPrerequisiteProvenance } from
  './coverage-prerequisite-provenance.mjs';
import { formatM4138ExceptionFlowHandoffStatus } from './coverage-status-m4-138.mjs';

test('M4.138 status reports the exact immutable exception-flow handoff', () => {
  assert.equal(
    formatM4138ExceptionFlowHandoffStatus(
      loadCanonicalizerExceptionFlowPrerequisiteProvenance(),
    ),
    'M4.138 freezes the exact M4.137 exception-flow prerequisite ' +
      '(2 catalog facts/34 occurrences; 1-family canonicalize closure with 1 function/15 rows); ' +
      'M4.139 owns bounded exception-flow implementation.',
  );
});

test('M4.138 status rejects prerequisite digest drift', () => {
  const handoff = structuredClone(loadCanonicalizerExceptionFlowPrerequisiteProvenance());
  handoff.digest = '0'.repeat(64);
  assert.throws(
    () => formatM4138ExceptionFlowHandoffStatus(handoff),
    /exact exception-flow prerequisite/u,
  );
});

test('M4.138 status binds the claimed digest to the exact prerequisite record', () => {
  const handoff = structuredClone(loadCanonicalizerExceptionFlowPrerequisiteProvenance());
  handoff.record.snapshot.winningClosure.families = ['new-expression'];
  assert.throws(
    () => formatM4138ExceptionFlowHandoffStatus(handoff),
    /exact exception-flow prerequisite|prerequisite provenance rejection/u,
  );
});
