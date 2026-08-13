import {
  KERN_CHECKER_FACTS_FORMAT,
  KERN_CHECKER_RESULT_FORMAT,
  KERN_CHECKER_TABLES,
  validateKernCheckerFacts as validateCompiledKernCheckerFacts,
} from '../../packages/cli/dist/kern-checker-contract.js';

import { loadKernCheckerPolicy } from './policy.mjs';

export { KERN_CHECKER_FACTS_FORMAT, KERN_CHECKER_RESULT_FORMAT };

export function checkerFactsFromFlatModule(flat) {
  const tables = {};
  for (const [name] of KERN_CHECKER_TABLES) tables[name] = [...flat[name]];
  return { format: KERN_CHECKER_FACTS_FORMAT, path: flat.path, tables };
}

export function validateKernCheckerFacts(input, providedPolicy) {
  return validateCompiledKernCheckerFacts(input, providedPolicy ?? loadKernCheckerPolicy());
}
