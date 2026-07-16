export const CLASS_VIRTUAL_METHOD_FILES = Object.freeze({
  classFrame: 'packages/core/src/ir/semantics/internal-effect-machine-class-frame.ts',
  classGraph: 'packages/core/src/ir/semantics/internal-effect-machine-class-graph.ts',
  classPreflight: 'packages/core/src/ir/semantics/internal-effect-machine-class-preflight.ts',
  classVirtualMethodAdmissionTests:
    'packages/core/tests/runtime-envelope-effect-machine-class-virtual-method-admission.test.ts',
  classVirtualMethodTests: 'packages/core/tests/runtime-envelope-effect-machine-class-virtual-method.test.ts',
  runnerCapabilityClassDispatch: 'packages/core/src/runner-capability-class-dispatch.ts',
  runnerCapabilityPlan: 'packages/core/src/runner-capability-plan.ts',
  virtualRunnerCapabilityPlanTests: 'packages/core/tests/runner-capability-plan-virtual-method.test.ts',
});

export function validateClassVirtualMethodManifest(manifest, errors) {
  const owned = manifest.owned.find((item) => item?.id === 'runner-class-virtual-this-method-dispatch');
  if (
    owned?.kind !== 'environment' ||
    owned?.status !== 'unified' ||
    owned?.evidence !== CLASS_VIRTUAL_METHOD_FILES.classVirtualMethodTests ||
    Object.keys(owned).sort().join(',') !== 'evidence,id,kind,status'
  ) {
    errors.push('manifest must contain exactly one evidenced unified runner-class-virtual-this-method-dispatch owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'runner-class-virtual-this-method-dispatch').length !== 1) {
    errors.push('manifest runner-class-virtual-this-method-dispatch owner is duplicated');
  }
}

export function validateClassVirtualMethodSlice(contents, errors) {
  for (const required of [
    "node.callee.object.name === 'this'",
    "internalMachineClassReceiver('this', env)",
    'registry.get(receiver.className)',
    "receiverName: 'this'",
  ]) {
    if (!contents.classGraph?.includes(required)) errors.push(`virtual-method graph owner is missing ${required}`);
  }
  for (const required of ['const label = `${resolved.cls.name}.${resolved.method.name}`', 'recursive member call']) {
    if (!contents.classFrame?.includes(required)) errors.push(`virtual-method frame owner is missing ${required}`);
  }
  for (const required of [
    "node.callee.object.name === 'super' || node.callee.object.name === 'this'",
    'const allowClassCall',
    'class method call is unavailable',
  ]) {
    if (!contents.classPreflight?.includes(required)) {
      errors.push(`virtual-method preflight owner is missing ${required}`);
    }
  }
  for (const required of [
    'readonly receiverClass: string',
    'export function runnerCapabilityClassCallKey',
    'export function resolveRunnerCapabilityClassCall',
    'runner capability class call key is malformed',
  ]) {
    if (!contents.runnerCapabilityClassDispatch?.includes(required)) {
      errors.push(`virtual-method capability dispatch owner is missing ${required}`);
    }
  }
  for (const required of [
    'item.receiverClass',
    "node.callee.object.name === 'this' && receiverClass",
    'runnerCapabilityClassCallKey(receiverClass, receiverClass',
    'resolveRunnerCapabilityClassCall',
    'key: `constructor:${name}:${className}`',
  ]) {
    if (!contents.runnerCapabilityPlan?.includes(required)) {
      errors.push(`virtual-method capability plan is missing ${required}`);
    }
  }
  for (const oracle of [
    'dispatches a base template call to the nearest derived override',
    'chains concrete virtual lookup into declaring-owner super lookup',
    'dispatches virtually from a base constructor remainder and getter body',
    'resumes an async derived override without replaying its base template',
    'snapshots the virtual target body and lineage across async suspension',
    'rejects %s virtual recursion with compatibility call-stack semantics',
    'fails before a provider when a base constructor dispatch reads an uninitialized derived field',
    'does not retry compatibility after a rejected virtual override provider',
    'owns linked public source with virtual and nested super dispatch',
  ]) {
    if (!contents.classVirtualMethodTests?.includes(oracle)) {
      errors.push(`virtual-method lifecycle oracle is missing: ${oracle}`);
    }
  }
  for (const oracle of [
    'routes %s to compatibility before provider dispatch',
    'rejects a forged entry runnerThis before provider dispatch',
  ]) {
    if (!contents.classVirtualMethodAdmissionTests?.includes(oracle)) {
      errors.push(`virtual-method admission oracle is missing: ${oracle}`);
    }
  }
  if (
    !contents.virtualRunnerCapabilityPlanTests?.includes(
      'owns exact virtual overrides while preserving nested super ancestry in capability planning',
    )
  ) {
    errors.push('virtual-method capability planner oracle is missing');
  }
  if (
    !contents.virtualRunnerCapabilityPlanTests?.includes(
      'keeps shared base constructors distinct for two concrete virtual receivers',
    )
  ) {
    errors.push('virtual-method constructor capability planner oracle is missing');
  }
}
