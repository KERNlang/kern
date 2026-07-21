import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalPrerequisiteProvenanceBytes,
  loadCanonicalizerBindingPrerequisiteProvenance,
  loadCanonicalizerCountedIterationPrerequisiteProvenance,
  loadCanonicalizerDoPrerequisiteProvenance,
  loadCanonicalizerIndexPrerequisiteProvenance,
  loadCanonicalizerPrerequisiteProvenanceChain,
  loadCanonicalizerUnaryPrerequisiteProvenance,
  validateCanonicalizerDoPrerequisiteHandoff,
  validateCanonicalizerPrerequisiteProvenance,
  validateCanonicalizerPrerequisiteProvenanceChain,
} from './coverage-prerequisite-provenance.mjs';

const M434_DIGEST = '3d865f4983e7febd26540db681c88d8749d156f5d180405b831b5ccd7fb54d72';
const APPENDID_ID = 'examples/selfhost-validator/validator.kern#14:appendid';

test('M4.34 freezes the exact published do-statement prerequisite', () => {
  const handoff = loadCanonicalizerDoPrerequisiteProvenance();
  assert.equal(handoff.digest, M434_DIGEST);
  assert.deepEqual(handoff.record.source, {
    commit: 'f91c92aa63524c65c261d1f34f2187c55455ea6b',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.6',
    coverageSummarySha256: '8550b80e0a98da57f26a9c78ac762b0049cc02146202b278e817bf07051d774a',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.3',
    prerequisiteSummarySha256: 'd8c2fdd07c96ce6548edd1121ae0eea1596c14a52f25d4caab15cf259edf1e1c',
  });
  assert.deepEqual(handoff.record.snapshot, {
    baseline: {
      baseCompleteFunctions: 45,
      baseId: 'kern.kir-canonicalizer.profile.m4.29',
      corpusMembers: 9,
      functionCount: 104,
      legacyParameterBlockers: 57,
      toolCount: 4,
    },
    minimumFamilyCount: 1,
    selectedPrerequisite: {
      catalogFacts: 2,
      family: 'do-statement',
      occurrences: 176,
    },
    winningClosure: {
      completeFunctions: 1,
      completeTools: 1,
      families: ['do-statement'],
      migratedParameterRows: 2,
      occurrences: 176,
      witnesses: [APPENDID_ID],
    },
  });
  assert.deepEqual(
    canonicalPrerequisiteProvenanceBytes(handoff.record),
    readFileSync(new URL('./coverage-do-prerequisite-provenance.json', import.meta.url)),
  );
});

test('M4.34 prerequisite history is an exact ordered five-record chain', () => {
  const index = loadCanonicalizerIndexPrerequisiteProvenance();
  const counted = loadCanonicalizerCountedIterationPrerequisiteProvenance();
  const binding = loadCanonicalizerBindingPrerequisiteProvenance();
  const unary = loadCanonicalizerUnaryPrerequisiteProvenance();
  const doStatement = loadCanonicalizerDoPrerequisiteProvenance();
  const chain = loadCanonicalizerPrerequisiteProvenanceChain();
  assert.deepEqual(chain, [index, counted, binding, unary, doStatement]);

  const mutations = [
    (copy) => { copy.reverse(); },
    (copy) => { copy.pop(); },
    (copy) => { copy.push(copy[4]); },
    (copy) => { copy[0].digest = '0'.repeat(64); },
    (copy) => { copy[1].digest = '0'.repeat(64); },
    (copy) => { copy[2].digest = '0'.repeat(64); },
    (copy) => { copy[3].digest = '0'.repeat(64); },
    (copy) => { copy[4].digest = '0'.repeat(64); },
    (copy) => { copy[4].record.source.commit = '0'.repeat(40); },
    (copy) => { copy[4].record.snapshot.selectedPrerequisite.family = 'while-iteration'; },
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

test('M4.34 exact handoff pin rejects structurally valid causal drift', () => {
  const handoff = loadCanonicalizerDoPrerequisiteProvenance();
  const mutations = [
    (copy) => { copy.source.commit = '0'.repeat(40); },
    (copy) => { copy.source.coverageSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.source.prerequisiteSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.snapshot.baseline.baseCompleteFunctions += 1; },
    (copy) => { copy.snapshot.baseline.legacyParameterBlockers += 1; },
    (copy) => { copy.snapshot.selectedPrerequisite.catalogFacts += 1; },
    (copy) => { copy.snapshot.selectedPrerequisite.occurrences += 1; },
    (copy) => { copy.snapshot.winningClosure.migratedParameterRows += 1; },
    (copy) => { copy.snapshot.winningClosure.witnesses = ['future']; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.doesNotThrow(() => validateCanonicalizerPrerequisiteProvenance(copy));
    assert.throws(
      () => validateCanonicalizerDoPrerequisiteHandoff(copy),
      /prerequisite provenance rejection/u,
    );
  }
});
