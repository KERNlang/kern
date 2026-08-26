import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function text(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

function segments(script) {
  return script.split(' && ').map((segment) => segment.trim());
}

function workflowJob(workflow, id) {
  const marker = `  ${id}:\n`;
  const start = workflow.indexOf(marker);
  assert.ok(start >= 0, `workflow must define ${id}`);
  const bodyStart = start + marker.length;
  const next = workflow.slice(bodyStart).search(/\n  [a-z][\w-]*:\n/u);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, bodyStart + next);
}

function commandIndex(job, command) {
  return job.indexOf(`        run: ${command}\n`);
}

const prFrontendTiers = [
  'test:pr-frontend-foundation',
  'test:pr-frontend-properties-core',
  'test:pr-frontend-properties-extended',
  'test:pr-frontend-composition',
  'test:pr-frontend-language',
  'test:pr-frontend-tooling',
];

const exhaustiveTiers = [
  'test:infra:contracts',
  'test:pr-frontend-foundation',
  'test:pr-frontend-properties-core',
  'test:pr-frontend-properties-extended',
  'test:exhaustive-frontend-composition',
  'test:pr-frontend-language',
  'test:pr-frontend-tooling',
];

function currentFrontendScripts(policy) {
  return policy.gates
    .filter(
      (gate) =>
        gate.status === 'current' &&
        gate.argv[0] === 'pnpm' &&
        (gate.id === 'kern-frontend' || gate.id.startsWith('kern-frontend-')),
    )
    .map((gate) => gate.argv[1]);
}

test('infrastructure aggregate invokes each command once', async () => {
  const packageJson = JSON.parse(await text('package.json'));
  const infra = segments(packageJson.scripts['test:infra']);
  assert.equal(infra[0], 'pnpm test:infra:contracts');
  assert.equal(new Set(infra).size, infra.length, 'test:infra contains duplicate command segments');

  const contracts = segments(packageJson.scripts['test:infra:contracts']);
  const coreBuildIndex = contracts.indexOf('pnpm --filter @kernlang/core build');
  const ownershipIndex = contracts.indexOf('pnpm test:kern-semantic-ownership');
  assert.ok(coreBuildIndex >= 0, 'contracts aggregate must build @kernlang/core');
  assert.ok(
    coreBuildIndex < ownershipIndex,
    'contracts aggregate must build @kernlang/core before semantic ownership',
  );
  for (const contractSegment of contracts) {
    assert.equal(
      infra.filter((segment) => segment === contractSegment).length,
      0,
      `test:infra repeats ${contractSegment} after the contract aggregate`,
    );
  }
});

test('focused successful-line gate excludes historical replay and cumulative wall', async () => {
  const packageJson = JSON.parse(await text('package.json'));
  const focused = packageJson.scripts['test:kern-frontend-successful-line-composition:focused'];
  assert.equal(typeof focused, 'string');
  assert.match(focused, /successful-line-composition\.test\.mjs/u);
  assert.doesNotMatch(focused, /replay\.test\.mjs/u);
  assert.doesNotMatch(focused, /successful-line-composition-regressions/u);
});

test('pull-request CI is bounded and covers the KIR Review Preview', async () => {
  const workflow = await text('.github/workflows/ci.yml');
  for (const forbidden of [
    'pnpm test\n',
    'pnpm test:non-semantics',
    'pnpm test:infra\n',
    'pnpm test:kern-frontend-successful-line-composition\n',
  ]) {
    assert.doesNotMatch(workflow, new RegExp(forbidden, 'u'));
  }
  assert.match(workflow, /pnpm test:kern-review-kir-preview/u);
  assert.match(workflow, /timeout-minutes:/u);
});

test('pull-request CI has a required-compatible aggregator and preserves setup contracts', async () => {
  const workflow = await text('.github/workflows/ci.yml');
  const packageJson = JSON.parse(await text('package.json'));
  const lanes = [
    'quality',
    'infrastructure-contracts',
    'package-tests',
    'semantics',
    'frontend-foundation',
    'frontend-properties-core',
    'frontend-properties-extended',
    'frontend-composition',
    'frontend-language',
    'frontend-tooling',
    'product-smoke',
  ];
  const aggregator = workflowJob(workflow, 'build-and-test');
  assert.match(aggregator, /name: Build & Test/u);
  assert.match(aggregator, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(aggregator, /timeout-minutes: 5/u);
  const needs = aggregator.match(/needs: \[([^\]]+)\]/u)?.[1].split(',').map((lane) => lane.trim());
  assert.deepEqual(needs, lanes, 'Build & Test needs must exactly match the required CI lanes');
  for (const lane of lanes) {
    assert.match(aggregator, new RegExp(`needs\\.${lane}\\.result`, 'u'));
    assert.match(aggregator, new RegExp(`\\b${lane}\\b`, 'u'));
  }

  assert.equal(packageJson.scripts['test:ci-contract'], 'node --test scripts/ci/test-tier-contract.test.mjs');
  assert.match(workflow, /pnpm test:ci-contract/u);
  assert.doesNotMatch(workflowJob(workflow, 'quality'), /pnpm test:kern-runtime-contract-v1/u);
  const contracts = workflowJob(workflow, 'infrastructure-contracts');
  assert.match(contracts, /timeout-minutes: 75/u);
  assert.match(contracts, /pnpm test:infra:contracts/u);
  for (const id of ['package-tests', 'product-smoke']) {
    const job = workflowJob(workflow, id);
    assert.match(job, /uses: actions\/setup-python@v6/u);
    assert.match(job, /python-version: '3\.12'/u);
    assert.match(job, /pip install mcp/u);
  }

  const packageTests = workflowJob(workflow, 'package-tests');
  assert.match(packageTests, /name: Package tests excluding IR semantics/u);
  assert.equal(
    packageJson.scripts['build:packages'],
    'tsc -b && node ./scripts/build-kern-canonicalizer-cli-assets.mjs && node ./scripts/build-kern-checker-cli-assets.mjs && node ./scripts/build-kern-formatter-cli-assets.mjs',
    'build:packages must retain the full TypeScript and CLI-artifact package train without the playground production build',
  );
  assert.equal(
    packageJson.scripts.build,
    'pnpm build:packages && pnpm --filter @kernlang/playground build',
    'root build must compose the package train with the playground production build',
  );
  const packageTestsTrainBuildIndex = commandIndex(packageTests, 'pnpm build:packages');
  const packageTestIndex = commandIndex(
    packageTests,
    "pnpm -r --filter '!kern-monorepo' --filter '!@kernlang/review-python' test --testPathIgnorePatterns=ir-semantics",
  );
  assert.ok(packageTestsTrainBuildIndex >= 0, 'package tests must build the package-only train');
  assert.ok(
    packageTestsTrainBuildIndex < packageTestIndex,
    'package tests must build the package-only train before recursive package tests',
  );
  assert.doesNotMatch(
    packageTests,
    /pnpm --filter @kernlang\/cli build/u,
    'package tests must not rely on the insufficient standalone CLI prebuild',
  );

  const productSmoke = workflowJob(workflow, 'product-smoke');
  const packageTrainBuildIndex = commandIndex(productSmoke, 'pnpm build');
  const runnerSmokeIndex = commandIndex(productSmoke, 'pnpm test:runner-smoke');
  const previewTestIndex = commandIndex(productSmoke, 'pnpm test:kern-review-kir-preview');
  assert.ok(packageTrainBuildIndex >= 0, 'product smoke must build the complete package train');
  assert.ok(
    runnerSmokeIndex < packageTrainBuildIndex && packageTrainBuildIndex < previewTestIndex,
    'product smoke must build the complete package train after runner smoke and before packed-consumer preview',
  );

  const semantics = workflowJob(workflow, 'semantics');
  assert.match(semantics, /status=0/u);
  assert.match(semantics, /pnpm test:ir-semantics 2>&1 \| tee semantics\.log \|\| status=\$\?/u);
  assert.match(semantics, /GITHUB_STEP_SUMMARY/u);
  assert.match(semantics, /exit "\$status"/u);
});

test('pull-request frontend tiers cover every current fitness gate with only the focused substitution', async () => {
  const packageJson = JSON.parse(await text('package.json'));
  const policy = JSON.parse(await text('scripts/kern-5-fitness-policy.json'));
  const expected = currentFrontendScripts(policy).map((script) =>
    script === 'test:kern-frontend-successful-line-composition'
      ? 'test:kern-frontend-successful-line-composition:focused'
      : script,
  );
  const actual = prFrontendTiers.flatMap((tier) => {
    assert.equal(typeof packageJson.scripts[tier], 'string', `${tier} must exist`);
    return segments(packageJson.scripts[tier])
      .filter((segment) => segment.startsWith('pnpm test:'))
      .map((segment) => segment.slice('pnpm '.length));
  });
  const expectedPrScripts = [
    ...expected,
    'test:kern-canonicalizer',
    'test:kern-checker',
    'test:kern-formatter',
  ];
  assert.deepEqual(
    actual,
    expectedPrScripts,
    'PR tiers must exactly retain ordered frontend coverage and terminal tooling gates',
  );
  for (const script of expected) {
    assert.doesNotMatch(
      packageJson.scripts[script],
      /-regressions\.mjs/u,
      `${script} must not run cumulative regression evidence in the PR tier`,
    );
  }
  const cumulativeScripts = Object.entries(packageJson.scripts)
    .filter(([script, command]) => script.startsWith('test:kern-frontend-') && /-regressions\.mjs/u.test(command))
    .map(([script]) => script);
  assert.deepEqual(cumulativeScripts, ['test:kern-frontend-successful-line-composition']);

  const workflow = await text('.github/workflows/ci.yml');
  for (const tier of prFrontendTiers) {
    assert.match(workflow, new RegExp(`pnpm ${tier}`, 'u'), `${tier} must run in PR CI`);
  }
});

test('scheduled exhaustive workflow retains historical evidence', async () => {
  const workflow = await text('.github/workflows/exhaustive-tests.yml');
  const packageJson = JSON.parse(await text('package.json'));
  const policy = JSON.parse(await text('scripts/kern-5-fitness-policy.json'));
  assert.match(workflow, /schedule:/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /pnpm test:infra\n/u);
  assert.match(workflow, /timeout-minutes: \$\{\{ matrix\.timeoutMinutes \}\}/u);
  assert.match(workflow, /timeoutMinutes: 75/u);
  assert.match(workflow, /timeoutMinutes: 180/u);
  for (const tier of exhaustiveTiers) {
    assert.equal(typeof packageJson.scripts[tier], 'string', `${tier} must exist`);
    assert.match(workflow, new RegExp(`pnpm ${tier}`, 'u'), `${tier} must run in the exhaustive workflow`);
  }
  const expected = currentFrontendScripts(policy);
  const expectedSet = new Set(expected);
  const actual = exhaustiveTiers.flatMap((tier) =>
    segments(packageJson.scripts[tier])
      .filter((segment) => segment.startsWith('pnpm test:'))
      .map((segment) => segment.slice('pnpm '.length)),
  ).filter((script) => expectedSet.has(script));
  assert.deepEqual(
    actual,
    expected,
    'exhaustive tiers must retain every full frontend fitness gate in policy order',
  );
  assert.match(
    packageJson.scripts['test:exhaustive-frontend-composition'],
    /test:kern-frontend-successful-line-composition &&/u,
  );
  assert.ok(
    segments(packageJson.scripts['test:infra'])
      .includes('pnpm test:kern-frontend-successful-line-composition'),
    'the local and release infrastructure aggregate must retain predecessor replay evidence',
  );
});

test('release still runs the complete test aggregate after version mutation', async () => {
  const workflow = await text('.github/workflows/release-pipeline.yml');
  assert.match(workflow, /- name: Test\s+run: pnpm test/u);
});
