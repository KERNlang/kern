import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canonicalPrerequisiteProvenanceBytes,
  loadCanonicalizerNewExpressionPrerequisiteProvenance,
  loadCanonicalizerPrerequisiteProvenanceChain,
  validateCanonicalizerNewExpressionPrerequisiteHandoff,
  validateCanonicalizerPrerequisiteProvenanceChain,
} from './coverage-prerequisite-provenance.mjs';

const CANONICALIZE_ID = 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('M4.136 freezes the exact published new-expression prerequisite', () => {
  const handoff = loadCanonicalizerNewExpressionPrerequisiteProvenance();
  assert.deepEqual(handoff.record.source, {
    commit: '5c5e80fe03f9664ffb2cd87b513b7dfe3d9d867c',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.6',
    coverageSummarySha256: 'b54ea0da184be397ff995d3ffce4ee4be425cd2751de5089543a246be3c7c522',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.3',
    prerequisiteSummarySha256: '019ca1548ad46208c8b34b31cbd5d9bb4d140b4888a9992731a286cfde464a5b',
  });
  assert.deepEqual(handoff.record.snapshot, {
    baseline: {
      baseCompleteFunctions: 104,
      baseId: 'kern.kir-canonicalizer.profile.m4.60',
      corpusMembers: 9,
      functionCount: 112,
      legacyParameterBlockers: 3,
      toolCount: 4,
    },
    minimumFamilyCount: 2,
    selectedPrerequisite: {
      catalogFacts: 1,
      family: 'new-expression',
      occurrences: 41,
    },
    winningClosure: {
      completeFunctions: 1,
      completeTools: 1,
      families: ['exception-flow', 'new-expression'],
      migratedParameterRows: 15,
      occurrences: 75,
      witnesses: [CANONICALIZE_ID],
    },
  });
  const bytes = readFileSync(
    new URL('./coverage-new-expression-prerequisite-provenance.json', import.meta.url),
  );
  assert.deepEqual(canonicalPrerequisiteProvenanceBytes(handoff.record), bytes);
  assert.equal(sha256(bytes), handoff.digest);
});

test('M4.136 prerequisite history is the exact seven-record append-only chain', () => {
  const chain = loadCanonicalizerPrerequisiteProvenanceChain();
  assert.equal(chain.length, 7);
  assert.deepEqual(chain.at(-1), loadCanonicalizerNewExpressionPrerequisiteProvenance());
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
    ],
  );
  const mutations = [
    (copy) => { copy.reverse(); },
    (copy) => { copy.pop(); },
    (copy) => { copy.push(copy[6]); },
    (copy) => { copy[6].digest = '0'.repeat(64); },
    (copy) => { copy[6].record.source.commit = '0'.repeat(40); },
    (copy) => { copy[6].record.snapshot.selectedPrerequisite.family = 'exception-flow'; },
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

test('M4.136 exact handoff rejects structurally valid causal drift', () => {
  const handoff = loadCanonicalizerNewExpressionPrerequisiteProvenance();
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
      () => validateCanonicalizerNewExpressionPrerequisiteHandoff(copy),
      /prerequisite provenance rejection/u,
    );
  }
});
