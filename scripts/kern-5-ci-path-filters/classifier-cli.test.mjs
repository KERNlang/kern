import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const CLASSIFIER = resolve(ROOT, 'scripts/ci/classify-ci-changes.mjs');

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function scratchRepoWithNoFetchedBaseRef() {
  const repo = mkdtempSync(join(tmpdir(), 'kern-ci-classify-'));
  git(repo, 'init', '--quiet', '--initial-branch=main');
  git(repo, 'config', 'user.email', 'ci@example.invalid');
  git(repo, 'config', 'user.name', 'CI');
  writeFileSync(join(repo, 'file.txt'), 'content\n');
  git(repo, 'add', 'file.txt');
  git(repo, 'commit', '--quiet', '-m', 'initial');
  return repo;
}

test('a merge-base failure while computing the diff fails closed to FULL and exits zero', () => {
  const repo = scratchRepoWithNoFetchedBaseRef();
  const outputPath = join(repo, 'github-output.txt');
  writeFileSync(outputPath, '');
  try {
    execFileSync(process.execPath, [CLASSIFIER], {
      cwd: repo,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_BASE_REF: 'main',
        GITHUB_OUTPUT: outputPath,
      },
    });
    assert.equal(readFileSync(outputPath, 'utf8'), 'ci_class=FULL\n');
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});
