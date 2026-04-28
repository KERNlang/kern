/**
 * Auto-diff base detection — Phase 5.
 *
 * Bare `kern review` inside a git repo picks the first ref that exists out
 * of `origin/main`, `origin/master`, `HEAD~1`. These tests pin the priority
 * order and the graceful fall-through to `undefined` for non-git or
 * single-commit trees.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectAutoDiffBase } from '../src/commands/review.js';
import { git } from './git-test-env.js';

function initRepo(dir: string): void {
  git(['init', '-q'], dir);
  git(['config', 'user.email', 'kern@example.com'], dir);
  git(['config', 'user.name', 'KERN Test'], dir);
  // Silence hints about default branch name — harmless in test output but noisy.
  git(['config', 'advice.defaultBranchName', 'false'], dir);
}

function commit(dir: string, message: string, filename = 'README.md'): void {
  writeFileSync(join(dir, filename), `${message}\n`);
  git(['add', filename], dir);
  git(['commit', '-q', '-m', message], dir);
}

describe('detectAutoDiffBase', () => {
  let tmp: string;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('returns undefined outside a git repo', () => {
    tmp = mkdtempSync(join(tmpdir(), 'kern-nogit-'));
    expect(detectAutoDiffBase(tmp)).toBeUndefined();
  });

  it('returns undefined on a single-commit repo with no remote (no HEAD~1, no origin)', () => {
    tmp = mkdtempSync(join(tmpdir(), 'kern-singlecommit-'));
    initRepo(tmp);
    commit(tmp, 'initial');
    expect(detectAutoDiffBase(tmp)).toBeUndefined();
  });

  it('picks HEAD~1 when there is history but no origin/main and no origin/master', () => {
    tmp = mkdtempSync(join(tmpdir(), 'kern-twocommits-'));
    initRepo(tmp);
    commit(tmp, 'first');
    commit(tmp, 'second');
    expect(detectAutoDiffBase(tmp)).toBe('HEAD~1');
  });

  it('prefers origin/main when it exists (highest priority)', () => {
    tmp = mkdtempSync(join(tmpdir(), 'kern-originmain-'));
    initRepo(tmp);
    commit(tmp, 'first');
    commit(tmp, 'second');
    // Fake an origin/main ref without actually needing a remote.
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], tmp);
    expect(detectAutoDiffBase(tmp)).toBe('origin/main');
  });

  it('falls through to origin/master when origin/main is absent', () => {
    tmp = mkdtempSync(join(tmpdir(), 'kern-originmaster-'));
    initRepo(tmp);
    commit(tmp, 'first');
    commit(tmp, 'second');
    git(['update-ref', 'refs/remotes/origin/master', 'HEAD'], tmp);
    expect(detectAutoDiffBase(tmp)).toBe('origin/master');
  });

  it('returns origin/main even when both origin/main and origin/master exist', () => {
    tmp = mkdtempSync(join(tmpdir(), 'kern-bothorigins-'));
    initRepo(tmp);
    commit(tmp, 'first');
    commit(tmp, 'second');
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], tmp);
    git(['update-ref', 'refs/remotes/origin/master', 'HEAD'], tmp);
    expect(detectAutoDiffBase(tmp)).toBe('origin/main');
  });
});
