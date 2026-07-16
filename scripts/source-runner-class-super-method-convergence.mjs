export const CLASS_SUPER_METHOD_FILES = Object.freeze({
  classActivation: 'packages/core/src/ir/semantics/internal-effect-machine-class-activation.ts',
  classGraph: 'packages/core/src/ir/semantics/internal-effect-machine-class-graph.ts',
  classPreflight: 'packages/core/src/ir/semantics/internal-effect-machine-class-preflight.ts',
  classSuperMethodAdmissionTests:
    'packages/core/tests/runtime-envelope-effect-machine-class-super-method-admission.test.ts',
  classSuperMethodTests: 'packages/core/tests/runtime-envelope-effect-machine-class-super-method.test.ts',
  runnerCapabilityClassDispatch: 'packages/core/src/runner-capability-class-dispatch.ts',
  runnerCapabilityPlan: 'packages/core/src/runner-capability-plan.ts',
  runnerCapabilityPlanTests: 'packages/core/tests/runner-capability-plan.test.ts',
});

export function validateClassSuperMethodManifest(manifest, errors) {
  const owned = manifest.owned.find((item) => item?.id === 'runner-class-super-method-dispatch');
  if (
    owned?.kind !== 'environment' ||
    owned?.status !== 'unified' ||
    owned?.evidence !== CLASS_SUPER_METHOD_FILES.classSuperMethodTests ||
    Object.keys(owned).sort().join(',') !== 'evidence,id,kind,status'
  ) {
    errors.push('manifest must contain exactly one evidenced unified runner-class-super-method-dispatch owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'runner-class-super-method-dispatch').length !== 1) {
    errors.push('manifest runner-class-super-method-dispatch owner is duplicated');
  }
}

export function validateClassSuperMethodSlice(contents, errors) {
  if ((contents.classActivation?.match(/runnerSuperClass: cls\.extendsName/g) ?? []).length < 2) {
    errors.push('super-method activation must bind the declaring owner base in constructor and member environments');
  }
  for (const required of [
    "node.callee.object.name === 'super'",
    "internalMachineClassReceiver('this', env)",
    'const baseName = env.runnerSuperClass',
    "receiverName: 'this'",
  ]) {
    if (!contents.classGraph?.includes(required)) errors.push(`super-method graph owner is missing ${required}`);
  }
  for (const required of [
    'bindInternalEffectMachineState(constructorEnv, preflightState)',
    'bindInternalEffectMachineState(memberEnv, preflightState)',
    "node.callee.object.name === 'super'",
    'class method call is unavailable',
  ]) {
    if (!contents.classPreflight?.includes(required)) errors.push(`super-method preflight is missing ${required}`);
  }
  for (const required of [
    'export function runnerCapabilityClassAncestry',
    'export function resolveRunnerCapabilityClassMember',
    'ownerClass',
  ]) {
    if (!contents.runnerCapabilityClassDispatch?.includes(required)) {
      errors.push(`super-method capability dispatch owner is missing ${required}`);
    }
  }
  for (const required of [
    'item.ownerClass',
    "node.callee.object.name === 'super' && superClassName",
    'resolveRunnerCapabilityClassCall',
  ]) {
    if (!contents.runnerCapabilityPlan?.includes(required)) errors.push(`super-method capability plan is missing ${required}`);
  }
  for (const oracle of [
    'continues the overriding method after a base method returns',
    'walks a three-level declaring-owner chain with independent locals',
    'calls a base method from a constructor remainder and getter body',
    'resumes a real async base method without replaying the derived activation',
    'snapshots the declaring-owner chain and target body across async suspension',
    'injects a rejected base provider once and clears nested activation state',
    'owns linked public source with constructor and super-method dispatch',
  ]) {
    if (!contents.classSuperMethodTests?.includes(oracle)) {
      errors.push(`super-method lifecycle oracle is missing: ${oracle}`);
    }
  }
  for (const oracle of [
    'routes %s to compatibility before provider dispatch',
    'rejects a forged entry runnerSuperClass before provider dispatch',
  ]) {
    if (!contents.classSuperMethodAdmissionTests?.includes(oracle)) {
      errors.push(`super-method admission oracle is missing: ${oracle}`);
    }
  }
  if (
    !contents.runnerCapabilityPlanTests?.includes(
      'owns async base methods reached through super dispatch in capability planning',
    )
  ) {
    errors.push('super-method capability planner oracle is missing');
  }
}
