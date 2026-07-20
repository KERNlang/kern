const SUMMARY_FORMAT = 'kern.kir-canonicalizer.coverage-summary.5';

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
export function summarizeCoverageReceipt(receipt) {
  const blockerCounts = new Map();
  for (const fn of receipt.functions) {
    for (const blocker of [...fn.excludedProperties, ...(fn.profileBlockers ?? [])]) {
      blockerCounts.set(blocker, (blockerCounts.get(blocker) ?? 0) + 1);
    }
  }
  return {
    base: receipt.base,
    baseCompleteFunctions: receipt.baseCompleteFunctions,
    blockers: [...blockerCounts]
      .map(([id, count]) => ({ count, id }))
      .sort((left, right) => right.count - left.count || compareText(left.id, right.id)),
    catalogDigest: receipt.catalogDigest,
    canonicalizerDigest: receipt.canonicalizerDigest,
    canonicalizerPolicyDigest: receipt.canonicalizerPolicyDigest,
    compiledCoreDigest: receipt.compiledCoreDigest,
    composition: receipt.composition,
    corpusMembers: receipt.corpus.length,
    corpusDigest: receipt.corpusDigest,
    coverageImplementationDigest: receipt.coverageImplementationDigest,
    coveragePolicyDigest: receipt.coveragePolicyDigest,
    expressionCatalogDigest: receipt.expressionCatalogDigest,
    familyRegistryDigest: receipt.familyRegistryDigest,
    format: SUMMARY_FORMAT,
    functionCount: receipt.functions.length,
    functionFactsDigest: receipt.functionFactsDigest,
    implementationSelectionProvenanceDigest: receipt.implementationSelectionProvenanceDigest,
    policyDigest: receipt.policyDigest,
    profileDigest: receipt.profileDigest,
    selection: receipt.selection,
    selectionProvenances: receipt.selectionProvenances,
    toolCount: new Set(receipt.corpus.map(({ tool }) => tool)).size,
  };
}
