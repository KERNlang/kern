export const NON_ROOT_FILES = Object.freeze({
  nonRootAdmission: 'packages/core/src/ir/semantics/internal-effect-machine-admission.ts',
  nonRootEnvironment: 'packages/core/src/ir/semantics/semantic-env.ts',
  nonRootOwnership: 'packages/core/src/ir/semantics/semantic-env-ownership.ts',
  nonRootRuntime: 'packages/core/src/ir/semantics/internal-effect-machine.ts',
  nonRootTests: 'packages/core/tests/runtime-envelope-effect-machine-non-root.test.ts',
});

export function validateNonRootEnvironmentSlice(contents, errors) {
  const ownership = contents.nonRootOwnership;
  const environment = contents.nonRootEnvironment;
  const admission = contents.nonRootAdmission;
  const runtime = contents.nonRootRuntime;
  const tests = contents.nonRootTests;
  const sourceAdmission = contents.sourceAdmission;
  if (!ownership || !environment || !admission || !runtime || !tests || !sourceAdmission) return;

  for (const required of [
    'environmentFacts',
    'Object.getOwnPropertyDescriptor',
    'markRootSemanticEnvironment',
    'markChildSemanticEnvironment',
    'isExactSemanticEnvironment',
    'exactSemanticEnvironmentParent',
  ]) {
    if (!ownership.includes(required)) errors.push(`non-root environment provenance is missing ${required}`);
  }
  for (const required of [
    'markRootSemanticEnvironment(env)',
    'markChildSemanticEnvironment(child, parent)',
    'parent: undefined',
  ]) {
    if (!environment.includes(required)) errors.push(`semantic environment construction is missing ${required}`);
  }
  for (const required of [
    'hasOwnedDirectEnvironment',
    'exactSemanticEnvironmentParent',
    'COHERENT_CHAIN_FIELDS',
    'seen.has(current)',
    'Object.is(current.parent, recordedParent)',
  ]) {
    if (!admission.includes(required)) errors.push(`non-root environment admission is missing ${required}`);
  }
  if (!sourceAdmission.includes('if (!hasOwnedDirectEnvironment(env, true, true)) return false;')) {
    errors.push('source selection must validate owned environment fields before budget or graph discovery');
  }
  if (
    !runtime.includes('assertEnvironmentStillEligible') ||
    runtime.split('assertEnvironmentStillEligible(nodes, env);').length - 1 < 3 ||
    !runtime.includes('environment changed after provider dispatch')
  ) {
    errors.push('machine runtime must revalidate the environment before every post-provider next or throw');
  }
  for (const oracle of [
    'selects and executes an authentic child through sync and async source APIs',
    'preserves multi-level lexical reads, shadowing, local declarations, and exact ancestor writes',
    'rejects environment accessors without invoking them',
    'rejects an accessor-backed %s field without invocation',
    'rejects a replaced, spliced, or cyclic parent edge',
    'fails closed when a provider reparents the entry before machine resume',
    'revalidates after a synchronous provider before resuming the machine',
    'preserves live portable parent mutation across async suspension',
    'isolates overlapping async runs on independent child chains',
  ]) {
    if (!tests.includes(oracle)) errors.push(`non-root environment oracle is missing: ${oracle}`);
  }
}
