import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalPrerequisiteProvenanceBytes,
  loadCanonicalizerBindingPrerequisiteProvenance,
  loadCanonicalizerCountedIterationPrerequisiteProvenance,
  loadCanonicalizerIndexPrerequisiteProvenance,
  loadCanonicalizerPrerequisiteProvenanceChain,
  loadCanonicalizerUnaryPrerequisiteProvenance,
  validateCanonicalizerPrerequisiteProvenance,
  validateCanonicalizerPrerequisiteProvenanceChain,
  validateCanonicalizerUnaryPrerequisiteHandoff,
} from './coverage-prerequisite-provenance.mjs';

const M427_DIGEST = 'e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5';
const NUMBERAT_ID =
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#9:numberat';

test('M4.27 freezes the exact published unary-expression prerequisite independently', () => {
  const handoff = loadCanonicalizerUnaryPrerequisiteProvenance();
  assert.equal(handoff.digest, M427_DIGEST);
  assert.deepEqual(handoff.record.source, {
    commit: 'e22a02418f14b6de9619b08b63281abdbc002ef1',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.6',
    coverageSummarySha256: '276c3d0a0673cf22027f65b9c532a79be4e018749aa7b8d50d421defd125271c',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.2',
    prerequisiteSummarySha256: '8a1bc1d5082760c0cf81a38f71225761ac8bf22accac34ee0ddb7207abb7dffb',
  });
  assert.deepEqual(handoff.record.snapshot, {
    baseline: {
      baseCompleteFunctions: 32,
      baseId: 'kern.kir-canonicalizer.profile.m4.25',
      corpusMembers: 9,
      functionCount: 104,
      legacyParameterBlockers: 70,
      toolCount: 4,
    },
    minimumFamilyCount: 1,
    selectedPrerequisite: {
      catalogFacts: 1,
      family: 'unary-expression',
      occurrences: 48,
    },
    winningClosure: {
      completeFunctions: 1,
      completeTools: 1,
      families: ['unary-expression'],
      migratedParameterRows: 2,
      occurrences: 48,
      witnesses: [NUMBERAT_ID],
    },
  });
  assert.deepEqual(
    canonicalPrerequisiteProvenanceBytes(handoff.record),
    readFileSync(new URL('./coverage-unary-prerequisite-provenance.json', import.meta.url)),
  );
});

test('M4.27 prerequisite history is an exact ordered four-record chain', () => {
  const index = loadCanonicalizerIndexPrerequisiteProvenance();
  const counted = loadCanonicalizerCountedIterationPrerequisiteProvenance();
  const binding = loadCanonicalizerBindingPrerequisiteProvenance();
  const unary = loadCanonicalizerUnaryPrerequisiteProvenance();
  const chain = loadCanonicalizerPrerequisiteProvenanceChain();
  assert.deepEqual(chain, [index, counted, binding, unary]);

  const mutations = [
    (copy) => { copy.reverse(); },
    (copy) => { copy.pop(); },
    (copy) => { copy.push(copy[3]); },
    (copy) => { copy[0].digest = '0'.repeat(64); },
    (copy) => { copy[1].digest = '0'.repeat(64); },
    (copy) => { copy[2].digest = '0'.repeat(64); },
    (copy) => { copy[3].digest = '0'.repeat(64); },
    (copy) => { copy[3].record.source.commit = '0'.repeat(40); },
    (copy) => { copy[3].record.snapshot.selectedPrerequisite.family = 'binding'; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(chain);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerPrerequisiteProvenanceChain(copy),
      /prerequisite provenance rejection/u,
    );
  }
});

test('M4.27 exact handoff pin rejects structurally valid causal drift', () => {
  const handoff = loadCanonicalizerUnaryPrerequisiteProvenance();
  const mutations = [
    (copy) => { copy.source.commit = '0'.repeat(40); },
    (copy) => { copy.source.coverageSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.source.prerequisiteSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.snapshot.baseline.baseCompleteFunctions += 1; },
    (copy) => { copy.snapshot.selectedPrerequisite.occurrences += 1; },
    (copy) => { copy.snapshot.winningClosure.migratedParameterRows += 1; },
    (copy) => { copy.snapshot.winningClosure.witnesses = ['future']; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.doesNotThrow(() => validateCanonicalizerPrerequisiteProvenance(copy));
    assert.throws(
      () => validateCanonicalizerUnaryPrerequisiteHandoff(copy),
      /prerequisite provenance rejection/u,
    );
  }
});
