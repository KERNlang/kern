import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { validateSourceRunnerConvergence } from './check-source-runner-convergence.mjs';

const root = process.cwd();
const files = new Map(
  [
    'packages/cli/src/commands/run-options.ts',
    'packages/cli/src/commands/run.ts',
    'packages/core/src/ir/semantics/internal-effect-machine-class-graph.ts',
    'packages/core/src/ir/semantics/internal-effect-machine-helper-graph.ts',
    'packages/core/src/ir/semantics/internal-effect-machine-class-instance.ts',
    'packages/core/src/ir/semantics/internal-effect-machine-leaf.ts',
    'packages/core/src/ir/semantics/internal-effect-machine-leaf-result.ts',
    'packages/core/src/ir/semantics/internal-effect-machine-class-preflight.ts',
    'packages/core/src/ir/semantics/internal-effect-machine-class-runtime.ts',
    'packages/core/src/ir/semantics/internal-effect-machine-admission.ts',
    'packages/core/src/ir/semantics/internal-effect-machine.ts',
    'packages/core/src/ir/semantics/internal-effect-machine-eligibility.ts',
    'packages/core/src/ir/semantics/internal-effect-machine-types.ts',
    'packages/core/src/ir/semantics/portable-machine-evaluator.ts',
    'packages/core/src/ir/semantics/portable-machine-shape.ts',
    'packages/core/src/ir/semantics/runner-machine-scope.ts',
    'packages/core/src/ir/semantics/semantic-env-ownership.ts',
    'packages/core/src/ir/semantics/semantic-env.ts',
    'packages/core/src/runtime-envelope/source-runner-engine.ts',
    'packages/core/src/runner.ts',
    'packages/core/tests/runtime-envelope-effect-machine-class-state.test.ts',
    'packages/core/tests/runtime-envelope-effect-machine-class-method.test.ts',
    'packages/core/tests/runtime-envelope-effect-machine-non-root.test.ts',
    'scripts/source-runner-convergence-manifest.json',
  ].map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]),
);

function validate(mutator = () => undefined) {
  const mutated = new Map(files);
  mutator(mutated);
  return validateSourceRunnerConvergence((file) => mutated.get(file));
}

function replace(filesToMutate, file, before, after) {
  const source = filesToMutate.get(file);
  assert.ok(source.includes(before), `mutation anchor missing in ${file}`);
  filesToMutate.set(file, source.replace(before, after));
}

test('accepts the checked-in convergence contract', () => {
  assert.deepEqual(validate(), []);
});

test('rejects restored direct sync and async reference-runner calls', () => {
  for (const [selector, direct] of [
    ['executeSourceRunnerSync(handler.children ?? [], env, {', 'referenceRunSequence(handler.children ?? [], env, {'],
    ['executeSourceRunnerAsync(handler.children ?? [], env, {', 'asyncReferenceRunSequence(handler.children ?? [], env, {'],
  ]) {
    const errors = validate((mutated) => replace(mutated, 'packages/core/src/runner.ts', selector, direct));
    assert.ok(errors.some((error) => error.includes('directly calls') || error.includes('exactly once')));
  }
});

test('rejects execution catch-and-fallback and selector duplication', () => {
  const errors = validate((mutated) =>
    replace(
      mutated,
      'packages/core/src/runtime-envelope/source-runner-engine.ts',
      `if (selectedEngine(nodes, env, options) === SOURCE_RUNNER_ENGINE.machine) {
    return runInternalRuntimeEngineSync(nodes, env, options.iterationBudget);
  }
  return runSourceRunnerLegacySync(nodes, env);`,
      `try {
    if (selectedEngine(nodes, env, options) === SOURCE_RUNNER_ENGINE.machine) {
      return runInternalRuntimeEngineSync(nodes, env, options.iterationBudget);
    }
    return runSourceRunnerLegacySync(nodes, env);
  } catch {
    return runSourceRunnerLegacySync(nodes, env);
  }`,
    ),
  );
  assert.ok(errors.some((error) => error.includes('may not catch') || error.includes('exactly once')));
});

test('rejects post-construction metadata replacement', () => {
  for (const assignment of ['env.runnerCallCache = new Map();', "env['runnerCallCache'] = new Map();"]) {
    const errors = validate((mutated) =>
      replace(
        mutated,
        'packages/core/src/runner.ts',
        'trace = executeSourceRunnerSync(handler.children ?? [], env, {',
        `${assignment}\n    trace = executeSourceRunnerSync(handler.children ?? [], env, {`,
      ),
    );
    assert.ok(errors.some((error) => error.includes('replaces owned runner metadata')));
  }
});

test('rejects blocker deletion and owned-node regressions', () => {
  const blockerErrors = validate((mutated) => {
    const manifest = JSON.parse(mutated.get('scripts/source-runner-convergence-manifest.json'));
    manifest.deferred = manifest.deferred.filter(({ id }) => id !== 'runner-classes-state');
    mutated.set('scripts/source-runner-convergence-manifest.json', JSON.stringify(manifest));
  });
  assert.ok(blockerErrors.some((error) => error.includes('audited blocker set')));

  const budgetErrors = validate((mutated) => {
    const manifest = JSON.parse(mutated.get('scripts/source-runner-convergence-manifest.json'));
    manifest.owned = manifest.owned.filter(({ id }) => id !== 'iteration-budget');
    mutated.set('scripts/source-runner-convergence-manifest.json', JSON.stringify(manifest));
  });
  assert.ok(budgetErrors.some((error) => error.includes('iteration-budget owner')));

  const classMethodErrors = validate((mutated) => {
    const manifest = JSON.parse(mutated.get('scripts/source-runner-convergence-manifest.json'));
    manifest.owned = manifest.owned.filter(({ id }) => id !== 'runner-class-direct-methods');
    mutated.set('scripts/source-runner-convergence-manifest.json', JSON.stringify(manifest));
  });
  assert.ok(classMethodErrors.some((error) => error.includes('runner-class-direct-methods owner')));

  const nonRootErrors = validate((mutated) => {
    const manifest = JSON.parse(mutated.get('scripts/source-runner-convergence-manifest.json'));
    manifest.owned = manifest.owned.filter(({ id }) => id !== 'non-root-environment');
    mutated.set('scripts/source-runner-convergence-manifest.json', JSON.stringify(manifest));
  });
  assert.ok(nonRootErrors.some((error) => error.includes('non-root-environment owner')));

  const doErrors = validate((mutated) => replace(mutated, 'packages/core/src/ir/semantics/internal-effect-machine-types.ts', "do: 'unified'", "do: 'legacy'"));
  assert.ok(doErrors.some((error) => error.includes('disposition for do')));

  const expressionErrors = validate((mutated) => replace(mutated, 'packages/core/src/ir/semantics/internal-effect-machine-types.ts', "'expression-v1': 'unified'", "'expression-v1': 'legacy'"));
  assert.ok(expressionErrors.some((error) => error.includes('disposition for')));

  const eachErrors = validate((mutated) => replace(mutated, 'packages/core/src/ir/semantics/internal-effect-machine-types.ts', "each: 'unified'", "each: 'partial'"));
  assert.ok(eachErrors.some((error) => error.includes('disposition for each')));

  const lambdaErrors = validate((mutated) => replace(mutated, 'packages/core/src/ir/semantics/internal-effect-machine-types.ts', "lambda: 'unified'", "lambda: 'legacy'"));
  assert.ok(lambdaErrors.some((error) => error.includes('disposition for lambda')));

  const helperErrors = validate((mutated) => {
    const manifest = JSON.parse(mutated.get('scripts/source-runner-convergence-manifest.json'));
    manifest.owned = manifest.owned.filter(({ id }) => id !== 'helper-functions');
    mutated.set('scripts/source-runner-convergence-manifest.json', JSON.stringify(manifest));
  });
  assert.ok(helperErrors.some((error) => error.includes('helper-functions owner')));
});

test('rejects non-root environment ownership regressions', () => {
  const provenanceErrors = validate((mutated) =>
    replace(
      mutated,
      'packages/core/src/ir/semantics/semantic-env.ts',
      'markChildSemanticEnvironment(child, parent);',
      'void child; void parent;',
    ),
  );
  assert.ok(provenanceErrors.some((error) => error.includes('markChildSemanticEnvironment')));

  const descriptorErrors = validate((mutated) =>
    replace(
      mutated,
      'packages/core/src/ir/semantics/semantic-env-ownership.ts',
      'Object.getOwnPropertyDescriptor(env, key)',
      'undefined',
    ),
  );
  assert.ok(descriptorErrors.some((error) => error.includes('Object.getOwnPropertyDescriptor')));

  const earlyAdmissionErrors = validate((mutated) =>
    replace(
      mutated,
      'packages/core/src/runtime-envelope/source-runner-engine.ts',
      'if (!hasOwnedDirectEnvironment(env, true, true)) return SOURCE_RUNNER_ENGINE.legacy;',
      'void env;',
    ),
  );
  assert.ok(earlyAdmissionErrors.some((error) => error.includes('before budget or graph discovery')));

  const resumeErrors = validate((mutated) =>
    replace(
      mutated,
      'packages/core/src/ir/semantics/internal-effect-machine.ts',
      'assertEnvironmentStillEligible(nodes, env);\n    step = withMachineState(env, state, () => machine.next(result));',
      'step = withMachineState(env, state, () => machine.next(result));',
    ),
  );
  assert.ok(resumeErrors.some((error) => error.includes('post-provider next or throw')));
});

test('rejects state-only class ownership regressions', () => {
  const eligibilityErrors = validate((mutated) =>
    replace(mutated, 'packages/core/src/ir/semantics/internal-effect-machine-eligibility.ts', 'internalMachineClassGraphClaims(nodes, env) &&', 'true &&'),
  );
  assert.ok(eligibilityErrors.some((error) => error.includes('class graph claim')));

  const ownershipErrors = validate((mutated) => replace(mutated, 'packages/core/src/ir/semantics/internal-effect-machine-class-runtime.ts', 'state?.classRegistry', 'undefined'));
  assert.ok(ownershipErrors.some((error) => error.includes('state?.classRegistry')));

  const mixingErrors = validate((mutated) =>
    replace(mutated, 'packages/core/src/ir/semantics/internal-effect-machine-helper-graph.ts', 'reachable helper/class mixing is outside this slice', 'removed reachable mixing guard'),
  );
  assert.ok(mixingErrors.some((error) => error.includes('reachable helper/class mixing')));

  const metadataExpressionErrors = validate((mutated) =>
    replace(
      mutated,
      'packages/core/src/ir/semantics/internal-effect-machine-class-runtime.ts',
      'helper calls in class-owned expressions are outside this slice',
      'removed class metadata expression guard',
    ),
  );
  assert.ok(metadataExpressionErrors.some((error) => error.includes('class-owned expressions')));

  const deferredScalarErrors = validate((mutated) =>
    replace(mutated, 'packages/core/src/ir/semantics/internal-effect-machine-class-preflight.ts', 'assertDeferredMachineScalarPreflight,', 'removedDeferredScalarPreflight,'),
  );
  assert.ok(deferredScalarErrors.some((error) => error.includes('deferred scalar validation')));

  const oracleErrors = validate((mutated) =>
    replace(
      mutated,
      'packages/core/tests/runtime-envelope-effect-machine-class-state.test.ts',
      'preserves receiver state across async suspension and isolates parallel runs',
      'removed async class oracle',
    ),
  );
  assert.ok(oracleErrors.some((error) => error.includes('machine class oracle')));

  const initializationOrderErrors = validate((mutated) =>
    replace(
      mutated,
      'packages/core/tests/runtime-envelope-effect-machine-class-state.test.ts',
      'rejects a deferred constructor read before own-field initialization',
      'removed constructor initialization-order oracle',
    ),
  );
  assert.ok(initializationOrderErrors.some((error) => error.includes('machine class oracle')));
});

test('rejects direct class-method ownership regressions', () => {
  const receiverErrors = validate((mutated) =>
    replace(mutated, 'packages/core/src/ir/semantics/internal-effect-machine-class-instance.ts', 'owner === INTERNAL_MACHINE_PREFLIGHT_CLASS_OWNER', 'false'),
  );
  assert.ok(receiverErrors.some((error) => error.includes('instance ownership')));

  const metadataErrors = validate((mutated) =>
    replace(mutated, 'packages/core/src/ir/semantics/runner-machine-scope.ts', 'methodEntries: new Map(binding.methods)', 'methodSnapshot: new Map(binding.methods)'),
  );
  assert.ok(metadataErrors.some((error) => error.includes('method metadata ownership')));

  const shapeErrors = validate((mutated) => replace(mutated, 'packages/core/src/ir/semantics/portable-machine-shape.ts', 'assertPortableMachineClassMethodCallShape', 'removedClassMethodCallShape'));
  assert.ok(shapeErrors.some((error) => error.includes('whole-leaf shape owner')));

  const evaluatorErrors = validate((mutated) =>
    replace(mutated, 'packages/core/src/ir/semantics/portable-machine-evaluator.ts', 'evalInternalMachineClassMethod(node, env, evaluate)', 'PORTABLE_EVAL_NOT_HANDLED'),
  );
  assert.ok(evaluatorErrors.some((error) => error.includes('does not dispatch')));

  const oracleErrors = validate((mutated) =>
    replace(mutated, 'packages/core/tests/runtime-envelope-effect-machine-class-method.test.ts', 'preserves direct method dispatch across async suspension', 'removed async method oracle'),
  );
  assert.ok(oracleErrors.some((error) => error.includes('machine class method oracle')));
});

test('rejects missing, defaulted, or incomplete iteration-budget forwarding', () => {
  const missingRunner = validate((mutated) => replace(mutated, 'packages/core/src/runner.ts', 'iterationBudget: options.iterationBudget,', 'iterationBudget: undefined,'));
  assert.ok(missingRunner.some((error) => error.includes('options.iterationBudget')));

  const defaultedParser = validate((mutated) =>
    replace(mutated, 'packages/cli/src/commands/run-options.ts', 'return parsePositiveSafeInteger(value);', 'return parsePositiveSafeInteger(value) ?? 10000;'),
  );
  assert.ok(defaultedParser.some((error) => error.includes('without a default')));

  const missingCli = validate((mutated) => replace(mutated, 'packages/cli/src/commands/run.ts', 'iterationBudget: parsed.iterationBudget,', 'iterationBudget: undefined,'));
  assert.ok(missingCli.some((error) => error.includes('parsed.iterationBudget')));
});

test('ignores forbidden-token text in comments while rejecting executable escapes', () => {
  assert.deepEqual(
    validate((mutated) => {
      const file = 'packages/core/src/runtime-envelope/source-runner-engine.ts';
      mutated.set(file, `${mutated.get(file)}\n// process.env as any 10000\n`);
    }),
    [],
  );
  const errors = validate((mutated) => {
    const file = 'packages/core/src/runtime-envelope/source-runner-engine.ts';
    mutated.set(file, `${mutated.get(file)}\nconst unsafe = process.env as any; void unsafe;\n`);
  });
  assert.ok(errors.some((error) => error.includes('environment switch')));
  const bracketErrors = validate((mutated) => {
    const file = 'packages/core/src/runtime-envelope/source-runner-engine.ts';
    mutated.set(file, `${mutated.get(file)}\nconst unsafe = process['env']; void unsafe;\n`);
  });
  assert.ok(bracketErrors.some((error) => error.includes('environment switch')));
});
