import assert from 'node:assert/strict';

import { summarizeCanonicalizerCoverage } from './kern-canonicalizer/coverage.mjs';
import { assertCoverageSummary, writeCoverageSummary } from './kern-canonicalizer/coverage-summary-writer.mjs';
import { formatCoverageWinnerStatus } from './kern-canonicalizer/coverage-status.mjs';

const summaryUrl = new URL('./kern-canonicalizer/coverage-summary.json', import.meta.url);
const actual = summarizeCanonicalizerCoverage();
if (process.argv.includes('--write')) {
  writeCoverageSummary(summaryUrl, actual);
} else {
  assert.equal(actual.selectionProvenances.length, 3);
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
  assert.equal(actual.implementationSelectionProvenanceDigest, actual.selectionProvenances[2].digest);
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
  assert.equal(actual.base.id, 'kern.kir-canonicalizer.profile.m4.5c');
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
  ], 'M4.5c must cite the frozen binary, conditional, and call selections');
  assert.equal(actual.corpusMembers, 9, 'live M4.5c handwritten corpus count must remain exact');
  assert.equal(actual.functionCount, 104, 'live M4.5c authored function count must remain exact');
  assert.equal(actual.toolCount, 4, 'live M4.5c tool count must remain exact');
  assert.equal(actual.baseCompleteFunctions, 8, 'call promotion must complete exactly eight base functions');
  assert.equal(actual.selection.winner, null, 'live M4.5c measurement must have no single-family winner');
  assertCoverageSummary(summaryUrl, actual);
}
const leadingBlocker = actual.blockers[0];
process.stdout.write(
  `KERN canonicalizer coverage: ${actual.baseCompleteFunctions}/${actual.functionCount} base-complete; ` +
  `${leadingBlocker ? `${leadingBlocker.count} blocked by ${leadingBlocker.id}` : 'no profile blockers'}; ` +
  `${formatCoverageWinnerStatus(actual.selection.winner)}.\n`,
);
