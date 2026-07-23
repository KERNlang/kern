import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadCoveragePolicy, measureCanonicalizerCoverage } from './coverage.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadPublishedCanonicalizerPrerequisiteM460 } from './coverage-prerequisite-m4-60.mjs';
import {
  canonicalPrerequisiteProvenanceBytes,
  loadCanonicalizerPrerequisiteProvenanceChain,
  loadCanonicalizerWhilePrerequisiteProvenance,
  validateCanonicalizerPrerequisiteProvenance,
  validateCanonicalizerPrerequisiteProvenanceChain,
  validateCanonicalizerWhilePrerequisiteHandoff,
} from './coverage-prerequisite-provenance.mjs';

const M458_DIGEST = '5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07';
const SORTSTRINGS_ID = 'examples/selfhost-validator/validator.kern#19:sortstrings';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('M4.58 freezes the exact published while-iteration prerequisite', () => {
  const handoff = loadCanonicalizerWhilePrerequisiteProvenance();
  assert.equal(handoff.digest, M458_DIGEST);
  assert.deepEqual(handoff.record.source, {
    commit: '5ad4f524f9e3434fb039033803f2988316a04564',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.6',
    coverageSummarySha256: 'b6f8ae2a49de9b8c2a859605a6c6a5da1bfcbc90d440efa9cdf259ccb7db7015',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.3',
    prerequisiteSummarySha256: '31a90a6e1bb413939a56ab9637c12c660dbfb6247b24a347698312839c366c58',
  });
  assert.deepEqual(handoff.record.snapshot, {
    baseline: {
      baseCompleteFunctions: 72,
      baseId: 'kern.kir-canonicalizer.profile.m4.36',
      corpusMembers: 9,
      functionCount: 104,
      legacyParameterBlockers: 31,
      toolCount: 4,
    },
    minimumFamilyCount: 1,
    selectedPrerequisite: {
      catalogFacts: 2,
      family: 'while-iteration',
      occurrences: 2,
    },
    winningClosure: {
      completeFunctions: 1,
      completeTools: 1,
      families: ['while-iteration'],
      migratedParameterRows: 1,
      occurrences: 2,
      witnesses: [SORTSTRINGS_ID],
    },
  });
  const bytes = readFileSync(new URL('./coverage-while-prerequisite-provenance.json', import.meta.url));
  assert.deepEqual(canonicalPrerequisiteProvenanceBytes(handoff.record), bytes);
  assert.equal(sha256(bytes), M458_DIGEST);
});

test('M4.58 prerequisite history is the exact ordered six-record chain', () => {
  const chain = loadCanonicalizerPrerequisiteProvenanceChain();
  const whileIteration = loadCanonicalizerWhilePrerequisiteProvenance();
  assert.equal(chain.length, 6);
  assert.deepEqual(chain.at(-1), whileIteration);
  assert.deepEqual(
    chain.map(({ record }) => record.snapshot.selectedPrerequisite.family),
    [
      'index-expression',
      'counted-iteration',
      'binding',
      'unary-expression',
      'do-statement',
      'while-iteration',
    ],
  );

  const mutations = [
    (copy) => { copy.reverse(); },
    (copy) => { copy.pop(); },
    (copy) => { copy.push(copy[5]); },
    (copy) => { copy[5].digest = '0'.repeat(64); },
    (copy) => { copy[5].record.source.commit = '0'.repeat(40); },
    (copy) => { copy[5].record.snapshot.selectedPrerequisite.family = 'exception-flow'; },
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

test('M4.58 exact handoff pin rejects structurally valid causal drift', () => {
  const handoff = loadCanonicalizerWhilePrerequisiteProvenance();
  const mutations = [
    (copy) => { copy.source.commit = '0'.repeat(40); },
    (copy) => { copy.source.coverageSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.source.prerequisiteSummarySha256 = '0'.repeat(64); },
    (copy) => { copy.snapshot.baseline.baseCompleteFunctions -= 1; },
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
      () => validateCanonicalizerWhilePrerequisiteHandoff(copy),
      /prerequisite provenance rejection/u,
    );
  }
});

test('M4.61 preserves the M4.60 while promotion and consumes its immutable queue', () => {
  const policy = loadCoveragePolicy();
  assert.equal(policy.base.id, 'kern.kir-canonicalizer.profile.m4.60');
  assert.equal(policy.base.nodeKinds.includes('while'), true);
  assert.equal(policy.base.propertyKeys.includes('while.cond'), true);
  assert.equal(policy.families.some(({ id }) => id === 'while-iteration'), false);
  assert.deepEqual(policy.families.map(({ id }) => id), ['exception-flow']);
  assert.equal(
    sha256(readFileSync(new URL('../../examples/selfhost-validator/validator.kern', import.meta.url))),
    '99717668519d853fa83805189626957c1565a415dbfd135c9fe3b1abccfb46a4',
  );

  const coverage = measureCanonicalizerCoverage(policy);
  assert.equal(coverage.baseCompleteFunctions, 73);
  assert.equal(coverage.functions.length, 104);
  assert.equal(coverage.functions.filter(({ excludedProperties }) =>
    excludedProperties.includes('fn.params')).length, 30);
  assert.equal(
    coverage.prerequisiteProvenances.at(-1).digest,
    M458_DIGEST,
  );

  const prerequisite = measureCanonicalizerPrerequisite(policy);
  assert.deepEqual(prerequisite.parameterMigration, {
    migratedParameterRows: 0,
    completeFunctions: 0,
    completeTools: 0,
    witnesses: [],
  });
  const publishedM460 = loadPublishedCanonicalizerPrerequisiteM460();
  assert.equal(publishedM460.digest, 'c24a3f59fab134a0845980550196f5d843c05d28986ea68a6e31642e3577dfdf');
  assert.equal(publishedM460.sourceCommit, '828283e9694db3017dfc0121b6db8d6420f3988a');
  assert.deepEqual(publishedM460.record.parameterMigration, {
    migratedParameterRows: 1,
    completeFunctions: 1,
    completeTools: 1,
    witnesses: [{
      id: SORTSTRINGS_ID,
      parameterRows: 1,
      profileRows: { nodes: 25, properties: 43, values: 266 },
      tool: 'validator',
    }],
  });
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.prerequisiteRanking, []);
  assert.deepEqual(prerequisite.ranking, []);
  assert.deepEqual(prerequisite.exhaustion.activeFamilies, ['exception-flow']);
  assert.equal(prerequisite.exhaustion.evaluatedNonEmptyClosureCount, 1);
  assert.equal(prerequisite.exhaustion.completingClosureCount, 0);
  assert.equal(prerequisite.exhaustion.residualFunctionCount, 30);
});
