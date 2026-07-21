import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalPrerequisiteProvenanceBytes,
  loadCanonicalizerBindingPrerequisiteProvenance,
  loadCanonicalizerCountedIterationPrerequisiteProvenance,
  loadCanonicalizerIndexPrerequisiteProvenance,
  loadCanonicalizerPrerequisiteProvenanceChain,
  validateCanonicalizerBindingPrerequisiteHandoff,
  validateCanonicalizerPrerequisiteProvenance,
  validateCanonicalizerPrerequisiteProvenanceChain,
} from './coverage-prerequisite-provenance.mjs';

const M423_DIGEST = '00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab';

test('M4.23 freezes the exact published binding prerequisite independently', () => {
  const handoff = loadCanonicalizerBindingPrerequisiteProvenance();
  assert.equal(handoff.digest, M423_DIGEST);
  assert.deepEqual(handoff.record.source, {
    commit: 'ca99949f28aca5c39f182f67a35b1342762cc6cd',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.6',
    coverageSummarySha256: '9cfabe1ea53540a69d3ba4aa4444a2578f9d0c992c53f17a63826600abf2434a',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.2',
    prerequisiteSummarySha256: '44b2ce6e4542770cad06201a7d1cc9763a01b2960ce4ef654657b7d455836c8f',
  });
  assert.deepEqual(handoff.record.snapshot, {
    baseline: {
      baseCompleteFunctions: 27,
      baseId: 'kern.kir-canonicalizer.profile.m4.21',
      corpusMembers: 9,
      functionCount: 104,
      legacyParameterBlockers: 75,
      toolCount: 4,
    },
    minimumFamilyCount: 1,
    selectedPrerequisite: {
      catalogFacts: 6,
      family: 'binding',
      occurrences: 801,
    },
    winningClosure: {
      completeFunctions: 5,
      completeTools: 2,
      families: ['binding'],
      migratedParameterRows: 9,
      occurrences: 801,
      witnesses: [
        'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#11:childcount',
        'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#13:valuechildcount',
        'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#7:propcount',
        'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#0:indentation',
        'examples/selfhost-validator/validator.kern#9:paramcount',
      ],
    },
  });
  assert.deepEqual(
    canonicalPrerequisiteProvenanceBytes(handoff.record),
    readFileSync(new URL('./coverage-binding-prerequisite-provenance.json', import.meta.url)),
  );
});

test('M4.23 prerequisite history is an exact ordered three-record chain', () => {
  const index = loadCanonicalizerIndexPrerequisiteProvenance();
  const counted = loadCanonicalizerCountedIterationPrerequisiteProvenance();
  const binding = loadCanonicalizerBindingPrerequisiteProvenance();
  const chain = loadCanonicalizerPrerequisiteProvenanceChain();
  assert.deepEqual(chain, [index, counted, binding]);

  const mutations = [
    (copy) => { copy.reverse(); },
    (copy) => { copy.pop(); },
    (copy) => { copy.push(copy[2]); },
    (copy) => { copy[0].digest = '0'.repeat(64); },
    (copy) => { copy[1].digest = '0'.repeat(64); },
    (copy) => { copy[2].digest = '0'.repeat(64); },
    (copy) => { copy[2].record.source.commit = '0'.repeat(40); },
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

test('M4.23 exact handoff pin rejects structurally valid causal drift', () => {
  const handoff = loadCanonicalizerBindingPrerequisiteProvenance();
  const mutations = [
    (copy) => { copy.source.commit = '0'.repeat(40); },
    (copy) => { copy.source.coverageSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.source.prerequisiteSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.snapshot.baseline.baseCompleteFunctions += 1; },
    (copy) => { copy.snapshot.selectedPrerequisite.occurrences += 1; },
    (copy) => { copy.snapshot.winningClosure.migratedParameterRows += 1; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.doesNotThrow(() => validateCanonicalizerPrerequisiteProvenance(copy));
    assert.throws(
      () => validateCanonicalizerBindingPrerequisiteHandoff(copy),
      /prerequisite provenance rejection/u,
    );
  }
});

test('generic provenance accepts only historical prerequisite summary formats 1 and 2', () => {
  const counted = structuredClone(loadCanonicalizerCountedIterationPrerequisiteProvenance().record);
  counted.source.prerequisiteSummaryFormat = 'kern.kir-canonicalizer.prerequisite-summary.2';
  assert.doesNotThrow(() => validateCanonicalizerPrerequisiteProvenance(counted));
  counted.source.prerequisiteSummaryFormat = 'kern.kir-canonicalizer.prerequisite-summary.3';
  assert.throws(
    () => validateCanonicalizerPrerequisiteProvenance(counted),
    /prerequisite provenance rejection/u,
  );
});
