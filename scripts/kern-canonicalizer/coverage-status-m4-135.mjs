export function formatM4135BoundedNewExpressionStatus(prerequisite) {
  const witness = prerequisite?.ranking?.[0]?.witnesses?.[0];
  if (
    prerequisite?.outcome !== 'selected' ||
    prerequisite.minimumFamilyCount !== 2 ||
    prerequisite.selectedPrerequisite?.family !== 'new-expression' ||
    prerequisite.selectedPrerequisite.occurrences !== 41 ||
    prerequisite.ranking.length !== 1 ||
    prerequisite.ranking[0].completeFunctions !== 1 ||
    prerequisite.ranking[0].migratedParameterRows !== 15 ||
    witness?.id !== 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize'
  ) {
    throw new TypeError('M4.135 must publish the exact bounded new-expression handoff');
  }
  return 'M4.135 publishes bounded new-expression support and selects new-expression ' +
    'inside the exact 2-family canonicalize closure (1 function/15 parameter rows); ' +
    'expressionsources remains projection-limited and quotesource remediation remains pending.';
}
