export function formatM4149CanonicalSurfaceStatus(selectedNextAction, equivalence) {
  if (
    selectedNextAction?.id !== 'quotesource-neighbor-sentinel-rewrite' ||
    selectedNextAction.action !== 'replace-exact-quotesource-predicate' ||
    selectedNextAction.milestone !== 'M4.150' ||
    equivalence?.mismatches !== 0 ||
    equivalence.scalarValuesEvaluated !== 1_112_064
  ) {
    throw new TypeError('M4.149 canonical-surface analysis must select the exact M4.150 rewrite');
  }
  return 'M4.149 selects the exact quotesource neighbor-sentinel rewrite with zero profile ' +
    'blockers and 0 mismatches across 1112064 Unicode scalar values; M4.150 owns the ' +
    'KERN source rewrite.';
}
