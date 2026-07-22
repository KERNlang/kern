import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM442 } from './coverage-residual-analysis-m4-42.mjs';
import { loadPublishedCanonicalizerResidualAnalysisM443 } from './coverage-residual-analysis-m4-43.mjs';

test('M4.43 freezes the live optimized frontier before M4.44 promotion', () => {
  const handoff = loadPublishedCanonicalizerResidualAnalysisM443();
  const current = handoff.record;
  assert.deepEqual(current.baseline, {
    baseCompleteFunctions: 57,
    baseId: 'kern.kir-canonicalizer.profile.m4.36',
    coverageImplementationDigest: 'e1f76383da938ab2caad81fe9209fd58061a3f1b47f675a23aae7a607548b333',
    coveragePolicyDigest: '6c70a49fc5b8fabbefb902c3323534302448281fa998691598efd6a6d83fff6b',
    currentProfileLimits: {
      maxNodeRows: 16,
      maxPropertyRows: 30,
      maxValueRows: 154,
    },
    functionFactsDigest: '75ec5a9f2ce7c3b6a7c42b212ecbced4a4ecb9becb80766c2f04280eb05d4287',
    legacyParameterBlockers: 45,
    residualFunctionCount: 45,
  });
  assert.equal(
    current.assignmentsDigest,
    'fb73e3bfba455094fd188454de81c56e0a1ff8011bc3ec70eea2f02160537092',
  );
  assert.equal(handoff.digest, '823e464ea6b6cc78a6959c0bced2b6d5f63b5722e0e15bda4a2dd08abf8200d8');
  assert.equal(handoff.sourceCommit, 'df27456aeda2880eb6bb76e5ed1b8fe314023a39');
  assert.deepEqual(
    current.selectedNextAction,
    loadPublishedCanonicalizerResidualAnalysisM442().record.selectedNextAction,
  );
});
