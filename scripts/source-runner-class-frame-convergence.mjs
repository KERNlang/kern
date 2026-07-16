export const CLASS_FRAME_FILES = Object.freeze({
  classActivation: 'packages/core/src/ir/semantics/internal-effect-machine-class-activation.ts',
  classCapabilityAdmission: 'packages/core/src/runner-class-frame-capability-admission.ts',
  classCapabilityPlanner: 'packages/core/src/runner-capability-plan.ts',
  classCapabilityReachability: 'packages/core/src/runner-capability-requirement-reachability.ts',
  classCapabilityTests: 'packages/core/tests/runner-capability-class-frame.test.ts',
  classFrame: 'packages/core/src/ir/semantics/internal-effect-machine-class-frame.ts',
  classFrameLeaf: 'packages/core/src/ir/semantics/internal-effect-machine-class-leaf.ts',
  classFramePreflight: 'packages/core/src/ir/semantics/internal-effect-machine-class-preflight.ts',
  classFrameTests: 'packages/core/tests/runtime-envelope-effect-machine-class-frame.test.ts',
  classValue: 'packages/core/src/ir/semantics/internal-effect-machine-class-value.ts',
  classValueRuntime: 'packages/core/src/ir/semantics/internal-effect-machine-class-value-runtime.ts',
  runnerError: 'packages/core/src/runner-error.ts',
  runnerScope: 'packages/core/src/runner-runtime-scope.ts',
  sourceAdmission: 'packages/core/src/ir/semantics/source-runner-admission.ts',
});

export function validateClassFrameManifest(manifest, errors) {
  const owned = manifest.owned.find((item) => item?.id === 'runner-class-resumable-frames');
  if (
    owned?.kind !== 'environment' ||
    owned?.status !== 'unified' ||
    owned?.evidence !== CLASS_FRAME_FILES.classFrameTests ||
    Object.keys(owned).sort().join(',') !== 'evidence,id,kind,status'
  ) {
    errors.push('manifest must contain exactly one evidenced unified runner-class-resumable-frames owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'runner-class-resumable-frames').length !== 1) {
    errors.push('manifest runner-class-resumable-frames owner is duplicated');
  }
}

export function validateClassFrameSlice(contents, errors) {
  const combined = Object.keys(CLASS_FRAME_FILES)
    .map((key) => contents[key] ?? '')
    .join('\n');
  for (const forbidden of ['portable-reference-body', 'portable-reference-evaluator', 'async-reference-runner']) {
    if (combined.includes(forbidden)) errors.push(`resumable class frame imports forbidden compatibility owner ${forbidden}`);
  }
  for (const required of [
    "export type InternalMachineClassValueDisposition = 'pure' | 'suspending' | 'unsupported'",
    'classifyInternalMachineClassScalarValue',
    'classifyInternalMachineClassLetValue',
    'classifyInternalMachineClassReturnValue',
  ]) {
    if (!contents.classValue?.includes(required)) {
      errors.push(`resumable class value classifier is missing ${required}`);
    }
  }
  for (const required of [
    'buildSingleModuleRunnerRootScope',
    'return sourceRunnerMachineAdmission(handler.children ?? [], env, iterationBudget);',
  ]) {
    if (!contents.classCapabilityAdmission?.includes(required)) {
      errors.push(`class-frame capability admission is missing ${required}`);
    }
  }
  for (const required of ['ownsSingleModuleClassFrames', 'ownsClassFrames', 'u: !ownsClassFrames']) {
    if (!contents.classCapabilityPlanner?.includes(required)) {
      errors.push(`class-frame capability planner is missing ${required}`);
    }
  }
  for (const required of ['buildSingleModuleRunnerRootScope', 'markRunnerMachineRootScope']) {
    if (!contents.runnerScope?.includes(required)) errors.push(`runner root scope extraction is missing ${required}`);
  }
  for (const required of ['requiresIterationBudget', 'classBodyRequiresIterationBudget']) {
    if (!contents.classGraph?.includes(required)) errors.push(`class-frame iteration admission is missing ${required}`);
  }
  if (!contents.sourceAdmission?.includes('internalMachineClassGraphRequiresIterationBudget(env)')) {
    errors.push('source-runner engine does not require caller-owned budgets for class frames');
  }
  for (const required of [
    'export function* evaluateInternalMachineClassScalarValue',
    'append(events, yield* evaluateInternalMachineClassScalarValue(node.left, env, state))',
    'return yield* evaluateInternalMachineClassMethodFrame',
  ]) {
    if (!contents.classValueRuntime?.includes(required)) {
      errors.push(`resumable class value runtime is missing ${required}`);
    }
  }
  for (const required of [
    'export function* evaluateInternalMachineClassMethodFrame',
    'export function* evaluateInternalMachineClassGetterFrame',
    'export function* evaluateInternalMachineClassNewFrame',
    'const trace = yield* bodyRunner(body, constructorEnv, state)',
    'const trace = yield* bodyRunner(resolved.method.body, methodEnv, state)',
    'const trace = yield* bodyRunner(resolved.getter.body, getterEnv, state)',
  ]) {
    if (!contents.classFrame?.includes(required)) errors.push(`resumable class frame is missing ${required}`);
  }
  if (!contents.classFrameLeaf?.includes('yield* evaluateInternalMachineClassLetValue')) {
    errors.push('resumable class leaf does not delegate construction through the generator');
  }
  for (const required of [
    'assertInternalMachineClassFramePreflight',
    "new Set([...member.params, 'this'])",
    'assertClassBodyExpressions',
    'must return on every path',
  ]) {
    if (!contents.classFramePreflight?.includes(required)) {
      errors.push(`resumable class preflight is missing ${required}`);
    }
  }
  for (const oracle of [
    'resumes a sync constructor without replaying pre-yield receiver mutation',
    'preserves left-to-right binary invocation order without replaying a completed sibling',
    'isolates async getter activations across overlapping runs',
    'injects provider rejection once, restores private machine state, and never retries compatibility',
    'rejects an uninitialized member field before provider dispatch',
    'accepts an uninitialized field after a definite constructor assignment',
    'rejects an unsupported inactive descendant before an earlier provider executes',
    'composes class frames through constructor arguments, templates, lazy conditionals, and short circuits',
    'uses a suspended constructor argument in a later pure field expression',
    'requires and consumes the caller-owned iteration budget for class-body loops',
    'rejects constructor control flow that could complete abnormally through mutated receiver state',
    'keeps multi-statement class calls in assignment values on compatibility before dispatch',
    'rejects malformed or unavailable class assignment target %s before provider dispatch',
  ]) {
    if (!contents.classFrameTests?.includes(oracle)) {
      errors.push(`resumable class frame oracle is missing: ${oracle}`);
    }
  }
  for (const oracle of [
    'clears unsupported only when the selected entry owns the class frame',
    'keeps helper and class composition unsupported before provider dispatch',
    'requires a caller-owned budget before planning a class-body loop as owned',
  ]) {
    if (!contents.classCapabilityTests?.includes(oracle)) {
      errors.push(`class-frame capability oracle is missing: ${oracle}`);
    }
  }
}
