import assert from 'node:assert/strict';

import {
  implementationHandoffTargetIdentity,
  loadCanonicalizerExceptionFlowImplementationHandoff,
} from './coverage-implementation-handoff.mjs';
import { assertM4139BoundedExceptionFlow } from './coverage-m4-139-central.mjs';
import {
  loadCanonicalizerExceptionFlowPrerequisiteProvenance,
} from './coverage-prerequisite-provenance.mjs';
import {
  formatM4140ExceptionFlowImplementationHandoffStatus,
} from './coverage-status-m4-140.mjs';
import { CURRENT_EMITSTATEMENT_TARGET_M4139 } from './emitstatement-target.mjs';
import { CURRENT_VALIDSTATEMENT_TARGET_M4139 } from './validstatement-target.mjs';

export function assertM4140ExceptionFlowImplementationHandoff(coverage, prerequisite) {
  assert.match(
    assertM4139BoundedExceptionFlow(coverage, prerequisite),
    /^M4\.139 publishes bounded valued-throw/u,
  );
  const handoff = loadCanonicalizerExceptionFlowImplementationHandoff();
  const prerequisiteHandoff = loadCanonicalizerExceptionFlowPrerequisiteProvenance();
  assert.deepEqual(handoff.record.prerequisite, {
    digest: prerequisiteHandoff.digest,
    family: prerequisiteHandoff.record.snapshot.selectedPrerequisite.family,
  });
  assert.deepEqual(handoff.record.targets, [
    implementationHandoffTargetIdentity(CURRENT_VALIDSTATEMENT_TARGET_M4139),
    implementationHandoffTargetIdentity(CURRENT_EMITSTATEMENT_TARGET_M4139),
  ]);
  return formatM4140ExceptionFlowImplementationHandoffStatus(handoff);
}
