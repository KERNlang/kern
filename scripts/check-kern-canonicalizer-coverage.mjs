import assert from 'node:assert/strict';

import { summarizeCanonicalizerCoverage } from './kern-canonicalizer/coverage.mjs';
import { assertCoverageSummary, writeCoverageSummary } from './kern-canonicalizer/coverage-summary-writer.mjs';

const summaryUrl = new URL('./kern-canonicalizer/coverage-summary.json', import.meta.url);
const actual = summarizeCanonicalizerCoverage();
assert.equal(actual.selection.winner, null, 'evidence-only fallback must remain explicit until a tranche qualifies');
if (process.argv.includes('--write')) {
  writeCoverageSummary(summaryUrl, actual);
} else {
  assertCoverageSummary(summaryUrl, actual);
}
const leadingBlocker = actual.blockers[0];
process.stdout.write(
  `KERN canonicalizer coverage: ${actual.baseCompleteFunctions}/${actual.functionCount} base-complete; ` +
  `${leadingBlocker ? `${leadingBlocker.count} blocked by ${leadingBlocker.id}` : 'no profile blockers'}; ` +
  'no tranche selected.\n',
);
