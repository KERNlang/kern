import { loadCoveragePolicy } from './coverage.mjs';
import {
  validateCanonicalizerPrerequisiteSummaryAgainst,
} from './coverage-prerequisite.mjs';

export function validateCanonicalizerPrerequisiteSummaryStructure(
  summary,
  policy = loadCoveragePolicy(),
) {
  return validateCanonicalizerPrerequisiteSummaryAgainst(summary, policy, summary);
}
