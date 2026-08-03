import {
  buildCanonicalizerPrerequisiteSummary,
} from './coverage-prerequisite.mjs';

export function measureCanonicalizerPrerequisiteForInputs(
  policy,
  sourceOverrides,
  canonicalizerPolicy,
) {
  return buildCanonicalizerPrerequisiteSummary(
    policy,
    sourceOverrides,
    canonicalizerPolicy,
    'kern.kir-canonicalizer.prerequisite-summary.3',
  );
}
