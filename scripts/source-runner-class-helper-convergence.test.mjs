import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateSourceRunnerConvergence } from './check-source-runner-convergence.mjs';

function validate(overrides = new Map()) {
  return validateSourceRunnerConvergence((file) => overrides.get(file) ?? fs.readFileSync(file, 'utf8'));
}

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

function replace(file, before, after) {
  const current = source(file);
  assert.ok(current.includes(before), `mutation anchor missing in ${file}`);
  return new Map([[file, current.replace(before, after)]]);
}

test('rejects deletion of the pure class-helper owner', () => {
  const file = 'scripts/source-runner-convergence-manifest.json';
  const manifest = JSON.parse(source(file));
  manifest.owned = manifest.owned.filter(({ id }) => id !== 'runner-class-pure-helper-calls');
  const errors = validate(new Map([[file, JSON.stringify(manifest)]]));
  assert.ok(errors.some((error) => error.includes('runner-class-pure-helper-calls owner')));
});

test('rejects deletion of reverse-composition containment', () => {
  const errors = validate(
    replace(
      'packages/core/src/ir/semantics/internal-effect-machine-helper-graph.ts',
      'assertHelperBodyDoesNotUseClasses(fn.body, admittedClasses);',
      'void admittedClasses;',
    ),
  );
  assert.ok(errors.some((error) => error.includes('class-body helper reachability owner')));
});

test('rejects deletion of bare helper receiver containment', () => {
  const errors = validate(
    replace(
      'packages/core/src/ir/semantics/internal-effect-machine-helper-graph.ts',
      "if (node.kind === 'ident') return node.name === 'this' || node.name === 'super';",
      "if (node.kind === 'ident') return false;",
    ),
  );
  assert.ok(errors.some((error) => error.includes('class-body helper reachability owner')));
});

test('rejects deletion of the helper binding snapshot', () => {
  const errors = validate(
    replace(
      'packages/core/src/ir/semantics/internal-effect-machine-helper-graph.ts',
      'functions.set(name, snapshotFunctionBinding(fn));',
      'functions.set(name, fn);',
    ),
  );
  assert.ok(errors.some((error) => error.includes('class-body helper reachability owner')));
});

test('rejects a shallow helper metadata snapshot', () => {
  const errors = validate(
    replace(
      'packages/core/src/ir/semantics/internal-effect-machine-helper-graph.ts',
      'props: structuredClone(node.props)',
      'props: { ...node.props }',
    ),
  );
  assert.ok(errors.some((error) => error.includes('class-body helper reachability owner')));
});

test('rejects live helper metadata during nested call validation', () => {
  const errors = validate(
    replace(
      'packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts',
      'runnerFunctions: new Map(call.state.helperRegistry)',
      'runnerFunctions: call.env.runnerFunctions',
    ),
  );
  assert.ok(errors.some((error) => error.includes('snapshotted helper registry')));
});

test('rejects deletion of scalar helper return-body proof', () => {
  const errors = validate(
    replace(
      'packages/core/src/ir/semantics/internal-effect-machine-helper-graph.ts',
      'assertScalarHelperContracts(functions, env);',
      'void env;',
    ),
  );
  assert.ok(errors.some((error) => error.includes('class-body helper reachability owner')));
});

test('rejects widening class scalar slots to every portable helper', () => {
  const errors = validate(
    replace(
      'packages/core/src/ir/semantics/internal-effect-machine-class-value.ts',
      'isInternalMachineScalarHelperCall(node.callee.name, node.args.length, env)',
      'isInternalMachineHelperCall(node.callee.name, node.args.length, env)',
    ),
  );
  assert.ok(errors.some((error) => error.includes('class-body helper value owner')));
});

test('rejects deletion of nested composite helper arguments', () => {
  const errors = validate(
    replace(
      'packages/core/src/ir/semantics/internal-effect-machine-class-value.ts',
      'node.args.map((argument) => classifyInternalMachineClassHelperArgument(argument, env))',
      'node.args.map((argument) => classifyInternalMachineClassScalarValue(argument, env))',
    ),
  );
  assert.ok(errors.some((error) => error.includes('helper arguments must recurse')));
});

test('rejects helper-only admission before combined class preflight', () => {
  const errors = validate(
    replace(
      'packages/core/src/ir/semantics/source-runner-admission.ts',
      'if (internalMachineClassGraphHasClasses(env))',
      'if (false)',
    ),
  );
  assert.ok(errors.some((error) => error.includes('combined class preflight')));
});

test('rejects freezing the helper registry after structure preflight', () => {
  const file = 'packages/core/src/ir/semantics/internal-effect-machine.ts';
  const before = `state.helperRegistry = assertInternalMachineHelperGraph(nodes, env, state.classRegistry).functions;
  assertInternalEffectMachineStructureSupported(nodes, env);`;
  const after = `assertInternalEffectMachineStructureSupported(nodes, env);
  state.helperRegistry = assertInternalMachineHelperGraph(nodes, env, state.classRegistry).functions;`;
  const errors = validate(replace(file, before, after));
  assert.ok(errors.some((error) => error.includes('registry must be frozen before combined structure preflight')));
});
