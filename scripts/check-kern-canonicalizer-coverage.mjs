import assert from 'node:assert/strict';

import { summarizeCanonicalizerCoverage } from './kern-canonicalizer/coverage.mjs';
import { measureCanonicalizerPrerequisite } from './kern-canonicalizer/coverage-prerequisite.mjs';
import { loadCanonicalizerIndexPrerequisiteProvenance } from './kern-canonicalizer/coverage-prerequisite-provenance.mjs';
import { assertCoverageSummary, writeCoverageSummary } from './kern-canonicalizer/coverage-summary-writer.mjs';
import { formatCoverageWinnerStatus } from './kern-canonicalizer/coverage-status.mjs';

const summaryUrl = new URL('./kern-canonicalizer/coverage-summary.json', import.meta.url);
const prerequisiteSummaryUrl = new URL(
  './kern-canonicalizer/coverage-prerequisite-summary.json',
  import.meta.url,
);
const actual = summarizeCanonicalizerCoverage();
const prerequisite = measureCanonicalizerPrerequisite();
const prerequisiteHandoff = loadCanonicalizerIndexPrerequisiteProvenance();
if (process.argv.includes('--write')) {
  writeCoverageSummary(summaryUrl, actual);
  writeCoverageSummary(prerequisiteSummaryUrl, prerequisite);
} else {
  assert.equal(actual.selectionProvenances.length, 4);
  assert.equal(actual.selectionProvenances[0].digest, '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027');
  assert.deepEqual(actual.selectionProvenances[0].record.snapshot, {
    corpusMembers: 7,
    functionCount: 98,
    selection: {
      completeFunctions: 3,
      completeTools: 1,
      id: 'binary-expression',
      occurrences: 941,
      witnesses: [
        'examples/capstone-assertion-engine/diag.kern#4:reasonTypeMismatch',
        'examples/capstone-assertion-engine/diag.kern#5:reasonValueMismatch',
        'examples/capstone-assertion-engine/diag.kern#7:reasonKeyMismatch',
      ],
    },
    toolCount: 4,
  }, 'frozen M4.3a selection provenance must remain exact');
  assert.equal(
    actual.selectionProvenances[1].digest,
    'fe15f0ff4b8b80653ddef7f3b8736f38fa2b34a928d05a32bb9eff4d0f254f2b',
  );
  assert.deepEqual(actual.selectionProvenances[1].record.snapshot, {
    corpusMembers: 8,
    functionCount: 99,
    selection: {
      completeFunctions: 2,
      completeTools: 1,
      id: 'conditional',
      occurrences: 1115,
      witnesses: [
        'examples/capstone-assertion-engine/diag.kern#0:pathAppendKey',
        'examples/capstone-assertion-engine/diag.kern#3:failResult',
      ],
    },
    toolCount: 4,
  }, 'frozen M4.3c implementation selection provenance must remain exact');
  assert.equal(
    actual.selectionProvenances[2].digest,
    '7eee28b09785d36539e45293afbe0325fe9b50c20ffc7057e0aa3997d9371605',
  );
  assert.deepEqual(actual.selectionProvenances[2].record.snapshot, {
    corpusMembers: 9,
    functionCount: 104,
    selection: {
      completeFunctions: 2,
      completeTools: 1,
      id: 'call-expression',
      occurrences: 481,
      witnesses: [
        'examples/capstone-assertion-engine/diag.kern#1:pathAppendIndex',
        'examples/capstone-assertion-engine/diag.kern#6:reasonLengthMismatch',
      ],
    },
    toolCount: 4,
  }, 'frozen M4.5 call-expression selection provenance must remain exact');
  assert.equal(
    actual.selectionProvenances[3].digest,
    '83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d',
  );
  assert.equal(actual.implementationSelectionProvenanceDigest, actual.selectionProvenances[3].digest);
  assert.deepEqual(actual.selectionProvenances[3].record.snapshot, {
    corpusMembers: 9,
    functionCount: 104,
    selection: {
      completeFunctions: 1,
      completeTools: 1,
      id: 'member-expression',
      occurrences: 259,
      witnesses: [
        'examples/capstone-checker-subset/checker-while.kern#8:isPositiveSafeIntText',
      ],
    },
    toolCount: 4,
  }, 'frozen M4.11 member-expression selection provenance must remain exact');
  assert.equal(actual.base.id, 'kern.kir-canonicalizer.profile.m4.14');
  assert.deepEqual(actual.base.promotions, [
    {
      family: 'binary-expression',
      selectionProvenanceDigest: '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027',
    },
    {
      family: 'conditional',
      selectionProvenanceDigest: 'fe15f0ff4b8b80653ddef7f3b8736f38fa2b34a928d05a32bb9eff4d0f254f2b',
    },
    {
      family: 'call-expression',
      selectionProvenanceDigest: '7eee28b09785d36539e45293afbe0325fe9b50c20ffc7057e0aa3997d9371605',
    },
    {
      family: 'member-expression',
      selectionProvenanceDigest: '83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d',
    },
  ], 'M4.14 must cite the frozen binary, conditional, call, and member selections');
  assert.equal(actual.corpusMembers, 9, 'live M4.14 handwritten corpus count must remain exact');
  assert.equal(actual.functionCount, 104, 'live M4.14 authored function count must remain exact');
  assert.equal(actual.toolCount, 4, 'live M4.14 tool count must remain exact');
  assert.equal(actual.baseCompleteFunctions, 21, 'live M4.14 base completion must remain exactly 21/104');
  assert.equal(
    actual.blockers.find(({ id }) => id === 'fn.params')?.count,
    81,
    'live M4.14 fn.params blocker count must remain exactly 81',
  );
  assert.equal(actual.selection.winner, null, 'live M4.14 measurement must have no single-family winner');
  assert.deepEqual(
    actual.selection.ranking.map(({ completeFunctions, completeTools, id }) => ({ completeFunctions, completeTools, id })),
    [
      { completeFunctions: 0, completeTools: 0, id: 'binding' },
      { completeFunctions: 0, completeTools: 0, id: 'index-expression' },
      { completeFunctions: 0, completeTools: 0, id: 'counted-iteration' },
      { completeFunctions: 0, completeTools: 0, id: 'do-statement' },
      { completeFunctions: 0, completeTools: 0, id: 'unary-expression' },
      { completeFunctions: 0, completeTools: 0, id: 'exception-flow' },
      { completeFunctions: 0, completeTools: 0, id: 'while-iteration' },
    ],
    'live M4.14 zero-completion ranking must remain exact',
  );
  assertCoverageSummary(summaryUrl, actual);
  assert.equal(prerequisite.minimumFamilyCount, 2);
  assert.deepEqual(prerequisite.selectedPrerequisite, {
    catalogFacts: 1,
    family: 'index-expression',
    occurrences: 494,
  });
  assertCoverageSummary(prerequisiteSummaryUrl, prerequisite);
  assert.equal(
    prerequisiteHandoff.digest,
    '3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869',
  );
  assert.deepEqual(prerequisiteHandoff.record.source, {
    commit: '003f3222b23d7543b529186957a67feeb72009b0',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.5',
    coverageSummarySha256: '12b26731a6f686f55e8e80736bbb6bdd7bbcb5e7ed514be9628885ddd8ef627c',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.1',
    prerequisiteSummarySha256: '54146de715b207e507d56e303937d0531d8832a5ced3e162b0288be83865f49f',
  });
  assert.deepEqual(prerequisiteHandoff.record.snapshot.selectedPrerequisite, {
    catalogFacts: 1,
    family: 'index-expression',
    occurrences: 494,
  });
}
const leadingBlocker = actual.blockers[0];
process.stdout.write(
  `KERN canonicalizer coverage: ${actual.baseCompleteFunctions}/${actual.functionCount} base-complete; ` +
  `${leadingBlocker ? `${leadingBlocker.count} blocked by ${leadingBlocker.id}` : 'no profile blockers'}; ` +
  `${formatCoverageWinnerStatus(actual.selection.winner)}; ` +
  `next prerequisite ${prerequisite.selectedPrerequisite.family} from a ` +
  `${prerequisite.minimumFamilyCount}-family closure.\n`,
);
