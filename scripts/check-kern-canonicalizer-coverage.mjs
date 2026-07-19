import assert from 'node:assert/strict';

import { summarizeCanonicalizerCoverage } from './kern-canonicalizer/coverage.mjs';
import { assertCoverageSummary, writeCoverageSummary } from './kern-canonicalizer/coverage-summary-writer.mjs';
import { formatCoverageWinnerStatus } from './kern-canonicalizer/coverage-status.mjs';

const summaryUrl = new URL('./kern-canonicalizer/coverage-summary.json', import.meta.url);
const actual = summarizeCanonicalizerCoverage();
if (process.argv.includes('--write')) {
  writeCoverageSummary(summaryUrl, actual);
} else {
  assert.deepEqual(actual.selection.winner, {
    completeFunctions: 3,
    completeTools: 1,
    id: 'binary-expression',
    occurrences: 941,
    witnesses: [
      'examples/capstone-assertion-engine/diag.kern#4:reasonTypeMismatch',
      'examples/capstone-assertion-engine/diag.kern#5:reasonValueMismatch',
      'examples/capstone-assertion-engine/diag.kern#7:reasonKeyMismatch',
    ],
  }, 'measured binary-expression tranche must remain exact');
  assertCoverageSummary(summaryUrl, actual);
}
const leadingBlocker = actual.blockers[0];
process.stdout.write(
  `KERN canonicalizer coverage: ${actual.baseCompleteFunctions}/${actual.functionCount} base-complete; ` +
  `${leadingBlocker ? `${leadingBlocker.count} blocked by ${leadingBlocker.id}` : 'no profile blockers'}; ` +
  `${formatCoverageWinnerStatus(actual.selection.winner)}.\n`,
);
