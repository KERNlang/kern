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

const kern5EvidenceCommands = [
  'pnpm test:kern-5-r1-runtime-owner',
  'pnpm test:kern-5-r2-js-lowering',
  'pnpm test:kern-5-c-py-1-contract',
  'pnpm test:kern-5-cli-compiler-runtime-shadow',
  'pnpm test:kern-5-rt2-boolean-if',
  'pnpm test:kern-5-rt3-binary-expression',
  'pnpm test:kern-5-rt4-user-fn-call',
  'pnpm test:kern-5-rt5-async-user-fn-call',
  'pnpm test:kern-5-rt6-void-fallthrough',
  'pnpm census:sweep',
  'pnpm test:kern-5-admission-census',
  'pnpm test:kern-5-rt8-integer-signatures',
  'pnpm test:kern-5-runtime-envelope-max-steps',
  'pnpm test:kern-5-f5-profile-budget',
];

const shardedFrontendJobs = new Map([
  ['frontend-properties-extended', 'test:pr-frontend-properties-extended'],
  ['frontend-composition', 'test:pr-frontend-composition'],
  ['frontend-language', 'test:pr-frontend-language'],
  ['frontend-tooling', 'test:pr-frontend-tooling'],
]);

function matrixScripts(job) {
  return [...job.matchAll(/^\s+script: (test:[^\s]+)$/gmu)].map((match) => match[1]);
}

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

test('pull-request CI requires the complete KERN 5 evidence family', async () => {
  const packageJson = JSON.parse(await text('package.json'));
  assert.equal(typeof packageJson.scripts['test:kern-5-c-py-1-contract'], 'string');
  assert.equal(typeof packageJson.scripts['test:kern-5-cli-compiler-runtime-shadow'], 'string');
  assert.equal(
    packageJson.scripts['census:sweep'],
    'pnpm --filter @kernlang/core build && node scripts/ci/kern-5-census-sweep.mjs',
  );
  assert.deepEqual(
    segments(packageJson.scripts['test:kern-5-script-family']),
    kern5EvidenceCommands,
    'the KERN 5 evidence aggregate must retain every landed leaf exactly once and in dependency order',
  );

  const workflow = await text('.github/workflows/ci.yml');
  const evidence = workflowJob(workflow, 'kern-5-evidence');
  assert.match(evidence, /name: KERN 5 evidence family/u);
  assert.match(evidence, /timeout-minutes: 180/u);
  assert.match(evidence, /uses: actions\/setup-python@v7/u);
  assert.match(evidence, /python-version: '3\.12'/u);
  assert.equal(
    [...evidence.matchAll(/run: pnpm test:kern-5-script-family/gmu)].length,
    1,
    'the KERN 5 evidence aggregate must run exactly once',
  );
});

test('package tests use one parallel matrix job rather than duplicated job definitions', async () => {
  const workflow = await text('.github/workflows/ci.yml');
  const packageTests = workflowJob(workflow, 'package-tests');
  assert.match(packageTests, /strategy:\s+fail-fast: false\s+matrix:\s+include:/u);
  assert.match(packageTests, /name: packages excluding review/u);
  assert.match(
    packageTests,
    /selectorArgs: --exclude @kernlang\/review --exclude @kernlang\/review-python/u,
  );
  assert.match(packageTests, /name: review package/u);
  assert.match(packageTests, /selectorArgs: --only @kernlang\/review/u);
  assert.match(packageTests, /\$\{\{ matrix\.selectorArgs \}\}/u);
  assert.doesNotMatch(workflow, /^  package-tests-review:/mu);
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
    'kern-5-evidence',
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

  assert.equal(
    packageJson.scripts['test:ci-contract'],
    'node --test scripts/ci/test-tier-contract.test.mjs scripts/ci/kern-5-census-sweep.test.mjs',
  );
  assert.match(workflow, /pnpm test:ci-contract/u);
  assert.doesNotMatch(workflowJob(workflow, 'quality'), /pnpm test:kern-runtime-contract-v1/u);
  const contracts = workflowJob(workflow, 'infrastructure-contracts');
  assert.match(contracts, /timeout-minutes: 75/u);
  assert.match(contracts, /pnpm test:infra:contracts/u);
  for (const id of ['package-tests', 'product-smoke']) {
    const job = workflowJob(workflow, id);
    assert.match(job, /uses: actions\/setup-python@v7/u);
    assert.match(job, /python-version: '3\.12'/u);
    assert.match(job, /pip install mcp/u);
  }

  const packageTests = workflowJob(workflow, 'package-tests');
  assert.match(packageTests, /name: Package tests \(\$\{\{ matrix\.name \}\}\)/u);
  assert.equal(
    packageJson.scripts['build:packages'],
    'node ./scripts/build-kern-frontend-projection-assets.mjs && tsc -b && node ./scripts/build-kern-canonicalizer-cli-assets.mjs && node ./scripts/build-kern-checker-cli-assets.mjs && node ./scripts/build-kern-formatter-cli-assets.mjs && node ./packages/review-mcp/scripts/compile-rules.mjs',
    'build:packages must retain every selected package build side effect without the playground production build',
  );
  assert.equal(
    packageJson.scripts.build,
    'pnpm build:packages && pnpm --filter @kernlang/playground build',
    'root build must compose the package train with the playground production build',
  );
  const packageTestCommand =
    'node scripts/ci/run-prebuilt-package-tests.mjs ${{ matrix.selectorArgs }} -- --testPathIgnorePatterns=ir-semantics';
  const buildIndex = commandIndex(packageTests, 'pnpm build:packages');
  const testIndex = commandIndex(packageTests, packageTestCommand);
  assert.ok(buildIndex >= 0 && buildIndex < testIndex, 'each package matrix shard must build once before tests');
  assert.equal([...packageTests.matchAll(/run: pnpm build:packages/gmu)].length, 1);
  assert.doesNotMatch(packageTests, /run: pnpm .* test /u, 'package shards must not invoke rebuilding test scripts');

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
    const shardedJob = [...shardedFrontendJobs].find(([, aggregate]) => aggregate === tier);
    if (!shardedJob) {
      assert.match(workflow, new RegExp(`pnpm ${tier}`, 'u'), `${tier} must run in PR CI`);
      continue;
    }
    const [jobId] = shardedJob;
    const job = workflowJob(workflow, jobId);
    const expectedScripts = segments(packageJson.scripts[tier]).map((segment) => segment.slice('pnpm '.length));
    assert.deepEqual(
      matrixScripts(job),
      expectedScripts,
      `${jobId} matrix must retain each ${tier} leaf exactly once and in order`,
    );
    assert.match(job, /fail-fast: false/u, `${jobId} must report every shard failure`);
    assert.equal(
      [...job.matchAll(/run: pnpm --filter @kernlang\/core build/gmu)].length,
      1,
      `${jobId} must build core exactly once per shard`,
    );
    const expectedCliBuilds = jobId === 'frontend-tooling' ? 1 : 0;
    assert.equal(
      [...job.matchAll(/run: pnpm --filter @kernlang\/cli build/gmu)].length,
      expectedCliBuilds,
      `${jobId} must build CLI exactly ${expectedCliBuilds} times per shard`,
    );
    const builtArguments = jobId === 'frontend-tooling'
      ? '--built @kernlang/core --built @kernlang/cli'
      : '--built @kernlang/core';
    assert.match(
      job,
      new RegExp(
        `run: node scripts/ci/run-prebuilt-test\\.mjs ${builtArguments} \\$\\{\\{ matrix\\.script \\}\\}`,
        'u',
      ),
    );
    assert.doesNotMatch(job, new RegExp(`pnpm ${tier}`, 'u'), `${jobId} must not serialize its aggregate`);
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

const installingJobs = [
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
  'kern-5-evidence',
];

const baseUsesByJob = new Map([
  ['quality', ['actions/checkout@v7', 'actions/setup-node@v7', 'actions/setup-python@v7']],
  ['infrastructure-contracts', ['actions/checkout@v7', 'actions/setup-node@v7']],
  ['package-tests', ['actions/checkout@v7', 'actions/setup-node@v7', 'actions/setup-python@v7']],
  [
    'semantics',
    ['actions/checkout@v7', 'actions/setup-node@v7', 'actions/setup-python@v7', 'actions/upload-artifact@v7'],
  ],
  ['frontend-foundation', ['actions/checkout@v7', 'actions/setup-node@v7']],
  ['frontend-properties-core', ['actions/checkout@v7', 'actions/setup-node@v7']],
  ['frontend-properties-extended', ['actions/checkout@v7', 'actions/setup-node@v7']],
  ['frontend-composition', ['actions/checkout@v7', 'actions/setup-node@v7']],
  ['frontend-language', ['actions/checkout@v7', 'actions/setup-node@v7']],
  ['frontend-tooling', ['actions/checkout@v7', 'actions/setup-node@v7']],
  ['product-smoke', ['actions/checkout@v7', 'actions/setup-node@v7', 'actions/setup-python@v7']],
  ['kern-5-evidence', ['actions/checkout@v7', 'actions/setup-node@v7', 'actions/setup-python@v7']],
]);

const pnpmCacheStepBlock = [
  '      - name: Resolve pnpm store path',
  '        run: echo "STORE_PATH=$(pnpm store path)" >> "$GITHUB_ENV"',
  '      - name: Cache pnpm store',
  '        uses: actions/cache@v4',
  '        with:',
  '          path: ${{ env.STORE_PATH }}',
  "          key: ${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}",
  '',
].join('\n');

function jobUsesSet(job) {
  return new Set([...job.matchAll(/uses: (\S+)/gu)].map((match) => match[1]));
}

test('every installing job caches the pnpm store between Activate pnpm and Install dependencies', async () => {
  const workflow = await text('.github/workflows/ci.yml');
  const installCommand = 'pnpm install --frozen-lockfile --ignore-scripts';
  for (const id of installingJobs) {
    const job = workflowJob(workflow, id);
    const cacheIndex = job.indexOf(pnpmCacheStepBlock);
    assert.ok(cacheIndex >= 0, `${id} must carry the pnpm store cache block verbatim`);

    const activateIndex = job.indexOf('- name: Activate pnpm');
    assert.ok(activateIndex >= 0, `${id} must still activate pnpm`);
    assert.ok(activateIndex < cacheIndex, `${id} must cache the pnpm store after activating pnpm`);

    const installIndex = commandIndex(job, installCommand);
    assert.ok(installIndex >= 0, `${id} install command must stay exactly '${installCommand}'`);
    assert.ok(cacheIndex < installIndex, `${id} must cache the pnpm store before installing dependencies`);
  }
});

test('every installing job exposes exactly the expected uses: action set', async () => {
  const workflow = await text('.github/workflows/ci.yml');
  for (const id of installingJobs) {
    const job = workflowJob(workflow, id);
    const expected = new Set([...baseUsesByJob.get(id), 'actions/cache@v4']);
    assert.deepEqual(
      jobUsesSet(job),
      expected,
      `${id} must use exactly its expected actions plus actions/cache@v4`,
    );
  }
});

test('the concurrency gate is untouched by the pnpm cache change', async () => {
  const workflow = await text('.github/workflows/ci.yml');
  assert.match(
    workflow,
    /^concurrency:\n {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true\n\n/mu,
  );
});
