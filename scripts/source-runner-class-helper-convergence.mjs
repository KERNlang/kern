export const CLASS_HELPER_FILES = Object.freeze({
  classHelperContract: 'packages/core/src/ir/semantics/internal-effect-machine-helper-contract.ts',
  classHelperPortableTests: 'packages/core/tests/runtime-envelope-effect-machine-class-helper-portable.test.ts',
  classHelperRuntime: 'packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts',
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
}

export function validateClassHelperSlice(contents, errors) {
  for (const required of [
    'collectClassBodyCalls(admittedClasses, scope.functions, pending)',
    'assertHelperBodyDoesNotUseClasses(fn.body, admittedClasses)',
    "if (node.kind === 'ident') return node.name === 'this' || node.name === 'super'",
    'snapshotFunctionBinding(fn)',
    'structuredClone(node.props)',
    'structuredClone(fn.returns)',
    'assertScalarHelperContracts(functions, env)',
    'assertPortableMachineScalarShape(parseExpression(value), env, isScalarHelperCall, isPortableHelperCall)',
    'class use is outside the pure helper domain',
  ]) {
    if (!contents.classHelperGraph?.includes(required)) {
      errors.push(`class-body helper reachability owner is missing ${required}`);
    }
  }
  const scalarHelperCall = 'isInternalMachineScalarHelperCall(node.callee.name, node.args.length, env)';
  if ((contents.classValue?.split(scalarHelperCall).length ?? 1) - 1 !== 2) {
    errors.push('class-body helper value owner must guard both scalar calls and return fallback');
  }
  for (const required of [
    'isPortableScalarHelperReturnContract',
    'isInternalMachineScalarHelperCall',
  ]) {
    if (!contents.classHelperContract?.includes(required)) {
      errors.push(`helper scalar return contract owner is missing ${required}`);
    }
  }
  if (!contents.classHelperRuntime?.includes('runnerFunctions: new Map(call.state.helperRegistry)')) {
    errors.push('helper execution must use the snapshotted helper registry for nested call shape');
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
    "return args === 'pure' ? pureScalarShape(node, env) : 'unsupported'",
    'isInternalMachineScalarHelperCall(node.callee.name, node.args.length, env)',
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
    'state.helperRegistry = assertInternalMachineHelperGraph(nodes, env, state.classRegistry).functions',
  );
  const structure = contents.nonRootRuntime?.indexOf('assertInternalEffectMachineStructureSupported(nodes, env)');
  if (registry === undefined || structure === undefined || registry < 0 || structure < 0 || registry > structure) {
    errors.push('class-body helper registry must be frozen before combined structure preflight');
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
}
