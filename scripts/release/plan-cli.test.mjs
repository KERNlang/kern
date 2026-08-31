import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const releaseDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(releaseDir, 'plan-cli.mjs');
const sha = '0123456789abcdef0123456789abcdef01234567';

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('CLI prints one valid stable ReleasePlan', () => {
  const result = runCli([
    '--channel',
    'stable',
    '--version',
    '4.5.0',
    '--sha',
    sha,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.version, '4.5.0');
  assert.equal(plan.distTag, 'latest');
  assert.equal(plan.packages.length, 22);
});

test('CLI writes policy-derived GitHub outputs and environment values', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'kern-release-cli-'));
  const githubOutput = path.join(outputDir, 'output');
  const githubEnv = path.join(outputDir, 'env');
  try {
    const result = runCli(
      ['--channel', 'canary', '--run-number', '9', '--sha', sha],
      { GITHUB_OUTPUT: githubOutput, GITHUB_ENV: githubEnv },
    );
    assert.equal(result.status, 0, result.stderr);
    const output = await readFile(githubOutput, 'utf8');
    const environment = await readFile(githubEnv, 'utf8');

    assert.match(output, /^version=5\.0\.0-canary\.9\.g01234567$/m);
    assert.match(output, /^dist_tag=canary$/m);
    assert.match(environment, /^CANARY_VERSION=5\.0\.0-canary\.9\.g01234567$/m);
    assert.match(environment, /^NPM_TAG=canary$/m);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

for (const args of [
  ['--channel', 'stable', '--version', '4.5.0', '--sha', sha, '--dist-tag', 'latest'],
  ['--channel', 'stable', '--channel', 'stable', '--version', '4.5.0', '--sha', sha],
  ['--channel', 'stable', '--version', '4.5.0', '--sha', sha, '--unknown', 'value'],
]) {
  test(`CLI rejects unknown or duplicate options: ${args.join(' ')}`, () => {
    const result = runCli(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown option|duplicate option/i);
  });
}
