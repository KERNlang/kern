/**
 * Canonical path utilities — single source of truth for path canonicalization
 * across the review pipeline.
 *
 * All seed maps, blockers, and lookup keys must run through `canonicalize()`
 * so symlink-induced path divergence (pnpm `node_modules/.pnpm/...`, macOS
 * `/var → /private/var`, workspace-internal `node_modules` links) resolves to
 * the same key on every side. Without this, a re-export crossing a pnpm
 * symlink fails the seed lookup even though both endpoints point at the same
 * file on disk — see red-team finding #9.
 *
 * Keep user-facing diagnostics (finding `filePath`, span `file`) in the
 * ORIGINAL form the caller passed in. Canonical paths are an internal index
 * key, not a display value.
 */

import { realpathSync } from 'fs';
import { dirname, resolve, sep } from 'path';

/**
 * Resolve to an absolute path with symlinks fully resolved. When the path
 * does not exist on disk yet, walks up to the deepest existing ancestor,
 * realpaths that, and reattaches the missing tail — so callers always get a
 * usable string back. Idempotent: `canonicalize(canonicalize(p)) === canonicalize(p)`.
 */
export function canonicalize(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    // Walk up. `parts` collects the missing tail, deepest-first. When the
    // first existing ancestor is found, reattach the tail in outer-to-inner
    // order: basenameOf(cur) is the missing segment immediately under that
    // ancestor, and parts.reverse() is everything below it. Order matters
    // when more than one segment is missing — see the multi-level test case.
    const parts: string[] = [];
    let cur = abs;
    while (true) {
      const parent = dirname(cur);
      if (parent === cur) return abs;
      try {
        const real = realpathSync(parent);
        return resolve(real, basenameOf(cur), ...parts.reverse());
      } catch {
        parts.push(basenameOf(cur));
        cur = parent;
      }
    }
  }
}

/**
 * Like `canonicalize` but returns `undefined` when the path does not exist.
 * Use for seed lookups where a missing file should drop the seed entirely
 * rather than be stored as a non-existent path.
 */
export function tryCanonicalize(p: string): string | undefined {
  try {
    return realpathSync(resolve(p));
  } catch {
    return undefined;
  }
}

/**
 * Create a memoized canonicalizer scoped to a single analysis run. In large
 * pnpm monorepos the same path may be canonicalized thousands of times; the
 * cache avoids redundant `realpathSync` syscalls inside hot loops.
 */
export function createPathCanonicalizer(): (p: string) => string {
  const cache = new Map<string, string>();
  return (p: string): string => {
    const cached = cache.get(p);
    if (cached !== undefined) return cached;
    const canonical = canonicalize(p);
    cache.set(p, canonical);
    return canonical;
  };
}

function basenameOf(p: string): string {
  const idx = p.lastIndexOf(sep);
  return idx === -1 ? p : p.slice(idx + 1);
}
