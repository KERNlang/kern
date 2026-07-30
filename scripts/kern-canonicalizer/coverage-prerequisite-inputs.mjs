import {
  buildCanonicalizerPrerequisiteSummary,
} from './coverage-prerequisite.mjs';

export function measureCanonicalizerPrerequisiteForInputs(policy, sourceOverrides) {
  return buildCanonicalizerPrerequisiteSummary(policy, sourceOverrides);
}
