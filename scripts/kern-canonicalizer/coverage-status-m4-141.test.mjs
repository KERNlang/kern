import assert from 'node:assert/strict';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  loadCanonicalizerExceptionFlowImplementationHandoff,
} from './coverage-implementation-handoff.mjs';
import { assertM4141ExceptionFlowPromotion } from './coverage-m4-141-central.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import {
  loadCanonicalizerExceptionFlowPrerequisiteProvenance,
} from './coverage-prerequisite-provenance.mjs';
import {
  formatM4141ExceptionFlowPromotionStatus,
} from './coverage-status-m4-141.mjs';

let measuredFrontier;

function currentFrontier() {
  measuredFrontier ??= {
    coverage: measureCanonicalizerCoverage(),
    implementation: loadCanonicalizerExceptionFlowImplementationHandoff(),
    prerequisite: measureCanonicalizerPrerequisite(),
    selection: loadCanonicalizerExceptionFlowPrerequisiteProvenance(),
  };
  return measuredFrontier;
}

test('M4.141 binds exact dual evidence and publishes only the canonicalize queue', () => {
  const { coverage, prerequisite } = currentFrontier();
  assert.equal(
    assertM4141ExceptionFlowPromotion(
      coverage,
      prerequisite,
    ),
    'M4.141 promotes exception-flow through the exact M4.138 prerequisite and M4.140 ' +
      'implementation handoff; the cumulative base remains 109/112 and exposes the exact ' +
      '1-function/15-row canonicalize parameter queue; the structural-family frontier is ' +
      'exhausted and M4.142 owns queue consumption.',
  );
});

test('M4.141 status rejects either immutable evidence edge drifting', () => {
  const { coverage, implementation, prerequisite, selection } = currentFrontier();
  const changedSelection = structuredClone(selection);
  changedSelection.digest = '0'.repeat(64);
  assert.throws(
    () => formatM4141ExceptionFlowPromotionStatus(
      coverage,
      prerequisite,
      changedSelection,
      implementation,
    ),
    /exact authorized exception-flow frontier/u,
  );
  const changedImplementation = structuredClone(implementation);
  changedImplementation.digest = '0'.repeat(64);
  assert.throws(
    () => formatM4141ExceptionFlowPromotionStatus(
      coverage,
      prerequisite,
      selection,
      changedImplementation,
    ),
    /exact authorized exception-flow frontier/u,
  );
});

test('M4.141 status rejects authenticated frontier and queue drift', () => {
  const { coverage, implementation, prerequisite, selection } = currentFrontier();
  const changedCoverage = structuredClone(coverage);
  changedCoverage.baseCompleteFunctions = 110;
  assert.throws(
    () => formatM4141ExceptionFlowPromotionStatus(
      changedCoverage,
      prerequisite,
      selection,
      implementation,
    ),
    /exact authorized exception-flow frontier/u,
  );
  const changedQueue = structuredClone(prerequisite);
  changedQueue.parameterMigration.witnesses[0].id = 'future';
  assert.throws(
    () => formatM4141ExceptionFlowPromotionStatus(
      coverage,
      changedQueue,
      selection,
      implementation,
    ),
    /exact authorized exception-flow frontier/u,
  );
  const changedResidual = structuredClone(prerequisite);
  changedResidual.exhaustion.reasonCounts[0].id = 'future';
  assert.throws(
    () => formatM4141ExceptionFlowPromotionStatus(
      coverage,
      changedResidual,
      selection,
      implementation,
    ),
    /exact authorized exception-flow frontier/u,
  );
});

test('M4.141 status rejects forged source identity and incomplete cumulative bases', () => {
  const { coverage, implementation, prerequisite, selection } = currentFrontier();
  const forgedCoverage = structuredClone(coverage);
  const forgedPrerequisite = structuredClone(prerequisite);
  forgedCoverage.canonicalizerDigest = '0'.repeat(64);
  forgedPrerequisite.baseline.canonicalizerDigest = '0'.repeat(64);
  assert.throws(
    () => formatM4141ExceptionFlowPromotionStatus(
      forgedCoverage,
      forgedPrerequisite,
      selection,
      implementation,
    ),
    /exact authorized exception-flow frontier/u,
  );
  const forgedImplementationCoverage = structuredClone(coverage);
  const forgedImplementationPrerequisite = structuredClone(prerequisite);
  forgedImplementationCoverage.coverageImplementationDigest = '0'.repeat(64);
  forgedImplementationPrerequisite.baseline.coverageImplementationDigest = '0'.repeat(64);
  assert.throws(
    () => formatM4141ExceptionFlowPromotionStatus(
      forgedImplementationCoverage,
      forgedImplementationPrerequisite,
      selection,
      implementation,
    ),
    /exact authorized exception-flow frontier/u,
  );
  const incompleteBase = structuredClone(coverage);
  incompleteBase.base.nodeKinds.shift();
  incompleteBase.base.propertyKeys.shift();
  incompleteBase.base.promotions.shift();
  assert.throws(
    () => formatM4141ExceptionFlowPromotionStatus(
      incompleteBase,
      prerequisite,
      selection,
      implementation,
    ),
    /exact authorized exception-flow frontier/u,
  );
});

test('M4.141 status authenticates exact function facts, base shape, and tool evidence', () => {
  const { coverage, implementation, prerequisite, selection } = currentFrontier();
  const forgedFunctions = structuredClone(coverage);
  forgedFunctions.functions = Array.from({ length: 112 }, () => null);
  assert.throws(
    () => formatM4141ExceptionFlowPromotionStatus(
      forgedFunctions,
      prerequisite,
      selection,
      implementation,
    ),
    /exact authorized exception-flow frontier/u,
  );
  const decoratedBase = structuredClone(coverage);
  decoratedBase.base.future = true;
  assert.throws(
    () => formatM4141ExceptionFlowPromotionStatus(
      decoratedBase,
      prerequisite,
      selection,
      implementation,
    ),
    /exact authorized exception-flow frontier/u,
  );
  const changedTools = structuredClone(prerequisite);
  changedTools.baseline.toolCount -= 1;
  assert.throws(
    () => formatM4141ExceptionFlowPromotionStatus(
      coverage,
      changedTools,
      selection,
      implementation,
    ),
    /exact authorized exception-flow frontier/u,
  );
});

test('M4.141 status rejects decorated prerequisite arrays', () => {
  const { coverage, implementation, prerequisite, selection } = currentFrontier();
  for (const path of [
    ['prerequisiteRanking'],
    ['ranking'],
    ['parameterMigration', 'witnesses'],
    ['exhaustion', 'activeFamilies'],
    ['exhaustion', 'reasonCounts'],
  ]) {
    const decorated = structuredClone(prerequisite);
    const array = path.reduce((value, key) => value[key], decorated);
    array.future = true;
    assert.throws(
      () => formatM4141ExceptionFlowPromotionStatus(
        coverage,
        decorated,
        selection,
        implementation,
      ),
      /exact authorized exception-flow frontier/u,
      path.join('.'),
    );
  }
});
