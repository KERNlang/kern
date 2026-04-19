/**
 * Auto-diff base detection — Phase 5.
 *
 * Bare `kern review` inside a git repo picks the first ref that exists out
 * of `origin/main`, `origin/master`, `HEAD~1`. These tests pin the priority
 * order and the graceful fall-through to `undefined` for non-git or
 * single-commit trees.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectAutoDiffBase } from '../src/commands/review.js';

function initRepo(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'kern@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'KERN Test'], { cwd: dir });
  // Silence hints about default branch name — harmless in test output but noisy.
  execFileSync('git', ['config', 'advice.defaultBranchName', 'false'], { cwd: dir });
}

function commit(dir: string, message: string, filename = 'README.md'): void {
  writeFileSync(join(dir, filename), `${message}\n`);
  execFileSync('git', ['add', filename], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
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
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: tmp });
    expect(detectAutoDiffBase(tmp)).toBe('origin/main');
  });

  it('falls through to origin/master when origin/main is absent', () => {
    tmp = mkdtempSync(join(tmpdir(), 'kern-originmaster-'));
    initRepo(tmp);
    commit(tmp, 'first');
    commit(tmp, 'second');
    execFileSync('git', ['update-ref', 'refs/remotes/origin/master', 'HEAD'], { cwd: tmp });
    expect(detectAutoDiffBase(tmp)).toBe('origin/master');
  });

  it('returns origin/main even when both origin/main and origin/master exist', () => {
    tmp = mkdtempSync(join(tmpdir(), 'kern-bothorigins-'));
    initRepo(tmp);
    commit(tmp, 'first');
    commit(tmp, 'second');
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: tmp });
    execFileSync('git', ['update-ref', 'refs/remotes/origin/master', 'HEAD'], { cwd: tmp });
    expect(detectAutoDiffBase(tmp)).toBe('origin/main');
  });
});
