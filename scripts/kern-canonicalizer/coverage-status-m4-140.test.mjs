import assert from 'node:assert/strict';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  loadCanonicalizerExceptionFlowImplementationHandoff,
} from './coverage-implementation-handoff.mjs';
import {
  assertM4140ExceptionFlowImplementationHandoff,
} from './coverage-m4-140-central.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import {
  formatM4140ExceptionFlowImplementationHandoffStatus,
} from './coverage-status-m4-140.mjs';

test('M4.140 binds the exact implementation handoff to the unchanged live frontier', () => {
  assert.equal(
    assertM4140ExceptionFlowImplementationHandoff(
      measureCanonicalizerCoverage(),
      measureCanonicalizerPrerequisite(),
    ),
    'M4.140 freezes the exact published M4.139 exception-flow implementation ' +
      '(canonicalizer d96dee80f12236a3d9089bf44aeee699e6a3c35856e71f79a0743691248ea16e; ' +
      'validstatement/emitstatement targets); the M4.137 base remains 109/112 and ' +
      'M4.141 owns exception-flow promotion.',
  );
});

test('M4.140 status binds the claimed digest to the exact implementation record', () => {
  const changedDigest = structuredClone(loadCanonicalizerExceptionFlowImplementationHandoff());
  changedDigest.digest = '0'.repeat(64);
  assert.throws(
    () => formatM4140ExceptionFlowImplementationHandoffStatus(changedDigest),
    /exact M4\.139 exception-flow implementation/u,
  );
  const changedRecord = structuredClone(loadCanonicalizerExceptionFlowImplementationHandoff());
  changedRecord.record.targets[0].bodyDigest = '0'.repeat(64);
  assert.throws(
    () => formatM4140ExceptionFlowImplementationHandoffStatus(changedRecord),
    /implementation handoff rejection/u,
  );
});
