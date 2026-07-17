export const CLASS_HELPER_FILES = Object.freeze({
  classHelperContract: 'packages/core/src/ir/semantics/internal-effect-machine-helper-contract.ts',
  classHelperEffectsTests: 'packages/core/tests/runtime-envelope-effect-machine-class-helper-effects.test.ts',
  classHelperPortableTests: 'packages/core/tests/runtime-envelope-effect-machine-class-helper-portable.test.ts',
  classHelperReverseGraph: 'packages/core/src/ir/semantics/internal-effect-machine-helper-class.ts',
  classHelperReverseBoundaryTests:
    'packages/core/tests/runtime-envelope-effect-machine-class-helper-reverse-boundary.test.ts',
  classHelperReverseTests: 'packages/core/tests/runtime-envelope-effect-machine-class-helper-reverse.test.ts',
  classHelperRuntime: 'packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts',
  moduleGraph: 'packages/core/src/ir/semantics/internal-effect-machine-module-graph.ts',
  helperArgumentPreflight:
    'packages/core/src/ir/semantics/internal-effect-machine-helper-argument-preflight.ts',
  helperPreflight: 'packages/core/src/ir/semantics/internal-effect-machine-helper-preflight.ts',
  structureState: 'packages/core/src/ir/semantics/internal-effect-machine-structure-state.ts',
  classHelperSnapshotTests: 'packages/core/tests/runtime-envelope-effect-machine-class-helper-snapshot.test.ts',
  classHelperTests: 'packages/core/tests/runtime-envelope-effect-machine-class-helper.test.ts',
});

export function validateClassHelperManifest(manifest, errors) {
  const owned = manifest.owned.find((item) => item?.id === 'runner-class-pure-helper-calls');
  if (
    owned?.kind !== 'environment' ||
    owned?.status !== 'unified' ||
    owned?.evidence !== 'packages/core/tests/runtime-envelope-effect-machine-class-helper.test.ts' ||
    Object.keys(owned).sort().join(',') !== 'evidence,id,kind,status'
  ) {
    errors.push('manifest must contain exactly one evidenced unified runner-class-pure-helper-calls owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'runner-class-pure-helper-calls').length !== 1) {
    errors.push('manifest runner-class-pure-helper-calls owner is duplicated');
  }
  const reverse = manifest.owned.find((item) => item?.id === 'runner-helper-pure-class-calls');
  if (
    reverse?.kind !== 'environment' ||
    reverse?.status !== 'unified' ||
    reverse?.evidence !== 'packages/core/tests/runtime-envelope-effect-machine-class-helper-reverse.test.ts' ||
    Object.keys(reverse).sort().join(',') !== 'evidence,id,kind,status'
  ) {
    errors.push('manifest must contain exactly one evidenced unified runner-helper-pure-class-calls owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'runner-helper-pure-class-calls').length !== 1) {
    errors.push('manifest runner-helper-pure-class-calls owner is duplicated');
  }
  const effects = manifest.owned.find((item) => item?.id === 'runner-helper-resumable-class-effects');
  if (
    effects?.kind !== 'environment' ||
    effects?.status !== 'unified' ||
    effects?.evidence !== CLASS_HELPER_FILES.classHelperEffectsTests ||
    Object.keys(effects).sort().join(',') !== 'evidence,id,kind,status'
  ) {
    errors.push('manifest must contain exactly one evidenced unified runner-helper-resumable-class-effects owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'runner-helper-resumable-class-effects').length !== 1) {
    errors.push('manifest runner-helper-resumable-class-effects owner is duplicated');
  }
}

export function validateClassHelperSlice(contents, errors) {
  for (const required of [
    'collectClassBodyCalls(scope.classes, pending)',
    'assertInternalMachineHelperClassComposition(fn.body, defining.classes, helperEnv)',
    'ReadonlySet<RunnerFunctionBinding>',
    'assertScalarHelperContracts(functions, env, classScalarReturns)',
    'assertPortableMachineScalarShape(parseExpression(value), env, isScalarHelperCall, isPortableHelperCall)',
    'if (composition.composesClass) directResumableHelpers.add(fn)',
    'helperCalls.set(fn, nested)',
    'const resumableHelpers = transitiveResumableHelpers(directResumableHelpers, helperCalls)',
  ]) {
    if (!contents.classHelperGraph?.includes(required)) {
      errors.push(`class-body helper reachability owner is missing ${required}`);
    }
  }
  for (const required of ['props: structuredClone(node.props)', 'returns: structuredClone(binding.returns)']) {
    if (!contents.moduleGraph?.includes(required)) errors.push(`class-body helper snapshot owner is missing ${required}`);
  }
  for (const required of [
    'internalMachineClassLineageBaseFirst',
    'internalMachineClassMemberFor',
    'assertReachedConstruction',
    'assertReachedMember',
    'class binding identity cannot be reassigned',
    'portableHelperScalarShape(value, bindings)',
    'private receiver cannot cross a class member boundary',
    "if (target.kind === 'ident') return classes.get(target.name)",
  ]) {
    if (!contents.classHelperReverseGraph?.includes(required)) {
      errors.push(`reverse helper-class owner is missing ${required}`);
    }
  }
  const normalizedArgumentShape =
    'assertPortableMachineScalarShape(portableHelperScalarShape(argument, bindings), env)';
  if ((contents.classHelperReverseGraph?.split(normalizedArgumentShape).length ?? 1) - 1 !== 2) {
    errors.push('reverse helper-class owner must normalize both method and constructor scalar arguments');
  }
  for (const boundary of [
    'class instance cannot cross the helper-local boundary',
    'class use is outside the pure helper domain',
  ]) {
    if ((contents.classHelperReverseGraph?.split(boundary).length ?? 1) - 1 !== 1) {
      errors.push(`reverse helper-class owner must preserve the recursive boundary diagnostic: ${boundary}`);
    }
  }
  for (const forbidden of ['portable-reference-body', 'portable-reference-evaluator', 'async-reference-runner']) {
    if (contents.classHelperReverseGraph?.includes(forbidden)) {
      errors.push(`reverse helper-class owner imports forbidden compatibility owner ${forbidden}`);
    }
  }
  const scalarHelperCall = 'isInternalMachineScalarHelperCall(node.callee.name, node.args.length, env)';
  if ((contents.classValue?.split(scalarHelperCall).length ?? 1) - 1 !== 2) {
    errors.push('class-body helper value owner must guard both scalar calls and return fallback');
  }
  for (const required of ['isPortableScalarHelperReturnContract', 'isInternalMachineScalarHelperCall']) {
    if (!contents.classHelperContract?.includes(required)) {
      errors.push(`helper scalar return contract owner is missing ${required}`);
    }
  }
  const frozenHelperRegistry = 'runnerFunctions: scope.functions';
  if ((contents.classHelperRuntime?.split(frozenHelperRegistry).length ?? 1) - 1 !== 2) {
    errors.push('both helper execution paths must use the snapshotted helper registry for nested call shape');
  }
  for (const required of [
    'export function* evalInternalMachineHelperFrame',
    'const trace = yield* bodyRunner(fn.body, callEnv, call.state)',
    "event.op === 'stdout' || event.op === 'stderr' || event.op === 'capability'",
    'if (events.length === 0) rememberHelperValue(call, value)',
  ]) {
    if (!contents.classHelperRuntime?.includes(required)) {
      errors.push(`resumable helper runtime owner is missing ${required}`);
    }
  }
  for (const required of [
    'isInternalMachineHelperCall(node.callee.name, node.args.length, env)',
    'helper arguments cannot contain the private receiver',
    'uses a helper in super arguments',
    'helperRegistry: activeState?.helperRegistry',
  ]) {
    if (!contents.classFramePreflight?.includes(required)) {
      errors.push(`class-body helper preflight owner is missing ${required}`);
    }
  }
  for (const required of [
    'isInternalMachineScalarHelperCall(node.callee.name, node.args.length, env)',
    'isInternalMachineResumableHelperCall(node.callee.name, node.args.length, env)',
    "args === 'suspending' || isInternalMachineResumableHelperCall",
    'assertResumableCompositeArgumentShape(node, env)',
  ]) {
    if (!contents.classValue?.includes(required)) {
      errors.push(`class-body helper value owner is missing ${required}`);
    }
  }
  const helperArgumentRecursion =
    'node.args.map((argument) => classifyInternalMachineClassHelperArgument(argument, env))';
  if ((contents.classValue?.split(helperArgumentRecursion).length ?? 1) - 1 !== 2) {
    errors.push('class-body helper arguments must recurse through both scalar and composite helper calls');
  }
  if (!contents.classShape?.includes('assertPortableMachineLetShape(argument, env, portableHelperCall)')) {
    errors.push('scalar helper proof must preserve portable composite helper arguments');
  }
  const registry = contents.nonRootRuntime?.indexOf(
    'const helperGraph = assertInternalMachineHelperGraph(nodes, env, classGraph)',
  );
  const resumable = contents.nonRootRuntime?.indexOf('state.resumableHelpers = helperGraph.resumableHelpers');
  const structure = contents.nonRootRuntime?.indexOf('assertInternalEffectMachineStructureSupported(nodes, env)');
  if (
    registry === undefined ||
    resumable === undefined ||
    structure === undefined ||
    registry < 0 ||
    resumable < registry ||
    structure < resumable
  ) {
    errors.push('class-body helper registry and resumable closure must be frozen before combined structure preflight');
  }
  const classBranch = contents.sourceAdmission?.indexOf('if (internalMachineClassGraphHasClasses(env))');
  const helperBranch = contents.sourceAdmission?.indexOf(
    'else if (internalMachineHelperGraphHasReachableFunctions(nodes, env))',
  );
  if (
    classBranch === undefined ||
    helperBranch === undefined ||
    classBranch < 0 ||
    helperBranch < 0 ||
    classBranch > helperBranch
  ) {
    errors.push('source admission must run combined class preflight before helper-only preflight');
  }
  if (!contents.classCapabilityTests?.includes('owns same-root pure helpers called from an admitted class frame')) {
    errors.push('class-body helper capability planner oracle is missing');
  }
  for (const oracle of [
    'owns helper calls from a constructor, method, and getter',
    'does not replay class state or providers around an async helper call',
    'discovers helper loops reached only from a class frame',
    'keeps helper-to-class instance composition outside this slice',
    'isolates helper and class snapshots across overlapping async runs',
    'snapshots a class-reachable helper body across async suspension',
    'owns the linked public source path for pure class-to-helper calls',
  ]) {
    if (!contents.classHelperTests?.includes(oracle)) errors.push(`class-body helper oracle is missing: ${oracle}`);
  }
  for (const oracle of [
    'accepts a pure helper-local class scalar as a method argument',
    'rejects helper-local class binding %s before provider dispatch',
    'rejects helper-local class binding loop shadowing before provider dispatch',
    'owns an effectful getter reached through this',
    'rejects this passed from a class method into a helper',
    'rejects this passed between class methods',
    'rejects a non-scalar %s argument before provider dispatch',
    'rejects parenthesisless class construction before provider dispatch',
    'validates the complete scalar return around a class member',
  ]) {
    if (!contents.classHelperReverseBoundaryTests?.includes(oracle)) {
      errors.push(`reverse helper-class boundary oracle is missing: ${oracle}`);
    }
  }
  if (!contents.classHelperSnapshotTests?.includes('snapshots nested helper call metadata across async suspension')) {
    errors.push('nested helper metadata snapshot oracle is missing');
  }
  if (!contents.classHelperSnapshotTests?.includes('rejects private receiver expression %s in a helper body')) {
    errors.push('helper private receiver containment oracle is missing');
  }
  for (const oracle of [
    'owns array and record arguments passed from a class frame',
    'owns a record returned by a nested helper argument from a class frame',
    'rejects a composite helper return from a scalar class frame',
  ]) {
    if (!contents.classHelperPortableTests?.includes(oracle)) {
      errors.push(`portable class-helper oracle is missing: ${oracle}`);
    }
  }
  for (const oracle of [
    'owns helper-local construction, field/getter reads, and method calls',
    'accepts a scalar class method as the direct helper return',
    'keeps helper-created instances inside the helper invocation',
    'owns a helper-reached effectful class after an earlier provider',
    'does not reject an unused effectful member on the constructed class',
    'owns an indirectly reached effectful member',
    'preserves inherited virtual and super dispatch inside a helper',
    'rejects helper-local instance transport into a nested helper',
    'uses frozen class members after an earlier async suspension',
  ]) {
    if (!contents.classHelperReverseTests?.includes(oracle)) {
      errors.push(`reverse helper-class oracle is missing: ${oracle}`);
    }
  }
  for (const oracle of [
    'owns an effectful class reached from a helper',
    'does not plan an unused effectful member on a helper-local class',
  ]) {
    if (!contents.classCapabilityTests?.includes(oracle)) {
      errors.push(`reverse helper-class planner oracle is missing: ${oracle}`);
    }
  }
  for (const oracle of [
    'owns a capability reached through a helper-local class method',
    'resumes an effectful constructor and getter in authored order',
    'propagates resumability through a wrapper and nested helper argument',
    'resumes helper descendants inside composite argument',
    'never memoizes observable helper/class effects',
    'never memoizes helper-local class prints or leaks private trace events',
    'retains safe memoization for event-free class composition',
    'freezes helper and class bodies across an owned async suspension',
    'isolates overlapping helper/class continuations on one environment',
  ]) {
    if (!contents.classHelperEffectsTests?.includes(oracle)) {
      errors.push(`resumable helper-class oracle is missing: ${oracle}`);
    }
  }
  for (const required of [
    'evaluateInternalMachineHelperCall(node, env, state)',
    'evalInternalMachineHelperFrame(node.callee.name, values, provenance, env)',
    'isIntProvenancedExpr(argument, env)',
    "if (node.kind === 'arrayLit')",
    'evaluateInternalMachineHelperArgument(item, env, state)',
  ]) {
    if (!contents.classValueRuntime?.includes(required)) {
      errors.push(`resumable helper argument owner is missing ${required}`);
    }
  }
  if (!contents.structureState?.includes('resumableHelperNames: helperGraph.resumableHelperNames')) {
    errors.push('structure preflight must bind the resumable helper closure before admission');
  }
  if (!contents.helperPreflight?.includes('copyInternalEffectMachineState(env, callEnv)')) {
    errors.push('helper body preflight must inherit the resumable helper closure');
  }
  if (!contents.helperArgumentPreflight?.includes('assertDeferredInternalMachineHelperArgument(item')) {
    errors.push('deferred helper argument preflight must recurse through composite values');
  }
}
