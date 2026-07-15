import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { validateSourceRunnerConvergence } from './check-source-runner-convergence.mjs';

const root = process.cwd();
const files = new Map(
  [
    'packages/core/src/ir/semantics/internal-effect-machine-types.ts',
    'packages/core/src/runtime-envelope/source-runner-engine.ts',
    'packages/core/src/runner.ts',
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
    ['executeSourceRunnerSync(handler.children ?? [], env, { policy: \'compatible\' })', 'referenceRunSequence(handler.children ?? [], env)'],
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
        "trace = executeSourceRunnerSync(handler.children ?? [], env, { policy: 'compatible' });",
        `${assignment}\n    trace = executeSourceRunnerSync(handler.children ?? [], env, { policy: 'compatible' });`,
      ),
    );
    assert.ok(errors.some((error) => error.includes('replaces owned runner metadata')));
  }
});

test('rejects blocker deletion and owned-node regressions', () => {
  const blockerErrors = validate((mutated) => {
    const manifest = JSON.parse(mutated.get('scripts/source-runner-convergence-manifest.json'));
    manifest.deferred = manifest.deferred.filter(({ id }) => id !== 'iteration-budget');
    mutated.set('scripts/source-runner-convergence-manifest.json', JSON.stringify(manifest));
  });
  assert.ok(blockerErrors.some((error) => error.includes('audited blocker set')));

  const doErrors = validate((mutated) =>
    replace(
      mutated,
      'packages/core/src/ir/semantics/internal-effect-machine-types.ts',
      "do: 'unified'",
      "do: 'legacy'",
    ),
  );
  assert.ok(doErrors.some((error) => error.includes('disposition for do')));

  const expressionErrors = validate((mutated) =>
    replace(
      mutated,
      'packages/core/src/ir/semantics/internal-effect-machine-types.ts',
      "'expression-v1': 'unified'",
      "'expression-v1': 'legacy'",
    ),
  );
  assert.ok(expressionErrors.some((error) => error.includes('disposition for')));
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
