export const CLASS_GETTER_FILES = Object.freeze({
  classGetterTests: 'packages/core/tests/runtime-envelope-effect-machine-class-getter.test.ts',
});

export function validateClassGetterManifest(manifest, errors) {
  const owned = manifest.owned.find((item) => item?.id === 'runner-class-pure-getters');
  if (
    owned?.kind !== 'environment' ||
    owned?.status !== 'unified' ||
    owned?.evidence !== CLASS_GETTER_FILES.classGetterTests ||
    Object.keys(owned).sort().join(',') !== 'evidence,id,kind,status'
  ) {
    errors.push('manifest must contain exactly one evidenced unified runner-class-pure-getters owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'runner-class-pure-getters').length !== 1) {
    errors.push('manifest runner-class-pure-getters owner is duplicated');
  }
}

export function validateClassGetterSlice(contents, errors) {
  for (const required of ['assertGetter', 'internalMachineClassGetterForRead', 'getters: new Map', 'assertInternalMachineClassInheritance']) {
    if (!contents.classGraph.includes(required)) errors.push(`machine class getter graph is missing ${required}`);
  }
  for (const required of ['assertClassMemberBodies', 'evalInternalMachineClassMember', 'resolved.getter', 'makeMethodEnv']) {
    if (!contents.classRuntime.includes(required)) errors.push(`machine class getter runtime is missing ${required}`);
  }
  if (!contents.classShape.includes('export function assertPortableMachineClassGetterReadShape')) {
    errors.push('machine class getters are missing their whole-leaf shape owner');
  }
  if (!contents.classEvaluator.includes('evalInternalMachineClassMember(node, env, evaluate)')) {
    errors.push('portable machine evaluator does not dispatch the admitted class-getter leaf');
  }
  if (!contents.classLeafResult.includes('assertPortableMachineClassGetterReadShape(value, env)')) {
    errors.push('machine print leaves do not admit exact direct class-getter reads');
  }
  for (const oracle of [
    'owns linked source and direct sync getter execution',
    'owns complete root let, print, and return getter leaves',
    'declared field presence wins over a same-named getter',
    'snapshots getter metadata across async suspension',
    'routes getter %s to compatibility before provider dispatch',
    'keeps inheritance deferred before provider dispatch',
  ]) {
    if (!contents.classGetterTests.includes(oracle)) errors.push(`machine class getter oracle is missing: ${oracle}`);
  }
}
