import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateSourceRunnerConvergence } from './check-source-runner-convergence.mjs';

function validate(overrides = new Map()) {
  return validateSourceRunnerConvergence((file) => overrides.get(file) ?? fs.readFileSync(file, 'utf8'));
}

function replace(file, before, after) {
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(source.includes(before), `mutation anchor missing in ${file}`);
  return new Map([[file, source.replace(before, after)]]);
}

test('rejects deletion of final runner class-state ownership', () => {
  const file = 'scripts/source-runner-convergence-manifest.json';
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.owned = manifest.owned.filter(({ id }) => id !== 'runner-classes-state');
  assert.ok(validate(new Map([[file, JSON.stringify(manifest)]])).some((error) => error.includes('runner-classes-state')));
});

test('rejects a restored deferred module-ownership row', () => {
  const file = 'scripts/source-runner-convergence-manifest.json';
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.deferred.push({
    id: 'runner-classes-state',
    kind: 'environment',
    status: 'legacy',
    followUp: 'M3.31c-module-ownership',
  });
  assert.ok(validate(new Map([[file, JSON.stringify(manifest)]])).some((error) => error.includes('no deferred')));
});

for (const [name, file, before, after, expected] of [
  [
    'scope graph authentication',
    'packages/core/src/ir/semantics/runner-machine-scope.ts',
    'function scopeOwnershipMatches',
    'function scopeOwnershipWasRemoved',
    'module graph ownership boundary',
  ],
  [
    'function metadata snapshot',
    'packages/core/src/ir/semantics/runner-machine-scope.ts',
    'functionMetadata: new Map(',
    'functionMetadata: new WeakMap(',
    'module graph ownership boundary',
  ],
  [
    'identity-preserving function clones',
    'packages/core/src/ir/semantics/internal-effect-machine-module-graph.ts',
    'const functionClones = new Map<RunnerFunctionBinding, RunnerFunctionBinding>();',
    'const functionClones = new WeakMap<RunnerFunctionBinding, RunnerFunctionBinding>();',
    'identity-preserving module snapshot',
  ],
  [
    'original-to-snapshot scope index',
    'packages/core/src/ir/semantics/internal-effect-machine-module-graph.ts',
    'scopeByFunctions.set(original.functions, clone);',
    'void original;',
    'identity-preserving module snapshot',
  ],
  [
    'binding-keyed helper cache',
    'packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts',
    'function helperCache(state: InternalEffectMachineState, fn: RunnerFunctionBinding)',
    'function helperCache(state: InternalEffectMachineState, fn: string)',
    'defining-module helper runtime',
  ],
  [
    'resumable helper binding precedence',
    'packages/core/src/ir/semantics/internal-effect-machine-helper-contract.ts',
    '? state.resumableHelpers.has(fn)',
    '? state.resumableHelperNames?.has(name) === true',
    'binding-identity resumable helper classification',
  ],
  [
    'defining helper function scope',
    'packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts',
    'runnerFunctions: scope.functions,',
    'runnerFunctions: call.env.runnerFunctions,',
    'defining-module helper runtime',
  ],
  [
    'binding-identity recursion labels',
    'packages/core/src/ir/semantics/internal-effect-machine-class-frame.ts',
    'moduleGraph?.classIdentity.get(cls)',
    'undefined',
    'binding-identity class frame',
  ],
  [
    'receiver defining-module dispatch',
    'packages/core/src/ir/semantics/internal-effect-machine-class-graph.ts',
    'return receiver.module.classes;',
    'return internalMachineClassRegistryForEnv(env);',
    'module-relative class graph',
  ],
  [
    'whole-graph class preflight',
    'packages/core/src/ir/semantics/internal-effect-machine-class-preflight.ts',
    'classGraph.moduleGraph.scopes.flatMap',
    '[classGraph.moduleGraph.root].flatMap',
    'whole-graph class preflight',
  ],
  [
    'shared runtime linker',
    'packages/core/src/runner-runtime-scope.ts',
    'export function buildRunnerModuleScopes',
    'function buildRunnerModuleScopes',
    'shared linked runtime scope builder',
  ],
  [
    'linked planner admission',
    'packages/core/src/runner-class-frame-capability-admission.ts',
    'export function linkedClassFrameAdmission',
    'function linkedClassFrameAdmission',
    'linked capability admission',
  ],
  [
    'exact imported member reachability',
    'packages/core/src/runner-capability-linked-handlers.ts',
    'enqueueResolvedMember(',
    'enqueueEveryMember(',
    'exact linked capability reachability',
  ],
  [
    'ordinary-record containment',
    'packages/core/src/runner-capability-linked-handlers.ts',
    "const NON_CLASS = Symbol('non-class runner value');",
    "const NON_CLASS = Symbol.for('non-class runner value');",
    'exact linked capability reachability',
  ],
]) {
  test(`rejects deletion of ${name}`, () => {
    const errors = validate(replace(file, before, after));
    assert.ok(errors.some((error) => error.includes(expected)));
  });
}

test('rejects deletion of the imported helper private-class planner oracle', () => {
  const errors = validate(
    replace(
      'packages/core/tests/runner-capability-class-frame.test.ts',
      'follows an imported helper into its defining module private class',
      'private class planner coverage removed',
    ),
  );
  assert.ok(errors.some((error) => error.includes('module planner oracle')));
});

test('rejects deletion of class-reached helper binding ownership', () => {
  const errors = validate(
    replace(
      'packages/core/src/ir/semantics/internal-effect-machine-helper-class.ts',
      'reachability.helpers.add(helper)',
      'void helper',
    ),
  );
  assert.ok(errors.some((error) => error.includes('class-reached helper binding graph')));
});

test('rejects deletion of the defining-scope runtime oracle', () => {
  const errors = validate(
    replace(
      'packages/core/tests/runtime-envelope-effect-machine-module-ownership.test.ts',
      'executes an imported helper alias in its defining private helper scope',
      'defining scope coverage removed',
    ),
  );
  assert.ok(errors.some((error) => error.includes('module runtime oracle')));
});

for (const oracle of [
  'requires a budget for a private helper reached through an imported helper class',
  'prefers resumable helper binding identity over an equal display name',
  'does not classify an equal-name pure helper as resumable by display name',
  'does not resolve an imported class field initializer from the caller module',
  'snapshots an imported private helper across async suspension',
  'rejects an imported alias replaced after linker ownership',
]) {
  test(`rejects deletion of the ${oracle} oracle`, () => {
    const errors = validate(
      replace(
        'packages/core/tests/runtime-envelope-effect-machine-module-ownership.test.ts',
        oracle,
        'module ownership coverage removed',
      ),
    );
    assert.ok(errors.some((error) => error.includes('module runtime oracle')));
  });
}
