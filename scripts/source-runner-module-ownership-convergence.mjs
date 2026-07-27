export const MODULE_OWNERSHIP_FILES = Object.freeze({
  moduleClassActivation: 'packages/core/src/ir/semantics/internal-effect-machine-class-activation.ts',
  moduleClassFrame: 'packages/core/src/ir/semantics/internal-effect-machine-class-frame.ts',
  moduleClassGraph: 'packages/core/src/ir/semantics/internal-effect-machine-class-graph.ts',
  moduleClassPreflight: 'packages/core/src/ir/semantics/internal-effect-machine-class-preflight.ts',
  moduleGraph: 'packages/core/src/ir/semantics/internal-effect-machine-module-graph.ts',
  moduleHelperClass: 'packages/core/src/ir/semantics/internal-effect-machine-helper-class.ts',
  moduleHelperContract: 'packages/core/src/ir/semantics/internal-effect-machine-helper-contract.ts',
  moduleHelperGraph: 'packages/core/src/ir/semantics/internal-effect-machine-helper-graph.ts',
  moduleHelperRuntime: 'packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts',
  modulePlanner: 'packages/core/src/runner-capability-linked-handlers.ts',
  modulePlannerAdmission: 'packages/core/src/runner-class-frame-capability-admission.ts',
  modulePlannerTests: 'packages/core/tests/runner-capability-class-frame.test.ts',
  moduleRuntimeScope: 'packages/core/src/runner-runtime-scope.ts',
  moduleRuntimeTests: 'packages/core/tests/runtime-envelope-effect-machine-module-ownership.test.ts',
  moduleScopeOwner: 'packages/core/src/ir/semantics/runner-machine-scope.ts',
  moduleState: 'packages/core/src/ir/semantics/internal-effect-machine-types.ts',
  moduleSourceRunner: 'packages/core/src/runner.ts',
});

function requireAll(text, requirements, label, errors) {
  for (const required of requirements) {
    if (!text?.includes(required)) errors.push(`${label} is missing ${required}`);
  }
}

export function validateModuleOwnershipManifest(manifest, errors) {
  const owner = manifest.owned.find((item) => item?.id === 'runner-classes-state');
  if (
    owner?.kind !== 'environment' ||
    owner?.status !== 'unified' ||
    owner?.evidence !== MODULE_OWNERSHIP_FILES.moduleRuntimeTests ||
    Object.keys(owner).sort().join(',') !== 'evidence,id,kind,status'
  ) {
    errors.push('manifest must contain exactly one evidenced unified runner-classes-state owner');
  }
  if (manifest.owned.filter((item) => item?.id === 'runner-classes-state').length !== 1) {
    errors.push('manifest runner-classes-state owner is duplicated');
  }
  if (manifest.deferred.length !== 0) errors.push('M3.31c manifest must have no deferred convergence rows');
}

export function validateModuleOwnershipSlice(contents, errors) {
  const combined = Object.keys(MODULE_OWNERSHIP_FILES)
    .map((key) => contents[key] ?? '')
    .join('\n');
  for (const forbidden of ['portable-reference-body', 'portable-reference-evaluator', 'async-reference-runner']) {
    if (combined.includes(forbidden)) errors.push(`module ownership imports forbidden compatibility owner ${forbidden}`);
  }

  requireAll(
    contents.moduleScopeOwner,
    [
      'function scopeGraph(root: RunnerModuleScope)',
      'function scopeOwnershipMatches',
      'functionMetadata: new Map',
      'classEntries: new Map(candidate.classes)',
      'functionEntries: new Map(candidate.functions)',
      'metadataMatchesSnapshot',
      'export function runnerMachineScopeGraph',
    ],
    'module graph ownership boundary',
    errors,
  );
  requireAll(
    contents.moduleGraph,
    [
      'runnerMachineScopeGraph(functions, env.runnerClasses)',
      'const scopeClones = new Map<RunnerModuleScope, RunnerModuleScope>()',
      'const functionClones = new Map<RunnerFunctionBinding, RunnerFunctionBinding>()',
      'const classClones = new Map<RunnerClassBinding, RunnerClassBinding>()',
      'body: binding.body.map(snapshotNode)',
      'props: structuredClone(node.props)',
      'scopeByFunctions.set(original.functions, clone)',
      'scopeByFunctions.set(clone.functions, clone)',
      'functionIdentity: new Map',
      'classIdentity: new Map',
    ],
    'identity-preserving module snapshot',
    errors,
  );
  requireAll(
    contents.moduleHelperContract,
    [
      'state?.resumableHelpers',
      '? state.resumableHelpers.has(fn)',
      ': state?.resumableHelperNames?.has(name) === true',
    ],
    'binding-identity resumable helper classification',
    errors,
  );
  requireAll(
    contents.moduleHelperClass,
    [
      'interface ClassReachability',
      'readonly helpers: Set<RunnerFunctionBinding>',
      'reachability.helpers.add(helper)',
      'readonly reachableFunctions: ReadonlySet<RunnerFunctionBinding>',
      'reachableFunctions: reachability.helpers',
    ],
    'class-reached helper binding graph',
    errors,
  );
  requireAll(
    contents.moduleHelperGraph,
    [
      'ReadonlySet<RunnerFunctionBinding>',
      'fn.module.functions.get(fn.name) !== fn',
      'const helperCalls = new Map<RunnerFunctionBinding',
      'assertInternalMachineHelperClassComposition(fn.body, defining.classes, helperEnv)',
      'for (const called of composition.reachableFunctions) nested.add(called)',
      'transitiveResumableHelpers(directResumableHelpers, helperCalls)',
    ],
    'binding-identity helper graph',
    errors,
  );
  requireAll(
    contents.moduleHelperRuntime,
    [
      'internalMachineFunctionForEnv(state.moduleGraph, env, name)',
      'function helperCache(state: InternalEffectMachineState, fn: RunnerFunctionBinding)',
      'const scope = fn.module',
      'runnerClasses: scope.classes',
      'moduleGraph?.functionIdentity.get(fn)',
    ],
    'defining-module helper runtime',
    errors,
  );
  if ((contents.moduleHelperRuntime?.split('runnerFunctions: scope.functions').length ?? 1) - 1 !== 1) {
    errors.push('defining-module helper runtime must install the exact function scope in its shared call environment');
  }
  if ((contents.moduleHelperRuntime?.split('helperCallEnvironment(call)').length ?? 1) - 1 !== 2) {
    errors.push('both defining-module helper execution paths must use the shared call environment');
  }
  requireAll(
    contents.moduleState,
    [
      'helperCallCache?: Map<RunnerFunctionBinding, Map<string, unknown>>',
      'moduleGraph?: InternalMachineModuleGraph',
      'resumableHelpers?: ReadonlySet<RunnerFunctionBinding>',
    ],
    'module-owned runtime state',
    errors,
  );
  requireAll(
    contents.moduleClassActivation,
    ['const scope = cls.module', 'runnerClasses: scope?.classes', 'runnerFunctions: scope?.functions'],
    'defining-module class activation',
    errors,
  );
  requireAll(
    contents.moduleClassFrame,
    [
      'moduleGraph?.classIdentity.get(cls)',
      'const registry = cls?.module?.classes ?? state.classRegistry',
      'const frameIdentity = classFrameIdentity',
    ],
    'binding-identity class frame',
    errors,
  );
  requireAll(
    contents.moduleClassGraph,
    [
      'for (const scope of moduleGraph.scopes)',
      'receiver.module.classes',
      'moduleGraph.scopes.some((scope) => scope.classes.size > 0)',
    ],
    'module-relative class graph',
    errors,
  );
  requireAll(
    contents.moduleClassPreflight,
    [
      'classGraph.moduleGraph.scopes.flatMap',
      'const definingRegistry = cls.module?.classes ?? registry',
      'internalMachineClassConstructorPlan(cls, definingRegistry)',
    ],
    'whole-graph class preflight',
    errors,
  );
  requireAll(
    contents.moduleRuntimeScope,
    ['export function buildRunnerModuleScopes', 'resolveExport', 'scope.functions.set(imported.localName, resolved.binding'],
    'shared linked runtime scope builder',
    errors,
  );
  requireAll(
    contents.moduleSourceRunner,
    ['buildRunnerModuleScopes(records)', 'markRunnerMachineRootScope(rootScope)'],
    'source runner linked scope installation',
    errors,
  );
  requireAll(
    contents.modulePlannerAdmission,
    ['export function linkedClassFrameAdmission', 'buildRunnerModuleScopes(records)', 'markRunnerMachineRootScope(rootScope)'],
    'linked capability admission',
    errors,
  );
  requireAll(
    contents.modulePlanner,
    [
      'export function linkedExecutableKernHandlers',
      "const NON_CLASS = Symbol('non-class runner value');",
      'binding.module ?? fallbackScope',
      'enqueueConstruction',
      'enqueueResolvedMember',
      'owner.module ?? startClass.module',
    ],
    'exact linked capability reachability',
    errors,
  );
  if ((contents.modulePlanner?.split('enqueueResolvedMember').length ?? 1) - 1 !== 3) {
    errors.push('exact linked capability reachability must preserve selected-member dispatch');
  }

  for (const oracle of [
    'executes an imported helper alias in its defining private helper scope',
    'requires a budget for a private helper reached through an imported helper class',
    'partitions equal private helper names by defining binding identity',
    'prefers resumable helper binding identity over an equal display name',
    'does not classify an equal-name pure helper as resumable by display name',
    'suspends in an imported class alias and dispatches through its defining module',
    'does not resolve an imported class field initializer from the caller module',
    'does not confuse equal class member labels across defining modules',
    'rejects a helper inserted after the linker ownership mark',
    'snapshots an imported private helper across async suspension',
    'rejects an imported alias replaced after linker ownership',
  ]) {
    if (!contents.moduleRuntimeTests?.includes(oracle)) errors.push(`module runtime oracle is missing: ${oracle}`);
  }
  for (const oracle of [
    'owns an imported class frame when its capability is reachable',
    'follows an imported helper into its defining module private class',
    'keeps class identity through an aliased additive re-export',
    'does not plan an unused effectful member on an imported class',
  ]) {
    if (!contents.modulePlannerTests?.includes(oracle)) errors.push(`module planner oracle is missing: ${oracle}`);
  }
}
