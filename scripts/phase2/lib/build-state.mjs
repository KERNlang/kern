/**
 * Phase-2 build-freshness guard + source/route identity hashes.
 *
 * Both gates read compiled `dist/` artifacts (the same ones `scripts/conformance.mjs`
 * imports). The golden-baseline spec demands: "a command that reads dist/ either
 * runs build itself or fails if source is newer." This module is the FAIL-IF-STALE
 * half — the gate scripts call `assertBuildFresh()` first and abort with
 * `EXT_STALE_BASELINE` / `INT_CAPTURE_ERROR` framing if any tracked TypeScript
 * source under the relevant packages is newer than the `dist/` tree.
 *
 * Scope: the gates import dist from `core`, `python`, and `express` only, so the
 * freshness check is scoped to those three packages. Widening the scope would
 * make the guard slower without protecting any artifact a gate actually reads.
 *
 * `sourceTreeSha256()` is the "what source produced this dist" identity: a
 * sha256 over the sorted (relative-path, byte-content) pairs of every `.ts`
 * source file in the relevant packages. It goes into both manifests so a
 * baseline captured against one source tree is detectably stale against another.
 *
 * `routeTableSha256()` hashes the canonical Phase-2 route table. For slice 0 NO
 * route is flipped: every expression route is served by `py_legacy`, fallback
 * policy is none, schema version 0. The gate refuses any route flip while the
 * baseline tag is VOLATILE (see ratchet.mjs), so this is the all-legacy table.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, stableHash } from './hash.mjs';

/** Packages whose `dist/` the Phase-2 gates import. */
const RELEVANT_PACKAGES = ['core', 'python', 'express'];

/**
 * The canonical slice-0 route table: every expression route is py_legacy, no
 * flips, no fallback. Hashing the full schema (route -> production/fallback/
 * schemaVersion) means a future flip changes the hash, which the volatile-tag
 * refusal in ratchet.mjs depends on.
 */
export const PHASE2_ROUTE_TABLE = Object.freeze({
  schemaVersion: 0,
  routes: Object.freeze({
    literal: 'py_legacy',
    member: 'py_legacy',
    call: 'py_legacy',
    truthy: 'py_legacy',
    logical: 'py_legacy',
    bitwise: 'py_legacy',
    nullish: 'py_legacy',
    'optional-chain': 'py_legacy',
    sentinel: 'py_legacy',
  }),
  fallbackPolicy: 'none',
});

/**
 * @param {string} repoRoot
 * @param {string} dir
 * @param {string[]} acc
 * @returns {string[]} absolute paths of every .ts source file (sorted later)
 */
function collectTsSources(repoRoot, dir, acc) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectTsSources(repoRoot, full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Newest mtime (ms) of any file under a dist tree, or 0 if absent.
 * @param {string} dir
 * @returns {number}
 */
function newestMtime(dir) {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else newest = Math.max(newest, st.mtimeMs);
  }
  return newest;
}

/**
 * sha256 over sorted (relativePath, sha256(bytes)) of all .ts sources in the
 * relevant packages. Stable identity of the source tree that produced dist.
 * @param {string} repoRoot
 * @returns {string}
 */
export function sourceTreeSha256(repoRoot) {
  const entries = [];
  for (const pkg of RELEVANT_PACKAGES) {
    const srcDir = join(repoRoot, 'packages', pkg, 'src');
    for (const file of collectTsSources(repoRoot, srcDir, [])) {
      const rel = file.slice(repoRoot.length + 1);
      entries.push([rel, sha256(readFileSync(file))]);
    }
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256(entries.map(([rel, h]) => `${rel}:${h}`).join('\n'));
}

/**
 * sha256 of the canonical (slice-0) route table.
 * @returns {string}
 */
export function routeTableSha256() {
  return stableHash(PHASE2_ROUTE_TABLE);
}

/**
 * Fail (throw) if any relevant TypeScript source is newer than the freshest
 * dist artifact in its package — i.e. dist is stale and the gate would read
 * outdated bytes. Returns the inputs it checked on success.
 * @param {string} repoRoot
 * @returns {{ checked: string[], newestSrcMs: number, oldestDistMs: number }}
 */
export function assertBuildFresh(repoRoot) {
  const checked = [];
  let worstSrcMs = 0;
  let worstDistMs = Infinity;
  for (const pkg of RELEVANT_PACKAGES) {
    const srcDir = join(repoRoot, 'packages', pkg, 'src');
    const distDir = join(repoRoot, 'packages', pkg, 'dist');
    checked.push(pkg);
    if (!existsSync(distDir)) {
      throw new Error(
        `BUILD_STALE: packages/${pkg}/dist is missing — run \`pnpm exec tsc -b\` before the gate`,
      );
    }
    const distNewest = newestMtime(distDir);
    worstDistMs = Math.min(worstDistMs, distNewest);
    let srcNewest = 0;
    for (const file of collectTsSources(repoRoot, srcDir, [])) {
      srcNewest = Math.max(srcNewest, statSync(file).mtimeMs);
    }
    worstSrcMs = Math.max(worstSrcMs, srcNewest);
    // Small slack: build tools can stamp dist a hair before the last src stat.
    if (srcNewest > distNewest + 1) {
      throw new Error(
        `BUILD_STALE: packages/${pkg}/src is newer than packages/${pkg}/dist ` +
          `(src ${new Date(srcNewest).toISOString()} > dist ${new Date(distNewest).toISOString()}). ` +
          'Run `pnpm exec tsc -b` before the gate.',
      );
    }
  }
  return { checked, newestSrcMs: worstSrcMs, oldestDistMs: worstDistMs };
}
