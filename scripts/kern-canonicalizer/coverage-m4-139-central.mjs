import assert from 'node:assert/strict';

import {
  assertM4108ParameterTarget,
} from './coverage-m4-108-parameter-migration.mjs';
import {
  assertM4113ParameterTarget,
} from './coverage-m4-113-parameter-migration.mjs';
import { assertM4137NewExpressionPromotion } from './coverage-m4-137-central.mjs';
import { CURRENT_EMITSTATEMENT_TARGET_M4139 } from './emitstatement-target.mjs';
import {
  loadCanonicalizerExceptionFlowPrerequisiteProvenance,
} from './coverage-prerequisite-provenance.mjs';
import {
  parameterMigrationRoots,
} from './coverage-value-band-parameter-migrations.mjs';
import {
  formatM4139BoundedExceptionFlowStatus,
} from './coverage-status-m4-139.mjs';
import { CURRENT_VALIDSTATEMENT_TARGET_M4139 } from './validstatement-target.mjs';

const TARGETS = [
  CURRENT_VALIDSTATEMENT_TARGET_M4139,
  CURRENT_EMITSTATEMENT_TARGET_M4139,
];

export function assertM4139BoundedExceptionFlow(coverage, prerequisite) {
  assert.match(
    assertM4137NewExpressionPromotion(coverage, prerequisite),
    /^M4\.137 promotes new-expression/u,
  );
  const handoff = loadCanonicalizerExceptionFlowPrerequisiteProvenance();
  assert.equal(
    handoff.digest,
    '2c36f8d7ec2e91cba6742241e72c79adacc917ad59e3105aabdf15f7e9e712e4',
  );
  const roots = parameterMigrationRoots(TARGETS);
  const validstatement = TARGETS[0];
  const emitstatement = TARGETS[1];
  assertM4108ParameterTarget(
    roots.get(validstatement.path)?.[validstatement.functionOrdinal],
    coverage.functions.find(({ id }) => id === validstatement.id),
    validstatement,
  );
  assertM4113ParameterTarget(
    roots.get(emitstatement.path)?.[emitstatement.functionOrdinal],
    coverage.functions.find(({ id }) => id === emitstatement.id),
    emitstatement,
  );
  assert.deepEqual(coverage.selection.ranking, [{
    completeFunctions: 0,
    completeTools: 0,
    id: 'exception-flow',
    occurrences: 34,
    witnesses: [],
  }]);
  assert.equal(prerequisite.exhaustion, null);
  return formatM4139BoundedExceptionFlowStatus(
    coverage,
    prerequisite,
    handoff,
  );
}
