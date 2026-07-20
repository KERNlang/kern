export const CLASS_PRE_SUPER_FILES = Object.freeze({
  classCapabilityTests: 'packages/core/tests/runner-capability-class-frame.test.ts',
  classConstruction: 'packages/core/src/ir/semantics/internal-effect-machine-class-construction.ts',
  classFrame: 'packages/core/src/ir/semantics/internal-effect-machine-class-frame.ts',
  classFramePreflight: 'packages/core/src/ir/semantics/internal-effect-machine-class-preflight.ts',
  classPreSuperAdmissionTests:
    'packages/core/tests/runtime-envelope-effect-machine-class-pre-super-admission.test.ts',
  classPreSuperSnapshotTests:
    'packages/core/tests/runtime-envelope-effect-machine-class-pre-super-snapshot.test.ts',
  classPreSuperTests: 'packages/core/tests/runtime-envelope-effect-machine-class-pre-super.test.ts',
  classRuntime: 'packages/core/src/ir/semantics/internal-effect-machine-class-runtime.ts',
});

function includesInOrder(text, tokens) {
  let offset = 0;
  for (const token of tokens) {
    const index = text.indexOf(token, offset);
    if (index < 0) return false;
    offset = index + token.length;
  }
  return true;
}

export function validateClassPreSuperManifest(manifest, errors) {
  const owned = manifest.owned.find((item) => item?.id === 'runner-class-pre-super-constructor');
  if (
    owned?.kind !== 'environment' ||
    owned?.status !== 'unified' ||
    owned?.evidence !== CLASS_PRE_SUPER_FILES.classPreSuperTests ||
    Object.keys(owned).sort().join(',') !== 'evidence,id,kind,status'
  ) {
    errors.push('manifest must contain exactly one evidenced unified runner-class-pre-super-constructor owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'runner-class-pre-super-constructor').length !== 1) {
    errors.push('manifest runner-class-pre-super-constructor owner is duplicated');
  }
}

export function validateClassPreSuperSlice(contents, errors) {
  for (const required of [
    'readonly preSuper: readonly IRNode[]',
    'readonly postSuper: readonly IRNode[]',
    'body.findIndex((node) => directSuperCall(node) !== undefined)',
    'must be one direct top-level call',
    'preSuper: body.slice(0, superIndex)',
    'postSuper: body.slice(superIndex + 1)',
  ]) {
    if (!contents.classConstruction?.includes(required)) {
      errors.push(`pre-super constructor plan is missing ${required}`);
    }
  }
  if (
    !includesInOrder(contents.classFrame ?? '', [
      'bodyRunner(plan.preSuper',
      'plan.superArguments.map',
      'evaluateInternalMachineClassConstructorLayer(base',
      'initializeInternalMachineClassLayerFields(cls',
      'bodyRunner(plan.postSuper',
    ])
  ) {
    errors.push('pre-super constructor frame lost authored descent/base/field/ascent order');
  }
  for (const required of [
    'function valueUsesPreSuperReceiver',
    'assertClassBodyExpressions(plan.preSuper, visibleFields, constructorEnv, false)',
    'analyze(plan.preSuper, 0, constructorEnv, unstableBindings, true)',
    'addInternalMachineExpressionBindings(argumentBindings, argument)',
    'if (!hasBinding(constructorEnv, name))',
    'assertDeferredMachineScalarPreflight(argument, constructorEnv, unstableBindings)',
    'analyze(plan.postSuper, 0, constructorEnv, unstableBindings, true)',
  ]) {
    if (!contents.classFramePreflight?.includes(required)) {
      errors.push(`pre-super whole-graph preflight is missing ${required}`);
    }
  }
  for (const required of [
    'internalMachineClassConstructorPlan(cls, registry).postSuper',
    'internalMachineClassConstructorPlan(resolved.cls, resolved.registry).postSuper',
  ]) {
    if (!contents.classRuntime?.includes(required)) {
      errors.push(`pre-super initialized-field approximation is missing ${required}`);
    }
  }
  for (const oracle of [
    'evaluates a pre-super local chain before the super arguments',
    'owns linked public source with a pre-super local',
    'resumes pre-super, base, and post-super effects in authored order without replay',
    'runs three-layer pre-super work on descent and post-super work on ascent',
    'cleans private state after a rejected pre-super provider without compatibility retry',
  ]) {
    if (!contents.classPreSuperTests?.includes(oracle)) {
      errors.push(`pre-super execution oracle is missing: ${oracle}`);
    }
  }
  for (const oracle of [
    'rejects pre-super %s before an earlier provider dispatch',
    'rejects a %s in super arguments before an earlier provider dispatch',
    'rejects a conditionally established pre-super local',
    'keeps helper-reached pre-super effects unsupported',
  ]) {
    if (!contents.classPreSuperAdmissionTests?.includes(oracle)) {
      errors.push(`pre-super admission oracle is missing: ${oracle}`);
    }
  }
  for (const oracle of [
    'freezes pre-super, super-argument, post-super, and lineage metadata before suspension',
    'isolates same-named pre-super locals across overlapping runs',
  ]) {
    if (!contents.classPreSuperSnapshotTests?.includes(oracle)) {
      errors.push(`pre-super snapshot oracle is missing: ${oracle}`);
    }
  }
  if (
    !contents.classCapabilityTests?.includes(
      'owns a root-reached pre-super capability while helper continuations stay separate',
    )
  ) {
    errors.push('pre-super capability-planner oracle is missing');
  }
}
