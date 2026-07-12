import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function workflow(name) {
  return readFile(path.join(repoRoot, '.github/workflows', name), 'utf8');
}

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

test('real publish workflows cannot be cancelled in progress', async () => {
  const stable = await workflow('release.yml');
  const canary = await workflow('canary-publish.yml');

  assert.match(stable, /cancel-in-progress:\s*false/);
  assert.match(canary, /cancel-in-progress:\s*false/);
});

test('stable release and preflight select the stable policy channel', async () => {
  const stable = await workflow('release.yml');
  const preflight = await workflow('release-preflight.yml');

  assert.match(stable, /channel:\s*stable/);
  assert.match(preflight, /channel:\s*stable/);
});

test('reusable pipeline computes policy and publishes with an explicit tag', async () => {
  const pipeline = await workflow('release-pipeline.yml');
  const release = await workflow('release.yml');
  const preflight = await workflow('release-preflight.yml');

  assert.match(
    pipeline,
    /      channel:\n        description: Release channel\n        required: true\n        type: string/,
  );
  assert.match(pipeline, /node scripts\/release\/plan-cli\.mjs/);
  assert.match(pipeline, /--channel\s+"?\$\{\{ inputs\.channel \}\}"?/);
  assert.match(pipeline, /--tag\s+"\$DIST_TAG"/);
  assert.doesNotMatch(
    pipeline,
    /pnpm -r publish --(?:dry-run )?--no-git-checks --access public\s*$/m,
  );
  assert.match(release, /permissions:\n  actions: read\n  contents: write/);
  assert.match(preflight, /permissions:\n  actions: read\n  contents: read/);
  assert.doesNotMatch(pipeline, /    permissions:/);
});

test('artifact wall is preflight-only, runs after build, and includes offline verification', async () => {
  const pipeline = await workflow('release-pipeline.yml');
  const buildIndex = pipeline.indexOf('      - name: Build');
  const artifactIndex = pipeline.indexOf('      - name: Run Artifact Wall');

  assert.ok(buildIndex >= 0, 'build step is missing');
  assert.ok(artifactIndex > buildIndex, 'artifact wall must run after build');
  assert.match(
    pipeline,
    /      - name: Run Artifact Wall\n        if: \$\{\{ !inputs\.publish \}\}/,
  );
  assert.match(pipeline, /--mode preflight/);
  assert.doesNotMatch(pipeline, /Publish dry run \(preflight\)/);
});

test('publish phases enforce durable receipts before mutations and finish with smoke', async () => {
  const pipeline = await workflow('release-pipeline.yml');
  const bundleUpload = pipeline.indexOf('      - name: Upload new bundle');
  const bundleConfirm = pipeline.indexOf('      - name: Confirm durable bundle');
  const reconcile = pipeline.indexOf('      - name: Reconcile versions and staging tags');
  const snapshotUpload = pipeline.indexOf('      - name: Upload Promotion Snapshot');
  const snapshotConfirm = pipeline.indexOf('      - name: Confirm durable promotion snapshot');
  const promote = pipeline.indexOf('      - name: Promote public tags');
  const smoke = pipeline.indexOf('      - name: Run clean registry smoke tests');
  assert.ok(bundleUpload >= 0 && bundleUpload < bundleConfirm && bundleConfirm < reconcile);
  assert.ok(reconcile < snapshotUpload && snapshotUpload < snapshotConfirm && snapshotConfirm < promote);
  assert.ok(promote < smoke);
  assert.match(pipeline, /actions\/upload-artifact@v7/g);
  assert.equal((pipeline.match(/include-hidden-files: true/g) ?? []).length, 3);
  for (const command of ['pnpm test', 'pnpm test:kern', 'pnpm check:conformance', 'pnpm test:runner-smoke']) {
    const commandIndex = pipeline.indexOf(`run: ${command}`);
    assert.ok(commandIndex >= 0 && commandIndex < bundleUpload, `${command} must precede bundle preparation`);
  }
});

test('release workflow toolchain pins match policy and the root package manager', async () => {
  const policy = await json('scripts/release/release-policy.json');
  const rootPackage = await json('package.json');
  assert.equal(rootPackage.packageManager, policy.release.packageManager);

  for (const name of ['release-pipeline.yml', 'canary-publish.yml']) {
    const contents = await workflow(name);
    const nodeMajor = contents.match(/node-version:\s*['"]?([1-9]\d*)['"]?/)?.[1];
    const packageManager = contents.match(/corepack prepare ([^\s]+) --activate/)?.[1];
    assert.equal(nodeMajor, String(policy.release.nodeMajor), `${name} Node major drifted from policy`);
    assert.equal(packageManager, policy.release.packageManager, `${name} package manager drifted from policy`);
  }
});

test('failed-smoke containment is authorized only by successful promotion and failed smoke', async () => {
  const pipeline = await workflow('release-pipeline.yml');
  const promoteIndex = pipeline.indexOf('      - name: Promote public tags');
  const smokeIndex = pipeline.indexOf('      - name: Run clean registry smoke tests');
  const recoverIndex = pipeline.indexOf('      - name: Contain failed post-promotion smoke');
  const journalIndex = pipeline.indexOf('      - name: Upload Journal');

  assert.ok(promoteIndex >= 0 && promoteIndex < smokeIndex);
  assert.ok(smokeIndex < recoverIndex && recoverIndex < journalIndex);
  assert.match(
    pipeline,
    /      - name: Promote public tags\n        id: publish-promote\n/,
  );
  assert.match(
    pipeline,
    /      - name: Run clean registry smoke tests\n        id: publish-smoke\n/,
  );

  const containment = pipeline.slice(recoverIndex, journalIndex);
  assert.match(
    containment,
    /if: \$\{\{ failure\(\) && inputs\.publish && steps\.publish-promote\.outcome == 'success' && steps\.publish-smoke\.outcome == 'failure' \}\}/,
  );
  assert.match(containment, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
  assert.match(containment, /--mode publish-recover/);
  assert.match(containment, /--recovery-reason post-promotion-smoke-failed/);
  assert.doesNotMatch(containment, /continue-on-error|if:\s*always\(\)|exit 0/);
  assert.equal(
    (pipeline.match(/--recovery-reason post-promotion-smoke-failed/g) ?? []).length,
    1,
  );
});

test('dev synchronization is guarded by the release plan', async () => {
  const pipeline = await workflow('release-pipeline.yml');

  assert.match(
    pipeline,
    /if:\s*\$\{\{\s*success\(\)\s*&&\s*inputs\.publish\s*&&\s*steps\.release-plan\.outputs\.syncs_dev\s*==\s*'true'/,
  );
});

test('canary has no free-form dist-tag input and uses policy outputs', async () => {
  const canary = await workflow('canary-publish.yml');

  assert.doesNotMatch(canary, /npm_tag:/);
  assert.doesNotMatch(canary, /NPM_TAG_INPUT/);
  assert.match(canary, /node scripts\/release\/plan-cli\.mjs/);
  assert.match(canary, /tee \.release\/release-plan\.json/);
  assert.match(canary, /--channel\s+canary/);
  assert.match(canary, /--tag\s+"\$NPM_TAG"/);
  assert.match(canary, /CANARY_VERSION: \$\{\{ steps\.release-plan\.outputs\.version \}\}/);
  assert.match(canary, /NPM_TAG: \$\{\{ steps\.release-plan\.outputs\.dist_tag \}\}/);
  assert.match(canary, /uses: actions\/setup-python@v6/);
  assert.match(canary, /run: pip install mcp/);
  assert.equal((canary.match(/include-hidden-files: true/g) ?? []).length, 3);
  const bundleIndex = canary.indexOf('      - name: Recover bundle or pack new bundle');
  for (const command of ['pnpm test', 'pnpm test:kern', 'pnpm check:conformance', 'pnpm test:runner-smoke']) {
    const commandIndex = canary.indexOf(`run: ${command}`);
    assert.ok(commandIndex >= 0 && commandIndex < bundleIndex, `${command} must precede canary bundle preparation`);
  }
});

test('canary is explicitly manual-only until exact-SHA CI attestation lands', async () => {
  const canary = await workflow('canary-publish.yml');

  assert.doesNotMatch(canary, /workflow_run:/);
  assert.doesNotMatch(canary, /branches:\s*\[dev\]/);
  assert.match(canary, /github\.event_name\s*==\s*'workflow_dispatch'/);
  assert.match(canary, /github\.ref_name\s*==\s*'main'/);
  assert.doesNotMatch(canary, /github\.event\.workflow_run/);
});
