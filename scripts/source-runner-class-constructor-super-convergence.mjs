export const CLASS_CONSTRUCTOR_SUPER_FILES = Object.freeze({
  classActivation: 'packages/core/src/ir/semantics/internal-effect-machine-class-activation.ts',
  classConstruction: 'packages/core/src/ir/semantics/internal-effect-machine-class-construction.ts',
  classConstructorSuperAdmissionTests:
    'packages/core/tests/runtime-envelope-effect-machine-class-constructor-super-admission.test.ts',
  classConstructorSuperTests: 'packages/core/tests/runtime-envelope-effect-machine-class-constructor-super.test.ts',
  classFrame: 'packages/core/src/ir/semantics/internal-effect-machine-class-frame.ts',
  classFramePreflight: 'packages/core/src/ir/semantics/internal-effect-machine-class-preflight.ts',
  classLineage: 'packages/core/src/ir/semantics/internal-effect-machine-class-lineage.ts',
  classRuntime: 'packages/core/src/ir/semantics/internal-effect-machine-class-runtime.ts',
  runnerCapabilityPlanTests: 'packages/core/tests/runner-capability-plan.test.ts',
});

export function validateClassConstructorSuperManifest(manifest, errors) {
  const owned = manifest.owned.find((item) => item?.id === 'runner-class-constructor-super-lifecycle');
  if (
    owned?.kind !== 'environment' ||
    owned?.status !== 'unified' ||
    owned?.evidence !== CLASS_CONSTRUCTOR_SUPER_FILES.classConstructorSuperTests ||
    Object.keys(owned).sort().join(',') !== 'evidence,id,kind,status'
  ) {
    errors.push('manifest must contain exactly one evidenced unified runner-class-constructor-super-lifecycle owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'runner-class-constructor-super-lifecycle').length !== 1) {
    errors.push('manifest runner-class-constructor-super-lifecycle owner is duplicated');
  }
}

export function validateClassConstructorSuperSlice(contents, errors) {
  for (const required of [
    'export interface InternalMachineClassConstructorPlan',
    'function bodySuperCallCount',
    'function assertSuperArgument',
    'function effectiveBaseConstructor',
    'readonly preSuper: readonly IRNode[]',
    'readonly postSuper: readonly IRNode[]',
    'must be one direct top-level call',
    'super arguments cannot cross constructor-less base',
    'export function assertInternalMachineClassConstructorPlans',
  ]) {
    if (!contents.classConstruction?.includes(required)) {
      errors.push(`constructor-super plan owner is missing ${required}`);
    }
  }
  if (!contents.classLineage?.includes('assertInternalMachineClassConstructorPlans(registry)')) {
    errors.push('constructor-super graph admission is not bound to lineage ownership');
  }
  for (const required of [
    'export function createInternalMachineClassReceiver',
    'export function initializeInternalMachineClassLayerFields',
  ]) {
    if (!contents.classActivation?.includes(required)) {
      errors.push(`constructor-super activation owner is missing ${required}`);
    }
  }
  for (const required of [
    'function* evaluateInternalMachineClassConstructorLayer',
    'const registry = cls?.module?.classes ?? state.classRegistry',
    'state.helperBodyRunner',
    'yield* evaluateInternalMachineClassConstructorLayer(base, instance, baseValues',
    'initializeInternalMachineClassLayerFields(cls, instance.fields',
    'const trace = yield* bodyRunner(plan.preSuper, constructorEnv, state)',
    'const trace = yield* bodyRunner(plan.postSuper, constructorEnv, state)',
  ]) {
    if (!contents.classFrame?.includes(required)) errors.push(`constructor-super frame is missing ${required}`);
  }
  for (const required of [
    'function reconcileConstructorLineageInitialization',
    'reconcileConstructorLineageInitialization(lineage, resolved.registry, instance)',
    'internalMachineClassConstructorPlan(resolved.cls, resolved.registry).postSuper',
  ]) {
    if (!contents.classRuntime?.includes(required)) errors.push(`constructor-super preflight state is missing ${required}`);
  }
  for (const required of [
    'internalMachineClassConstructorPlan(cls, definingRegistry)',
    'for (const argument of plan.superArguments)',
    'assertClassBodyExpressions(plan.preSuper, visibleFields, constructorEnv, false)',
    'assertClassBodyExpressions(plan.postSuper, visibleFields, constructorEnv)',
  ]) {
    if (!contents.classFramePreflight?.includes(required)) {
      errors.push(`constructor-super whole-graph preflight is missing ${required}`);
    }
  }
  if (!contents.classLeaf?.includes('classifyInternalMachineClassConstructorArguments(value, env) !== undefined')) {
    errors.push('constructor-super root preflight must keep every construction output deferred');
  }
  if (contents.classRuntime?.includes('export function evalInternalMachineClassNew')) {
    errors.push('constructor-super lifecycle must not retain the obsolete synchronous construction path');
  }
  for (const oracle of [
    'owns a leading explicit super call through the base constructor',
    'injects implicit no-arg super through a constructor-less middle layer',
    'interleaves base fields, base constructor, derived fields, and derived constructor',
    'owns linked public source with a pure explicit super argument',
    'preflights a base constructor assignment for a later inherited field read',
    'resumes real async base and derived capabilities in authored order without replay',
    'snapshots constructor bodies and lineage before async suspension',
    'injects a rejected base provider once and clears private state without leaking the receiver',
  ]) {
    if (!contents.classConstructorSuperTests?.includes(oracle)) {
      errors.push(`constructor-super lifecycle oracle is missing: ${oracle}`);
    }
  }
  for (const oracle of [
    'routes %s to compatibility before provider dispatch',
    'keeps a derived uninitialized field override uninitialized after a base constructor assignment',
    'accepts pure scalar super arguments from constructor parameters',
    'keeps constructor-dependent outer controls deferred during preflight',
  ]) {
    if (!contents.classConstructorSuperAdmissionTests?.includes(oracle)) {
      errors.push(`constructor-super admission oracle is missing: ${oracle}`);
    }
  }
  if (
    !contents.runnerCapabilityPlanTests?.includes(
      'owns inherited async methods and no-arg base constructors in capability reachability',
    )
  ) {
    errors.push('constructor-super capability planner oracle is missing');
  }
}
