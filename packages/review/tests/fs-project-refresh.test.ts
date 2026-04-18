/**
 * Tests for refreshFsProjectFromDisk — the watch-mode correctness helper that keeps the
 * shared ts-morph Project in sync with files changed on disk outside our own
 * replaceWithText path.
 *
 * Scenario the helper exists to solve: in a long-running process (watch mode, IDE
 * extension), reviewFile loads imported files into the Project. If those imports change on
 * disk later (another editor, git pull), the cached ASTs go stale and cross-file findings
 * reflect the OLD source. refreshFsProjectFromDisk fixes this without the cost of
 * rebuilding the whole Project.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { refreshFsProjectFromDisk, resetFsProject, reviewFile } from '../src/index.js';

describe('refreshFsProjectFromDisk', () => {
  let workDir: string;

  beforeEach(() => {
    // Each test gets a fresh Project so mtime tracking doesn't leak across tests.
    resetFsProject();
    workDir = mkdtempSync(join(tmpdir(), 'kernlang-fsrefresh-'));
  });

  afterEach(() => {
    resetFsProject();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('returns 0 when no Project exists yet', () => {
    // Safe to call before any reviewFile has run — nothing to refresh.
    expect(refreshFsProjectFromDisk()).toBe(0);
  });

  it('returns 0 when all loaded files match their on-disk mtimes', () => {
    const filePath = join(workDir, 'a.ts');
    writeFileSync(filePath, 'export const x = 1;\n');
    reviewFile(filePath);
    // No file has changed since the review loaded it, so nothing should refresh.
    expect(refreshFsProjectFromDisk()).toBe(0);
  });

  it('refreshes a loaded source file whose mtime moved on disk', () => {
    const filePath = join(workDir, 'a.ts');
    writeFileSync(filePath, 'export const x = 1;\n');
    reviewFile(filePath);

    // Rewrite the file AND bump its mtime deterministically. On some filesystems two writes
    // within the same millisecond share an mtime, which would mask a real refresh — bump the
    // mtime by a full second to keep the test reliable across macOS/Linux/ext4/APFS.
    writeFileSync(filePath, 'export const x = 2;\n');
    const future = new Date(Date.now() + 1000);
    utimesSync(filePath, future, future);

    expect(refreshFsProjectFromDisk()).toBe(1);
    // Calling again should find nothing — we just recorded the new mtime.
    expect(refreshFsProjectFromDisk()).toBe(0);
  });

  it('skips source files that were deleted from disk without crashing', () => {
    const filePath = join(workDir, 'a.ts');
    writeFileSync(filePath, 'export const x = 1;\n');
    reviewFile(filePath);

    rmSync(filePath);
    // Deleted files must not crash the refresh — ts-morph will raise on next access if the
    // caller tries to use them, but the refresh itself must be resilient.
    expect(() => refreshFsProjectFromDisk()).not.toThrow();
    expect(refreshFsProjectFromDisk()).toBe(0);
  });

  it('tracks mtimes for files added via the initial review path', () => {
    // This covers the round-trip: initial review records the mtime, subsequent mtime change
    // causes a refresh, subsequent refresh without change returns 0.
    const dir = join(workDir, 'sub');
    mkdirSync(dir);
    const filePath = join(dir, 'b.ts');
    writeFileSync(filePath, 'export function f() { return 1; }\n');
    reviewFile(filePath);

    writeFileSync(filePath, 'export function f() { return 2; }\n');
    const future = new Date(Date.now() + 2000);
    utimesSync(filePath, future, future);

    const refreshed = refreshFsProjectFromDisk();
    expect(refreshed).toBeGreaterThanOrEqual(1);
  });
});
