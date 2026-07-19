import assert from 'node:assert/strict';

import { summarizeCanonicalizerCoverage } from './kern-canonicalizer/coverage.mjs';
import { assertCoverageSummary, writeCoverageSummary } from './kern-canonicalizer/coverage-summary-writer.mjs';
import { formatCoverageWinnerStatus } from './kern-canonicalizer/coverage-status.mjs';

const summaryUrl = new URL('./kern-canonicalizer/coverage-summary.json', import.meta.url);
const actual = summarizeCanonicalizerCoverage();
if (process.argv.includes('--write')) {
  writeCoverageSummary(summaryUrl, actual);
} else {
  assert.equal(actual.selectionProvenance.digest, '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027');
  assert.deepEqual(actual.selectionProvenance.record.snapshot, {
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
  assert.equal(actual.functionCount, 99, 'live M4.3b authored function count must remain exact');
  assert.equal(actual.toolCount, 4, 'live M4.3b tool count must remain exact');
  assert.deepEqual(actual.selection.winner, {
    completeFunctions: 3,
    completeTools: 1,
    id: 'binary-expression',
    occurrences: 1002,
    witnesses: [
      'examples/capstone-assertion-engine/diag.kern#4:reasonTypeMismatch',
      'examples/capstone-assertion-engine/diag.kern#5:reasonValueMismatch',
      'examples/capstone-assertion-engine/diag.kern#7:reasonKeyMismatch',
    ],
  }, 'live M4.3b binary-expression measurement must remain exact');
  assertCoverageSummary(summaryUrl, actual);
}
const leadingBlocker = actual.blockers[0];
process.stdout.write(
  `KERN canonicalizer coverage: ${actual.baseCompleteFunctions}/${actual.functionCount} base-complete; ` +
  `${leadingBlocker ? `${leadingBlocker.count} blocked by ${leadingBlocker.id}` : 'no profile blockers'}; ` +
  `${formatCoverageWinnerStatus(actual.selection.winner)}.\n`,
);
