import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadCanonicalizerNewExpressionPrerequisiteProvenance,
} from './coverage-prerequisite-provenance.mjs';
import {
  formatM4137NewExpressionPromotionStatus,
} from './coverage-status-m4-137.mjs';

test('M4.137 status remains reproducible from its immutable frontier', () => {
  const coverage = {
    base: {
      expressionKinds: ['new'],
      id: 'kern.kir-canonicalizer.profile.m4.137',
    },
    baseCompleteFunctions: 109,
    functions: Array.from({ length: 112 }),
    selection: { winner: null },
  };
  const prerequisite = {
    minimumFamilyCount: 1,
    outcome: 'selected',
    ranking: [{
      completeFunctions: 1,
      migratedParameterRows: 15,
      witnesses: [{
        id: 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
      }],
    }],
    selectedPrerequisite: {
      catalogFacts: 2,
      family: 'exception-flow',
      occurrences: 34,
    },
  };
  assert.equal(
    formatM4137NewExpressionPromotionStatus(
      coverage,
      prerequisite,
      loadCanonicalizerNewExpressionPrerequisiteProvenance(),
    ),
    'M4.137 promotes new-expression through the exact M4.136 provenance and advances ' +
      'the cumulative base to 109/112; exception-flow is the sole selected prerequisite ' +
      '(2 catalog facts/34 occurrences; 1 canonicalize function/15 rows); ' +
      'M4.138 owns the exception-flow prerequisite handoff.',
  );
});
