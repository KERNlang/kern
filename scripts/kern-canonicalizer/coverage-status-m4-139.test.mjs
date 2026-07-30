import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadCanonicalizerExceptionFlowPrerequisiteProvenance,
} from './coverage-prerequisite-provenance.mjs';
import {
  formatM4139BoundedExceptionFlowStatus,
} from './coverage-status-m4-139.mjs';

function archivedFrontier() {
  return {
    coverage: {
      base: { id: 'kern.kir-canonicalizer.profile.m4.137' },
      baseCompleteFunctions: 109,
    },
    prerequisite: {
      parameterMigration: { migratedParameterRows: 0 },
      ranking: [{ completeFunctions: 1, migratedParameterRows: 15 }],
      selectedPrerequisite: {
        catalogFacts: 2,
        family: 'exception-flow',
        occurrences: 34,
      },
    },
  };
}

test('M4.139 status remains bound to its immutable bounded frontier', () => {
  const { coverage, prerequisite } = archivedFrontier();
  assert.equal(
    formatM4139BoundedExceptionFlowStatus(
      coverage,
      prerequisite,
      loadCanonicalizerExceptionFlowPrerequisiteProvenance(),
    ),
    'M4.139 publishes bounded valued-throw validation and canonical emission; ' +
      'the M4.137 base remains 109/112 and exception-flow remains the exact ' +
      '2-fact/34-occurrence prerequisite for canonicalize (1 function/15 rows); ' +
      'M4.140 owns the immutable implementation handoff.',
  );
});

test('M4.139 status rejects archived base and prerequisite drift', () => {
  const { coverage, prerequisite } = archivedFrontier();
  const handoff = loadCanonicalizerExceptionFlowPrerequisiteProvenance();
  const changedCoverage = structuredClone(coverage);
  changedCoverage.baseCompleteFunctions = 110;
  assert.throws(
    () => formatM4139BoundedExceptionFlowStatus(changedCoverage, prerequisite, handoff),
  );
  const changedPrerequisite = structuredClone(prerequisite);
  changedPrerequisite.selectedPrerequisite.occurrences = 35;
  assert.throws(
    () => formatM4139BoundedExceptionFlowStatus(coverage, changedPrerequisite, handoff),
  );
});
