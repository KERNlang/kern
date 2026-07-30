import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalPrerequisiteProvenanceBytes,
  loadCanonicalizerExceptionFlowPrerequisiteProvenance,
  loadCanonicalizerPrerequisiteProvenanceChain,
  validateCanonicalizerExceptionFlowPrerequisiteHandoff,
  validateCanonicalizerPrerequisiteProvenanceChain,
} from './coverage-prerequisite-provenance.mjs';

const CANONICALIZE_ID = 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('M4.138 freezes the exact published exception-flow prerequisite', () => {
  const handoff = loadCanonicalizerExceptionFlowPrerequisiteProvenance();
  assert.deepEqual(handoff.record.source, {
    commit: '5b35add93c04871beac52d0b93d74fa06a7039ae',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.6',
    coverageSummarySha256: '7e6b79ade0125e120b19009d53e2cb4b05e17633cd38bd6f4787075ded58e615',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.3',
    prerequisiteSummarySha256: 'd07915389748776424f0075f512abc7fe0d2957864a09a11c111179f60b9fb62',
  });
  assert.deepEqual(handoff.record.snapshot, {
    baseline: {
      baseCompleteFunctions: 109,
      baseId: 'kern.kir-canonicalizer.profile.m4.137',
      corpusMembers: 9,
      functionCount: 112,
      legacyParameterBlockers: 3,
      toolCount: 4,
    },
    minimumFamilyCount: 1,
    selectedPrerequisite: {
      catalogFacts: 2,
      family: 'exception-flow',
      occurrences: 34,
    },
    winningClosure: {
      completeFunctions: 1,
      completeTools: 1,
      families: ['exception-flow'],
      migratedParameterRows: 15,
      occurrences: 34,
      witnesses: [CANONICALIZE_ID],
    },
  });
  const bytes = readFileSync(
    new URL('./coverage-exception-flow-prerequisite-provenance.json', import.meta.url),
  );
  assert.deepEqual(canonicalPrerequisiteProvenanceBytes(handoff.record), bytes);
  assert.equal(sha256(bytes), handoff.digest);
});

test('M4.138 prerequisite history is the exact eight-record append-only chain', () => {
  const chain = loadCanonicalizerPrerequisiteProvenanceChain();
  assert.equal(chain.length, 8);
  assert.deepEqual(chain.at(-1), loadCanonicalizerExceptionFlowPrerequisiteProvenance());
  assert.deepEqual(
    chain.map(({ record }) => record.snapshot.selectedPrerequisite.family),
    [
      'index-expression',
      'counted-iteration',
      'binding',
      'unary-expression',
      'do-statement',
      'while-iteration',
      'new-expression',
      'exception-flow',
    ],
  );
  const mutations = [
    (copy) => { copy.reverse(); },
    (copy) => { copy.pop(); },
    (copy) => { copy.push(copy[7]); },
    (copy) => { copy[7].digest = '0'.repeat(64); },
    (copy) => { copy[7].record.source.commit = '0'.repeat(40); },
    (copy) => { copy[7].record.snapshot.selectedPrerequisite.family = 'new-expression'; },
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

test('M4.138 exact handoff rejects structurally valid causal drift', () => {
  const handoff = loadCanonicalizerExceptionFlowPrerequisiteProvenance();
  const mutations = [
    (copy) => { copy.source.coverageSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.source.prerequisiteSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.snapshot.baseline.baseCompleteFunctions -= 1; },
    (copy) => { copy.snapshot.baseline.legacyParameterBlockers += 1; },
    (copy) => { copy.snapshot.selectedPrerequisite.catalogFacts += 1; },
    (copy) => { copy.snapshot.selectedPrerequisite.occurrences += 1; },
    (copy) => { copy.snapshot.winningClosure.families = ['new-expression']; },
    (copy) => { copy.snapshot.winningClosure.migratedParameterRows += 1; },
    (copy) => { copy.snapshot.winningClosure.witnesses = ['future']; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(handoff.record);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerExceptionFlowPrerequisiteHandoff(copy),
      /prerequisite provenance rejection/u,
    );
  }
});
