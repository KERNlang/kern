import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function workflow(name) {
  return readFile(path.join(repoRoot, '.github/workflows', name), 'utf8');
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
  assert.match(
    pipeline,
    /      - name: Verify published packages on npm\n        if: \$\{\{ inputs\.publish \}\}\n        env:\n          RELEASE_VERSION: \$\{\{ steps\.release-plan\.outputs\.version \}\}/,
  );
});

test('artifact wall is preflight-only and runs after build before its dry run', async () => {
  const pipeline = await workflow('release-pipeline.yml');
  const buildIndex = pipeline.indexOf('      - name: Build');
  const artifactIndex = pipeline.indexOf('      - name: Run Artifact Wall');
  const preflightDryRunIndex = pipeline.indexOf(
    '      - name: Publish dry run (preflight)\n        if: ${{ !inputs.publish }}',
  );

  assert.ok(buildIndex >= 0, 'build step is missing');
  assert.ok(artifactIndex > buildIndex, 'artifact wall must run after build');
  assert.ok(
    preflightDryRunIndex > artifactIndex,
    'preflight dry run must consume a successful artifact wall first',
  );
  assert.match(
    pipeline,
    /      - name: Run Artifact Wall\n        if: \$\{\{ !inputs\.publish \}\}/,
  );
});

test('dev synchronization is guarded by the release plan', async () => {
  const pipeline = await workflow('release-pipeline.yml');

  assert.match(
    pipeline,
    /if:\s*\$\{\{[^\n]*inputs\.publish[^\n]*steps\.release-plan\.outputs\.syncs_dev\s*==\s*'true'/,
  );
});

test('canary has no free-form dist-tag input and uses policy outputs', async () => {
  const canary = await workflow('canary-publish.yml');

  assert.doesNotMatch(canary, /npm_tag:/);
  assert.doesNotMatch(canary, /NPM_TAG_INPUT/);
  assert.match(canary, /node scripts\/release\/plan-cli\.mjs/);
  assert.match(canary, /--channel\s+canary/);
  assert.match(canary, /--tag\s+"\$NPM_TAG"/);
});

test('canary is explicitly manual-only until exact-SHA CI attestation lands', async () => {
  const canary = await workflow('canary-publish.yml');

  assert.doesNotMatch(canary, /workflow_run:/);
  assert.doesNotMatch(canary, /branches:\s*\[dev\]/);
  assert.match(canary, /github\.event_name\s*==\s*'workflow_dispatch'/);
  assert.match(canary, /github\.ref_name\s*==\s*'main'/);
  assert.doesNotMatch(canary, /github\.event\.workflow_run/);
});
