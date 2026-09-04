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
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function freshRepo(dirPrefix) {
  const repo = mkdtempSync(join(tmpdir(), dirPrefix));
  git(repo, 'init', '--quiet', '--initial-branch=main');
  git(repo, 'config', 'user.email', 'ci@example.invalid');
  git(repo, 'config', 'user.name', 'CI');
  return repo;
}

function commitAll(repo, message) {
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', message);
}

function baseAndHeadRepo() {
  const upstream = freshRepo('kern-ci-upstream-');
  writeFileSync(join(upstream, 'README.md'), 'base readme\n');
  writeFileSync(join(upstream, 'notes.md'), 'base notes\n');
  writeFileSync(join(upstream, 'reader.ts'), "const path = 'notes.md';\n");
  writeFileSync(join(upstream, 'src.ts'), 'export const x = 1;\n');
  commitAll(upstream, 'base');
  const baseSha = git(upstream, 'rev-parse', 'HEAD');

  const repo = freshRepo('kern-ci-repo-');
  git(repo, 'remote', 'add', 'origin', upstream);
  git(repo, 'fetch', '--quiet', 'origin', 'main');
  git(repo, 'checkout', '--quiet', baseSha);
  return { upstream, repo, baseSha };
}

function runClassifier(repo, env) {
  const outputPath = join(repo, 'github-output.txt');
  writeFileSync(outputPath, '');
  execFileSync(process.execPath, [CLASSIFIER], {
    cwd: repo,
    env: { ...process.env, GITHUB_OUTPUT: outputPath, ...env },
  });
  return readFileSync(outputPath, 'utf8');
}

function withRepos(fn) {
  const { upstream, repo, baseSha } = baseAndHeadRepo();
  try {
    fn({ upstream, repo, baseSha });
  } finally {
    rmSync(upstream, { force: true, recursive: true });
    rmSync(repo, { force: true, recursive: true });
  }
}

test('an eligible docs-only change classifies as DOCS_ONLY and exits zero', () => {
  withRepos(({ repo, baseSha }) => {
    writeFileSync(join(repo, 'README.md'), 'base readme\nan unrelated addition\n');
    commitAll(repo, 'docs only');
    const output = runClassifier(repo, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_SHA: baseSha });
    assert.equal(output, 'ci_class=DOCS_ONLY\n');
  });
});

test('a mixed docs and source change classifies as FULL and exits zero', () => {
  withRepos(({ repo, baseSha }) => {
    writeFileSync(join(repo, 'README.md'), 'base readme\nan unrelated addition\n');
    writeFileSync(join(repo, 'src.ts'), 'export const x = 2;\n');
    commitAll(repo, 'mixed change');
    const output = runClassifier(repo, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_SHA: baseSha });
    assert.equal(output, 'ci_class=FULL\n');
  });
});

test('an empty diff classifies as FULL and exits zero', () => {
  withRepos(({ repo, baseSha }) => {
    const output = runClassifier(repo, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_SHA: baseSha });
    assert.equal(output, 'ci_class=FULL\n');
  });
});

test('a push event classifies as FULL without touching the base sha and exits zero', () => {
  withRepos(({ repo }) => {
    writeFileSync(join(repo, 'README.md'), 'base readme\nan unrelated addition\n');
    commitAll(repo, 'docs only');
    const output = runClassifier(repo, { GITHUB_EVENT_NAME: 'push' });
    assert.equal(output, 'ci_class=FULL\n');
  });
});

test('an unreachable base sha fails closed to FULL and exits zero', () => {
  const repo = freshRepo('kern-ci-classify-');
  writeFileSync(join(repo, 'file.txt'), 'content\n');
  commitAll(repo, 'initial');
  try {
    const output = runClassifier(repo, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_BASE_SHA: '0000000000000000000000000000000000000000',
    });
    assert.equal(output, 'ci_class=FULL\n');
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test('an eligible markdown path referenced by a tracked non-markdown file flips the class to FULL', () => {
  withRepos(({ repo, baseSha }) => {
    writeFileSync(join(repo, 'notes.md'), 'base notes\nan unrelated addition\n');
    commitAll(repo, 'referenced docs change');
    const output = runClassifier(repo, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_SHA: baseSha });
    assert.equal(output, 'ci_class=FULL\n');
  });
});
