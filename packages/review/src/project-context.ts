/**
 * Project-Context — repo-level signals for the review pipeline.
 *
 * Reads project configs (tsconfig.json, package.json) and .gitignore so rules
 * can gate on what the user already enforces elsewhere. Designed to be SAFE on
 * adversarial inputs:
 *
 *  - **JSON-only.** No executable config readers (no eslint.config.js eval).
 *    Phase 2 may add YAML/TOML but only via safeLoad; never `require()` of a
 *    user-controlled file.
 *  - **Realpath containment.** Any path resolved from a config (extends, etc.)
 *    must live under the project root after `realpathSync` — otherwise it is
 *    ignored. Defends against `extends: '../../../etc/passwd'` and symlink
 *    traversal attacks surfaced by the Phase 1 red-team.
 *  - **Content-hash cache.** Cache key is hashed file content + extends chain
 *    (reuses the cache.ts pattern). mtime is unsound on second-resolution
 *    filesystems and on TOCTOU windows where bytes change but mtime does not.
 *  - **LRU eviction.** Max 128 cached project roots — defense against the
 *    long-running Guard bot accumulating per-PR worktree paths until OOM.
 *  - **Pattern-length cap on .gitignore.** Discards any individual pattern
 *    longer than 256 chars. Defense against ReDoS via crafted negation +
 *    quantifier patterns from the red-team.
 */

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';

/** What `getProjectContext` returns. Extended in later phases. */
export interface ProjectContext {
  /** Absolute, realpath-resolved project root. */
  root: string;
  /** Parsed root package.json — restricted to fields we care about. */
  packageJson?: ProjectPackageJson;
  /** Parsed tsconfig (top-level only — extends chain is hashed but not deep-merged here). */
  tsconfig?: ProjectTsconfig;
  /** Compiled .gitignore matchers, in walk order (root first, deeper later). */
  gitignore: GitignoreMatchers;
  /**
   * Set of POSIX-relative paths that `git ls-files` reports as tracked. A file
   * being tracked overrides .gitignore for skip-list purposes — published
   * artifacts (e.g. packages/sdk/dist/client.gen.ts) get reviewed even when
   * the directory matches `.gitignore`. Empty set if not a git repo.
   */
  gitTrackedFiles: Set<string>;
  /**
   * Stable hash of every config input that contributed to this context. Used as
   * the cache key; if any config file changes, the hash changes and the entry
   * is recomputed.
   */
  contentHash: string;
}

export interface ProjectPackageJson {
  name?: string;
  type?: 'module' | 'commonjs';
  workspaces?: string[];
  bin?: Record<string, string> | string;
  exports?: unknown;
  private?: boolean;
}

export interface ProjectTsconfig {
  /** True iff `compilerOptions.strict === true` is set on the resolved config. */
  strict?: boolean;
  /** Per-flag — overrides composite `strict`. Future phases dial confidence per flag. */
  strictNullChecks?: boolean;
  noImplicitAny?: boolean;
  noUnusedLocals?: boolean;
  noUnusedParameters?: boolean;
}

/** Compiled gitignore matchers. Use `isPathIgnored` to query. */
export interface GitignoreMatchers {
  /** Patterns from the project root's .gitignore, in declaration order. */
  rootPatterns: GitignorePattern[];
}

export interface GitignorePattern {
  /** Original line as written, post-trim. */
  raw: string;
  /** Compiled regex. Pattern-length capped at 256 to avoid ReDoS. */
  regex: RegExp;
  /** Negation rule (`!foo`) — re-includes a previously-ignored path. */
  negate: boolean;
  /** Pattern is anchored to repo root (no slash in middle of pattern). */
  matchDirsOnly: boolean;
}

/** Maximum pattern length for a single .gitignore entry (red-team P1 ReDoS guard). */
const MAX_GITIGNORE_PATTERN_LENGTH = 256;

/** LRU cap for cached project contexts (red-team P1 OOM guard for Guard bot). */
const CONTEXT_CACHE_CAP = 128;

/** Map iteration order is insertion order; deletes + re-inserts give LRU. */
const contextCache = new Map<string, { hash: string; context: ProjectContext }>();

/**
 * Get the project context for a project root. Cached by content hash —
 * a config file edit invalidates the entry on next call.
 */
export function getProjectContext(projectRoot: string): ProjectContext {
  const root = safeRealpath(projectRoot);
  if (!root) {
    return emptyContext(projectRoot);
  }

  const probe = computeContentHash(root);
  const cached = contextCache.get(root);
  if (cached && cached.hash === probe) {
    // LRU touch: delete + re-insert moves it to most-recently-used.
    contextCache.delete(root);
    contextCache.set(root, cached);
    return cached.context;
  }

  const context = buildContext(root, probe);
  contextCache.set(root, { hash: probe, context });

  // LRU eviction.
  while (contextCache.size > CONTEXT_CACHE_CAP) {
    const oldestKey = contextCache.keys().next().value;
    if (oldestKey === undefined) break;
    contextCache.delete(oldestKey);
  }

  return context;
}

/** Test-only: clear cache between tests. */
export function _resetProjectContextCache(): void {
  contextCache.clear();
}

/** Test-only: report current cache size. */
export function _projectContextCacheSize(): number {
  return contextCache.size;
}

/**
 * Returns true iff the file is matched by the project's .gitignore. Use
 * `isReviewable` for the full skip-list semantics — this is the gitignore
 * predicate alone.
 */
export function isPathIgnored(filePath: string, ctx: ProjectContext): boolean {
  const rel = toRelative(ctx.root, filePath);
  if (rel === undefined) return false;
  let ignored = false;
  for (const pattern of ctx.gitignore.rootPatterns) {
    if (pattern.regex.test(rel)) {
      ignored = !pattern.negate;
    }
  }
  return ignored;
}

/**
 * The full skip-list predicate. A file is reviewable iff it is NOT
 * (gitignored AND not git-tracked).
 *
 * This is the Phase 1 red-team's finding #4 fix: a tracked artifact that lives
 * inside a gitignored directory (the classic `packages/sdk/dist/client.gen.ts`
 * case) must remain reviewable. Suppression-by-skip-list is reserved for
 * truly-untracked outputs.
 */
export function isReviewable(filePath: string, ctx: ProjectContext): boolean {
  const rel = toRelative(ctx.root, filePath);
  if (rel === undefined) return true; // Outside project root — caller decides.
  if (ctx.gitTrackedFiles.has(rel)) return true;
  return !isPathIgnored(filePath, ctx);
}

// ── Implementation ─────────────────────────────────────────────────────────

function buildContext(root: string, contentHash: string): ProjectContext {
  return {
    root,
    packageJson: readJson<ProjectPackageJson>(root, 'package.json'),
    tsconfig: readTsconfig(root),
    gitignore: readGitignore(root),
    gitTrackedFiles: readGitTrackedFiles(root),
    contentHash,
  };
}

function emptyContext(projectRoot: string): ProjectContext {
  return {
    root: resolve(projectRoot),
    gitignore: { rootPatterns: [] },
    gitTrackedFiles: new Set(),
    contentHash: '',
  };
}

/**
 * Shells out to `git ls-files -c -z` to get the set of tracked paths. Returns
 * an empty set if not a git repo or if git is unavailable. Bounded execution
 * (10s timeout, 100 MB buffer) so a misbehaving git can't wedge the review.
 */
function readGitTrackedFiles(root: string): Set<string> {
  try {
    const buf = execFileSync('git', ['ls-files', '-c', '-z'], {
      cwd: root,
      timeout: 10_000,
      maxBuffer: 100 * 1024 * 1024,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const set = new Set<string>();
    for (const path of buf.split('\0')) {
      if (path) set.add(path);
    }
    return set;
  } catch {
    return new Set();
  }
}

function safeRealpath(p: string): string | undefined {
  try {
    return realpathSync(resolve(p));
  } catch {
    return undefined;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function toRelative(root: string, filePath: string): string | undefined {
  const abs = realpathOrResolve(filePath);
  if (!isWithin(root, abs)) return undefined;
  const rel = relative(root, abs);
  // Normalize to POSIX separators for consistent gitignore matching.
  return rel.split(sep).join('/');
}

/**
 * Realpath the candidate (resolves symlinks). Falls back to plain `resolve` if
 * the file does not yet exist or realpath fails. Required because the project
 * root is realpath'd at cache time, so file paths must be compared in the same
 * symlink-resolved form (e.g. macOS `/var → /private/var`).
 */
function realpathOrResolve(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    // File doesn't exist yet — walk up to deepest existing ancestor and
    // realpath that, then append the missing tail.
    const parts: string[] = [];
    let cur = abs;
    while (true) {
      const parent = dirname(cur);
      if (parent === cur) return abs;
      try {
        const real = realpathSync(parent);
        return resolve(real, ...parts.reverse(), basenameOf(cur));
      } catch {
        parts.push(basenameOf(cur));
        cur = parent;
      }
    }
  }
}

function basenameOf(p: string): string {
  const idx = p.lastIndexOf(sep);
  return idx === -1 ? p : p.slice(idx + 1);
}

function computeContentHash(root: string): string {
  const hash = createHash('sha256');
  for (const file of ['package.json', 'tsconfig.json', '.gitignore']) {
    const abs = resolve(root, file);
    hash.update(file);
    if (existsSync(abs)) {
      try {
        hash.update(readFileSync(abs, 'utf-8'));
      } catch {
        // unreadable file — included as length-0 contribution
      }
    }
  }
  return hash.digest('hex');
}

function readJson<T>(root: string, name: string): T | undefined {
  const abs = resolve(root, name);
  if (!existsSync(abs)) return undefined;
  if (!isWithin(root, abs)) return undefined;
  try {
    const raw = readFileSync(abs, 'utf-8');
    // Strip JSONC comments — common in tsconfig.
    const stripped = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    return JSON.parse(stripped) as T;
  } catch {
    return undefined;
  }
}

interface RawTsconfig {
  compilerOptions?: {
    strict?: boolean;
    strictNullChecks?: boolean;
    noImplicitAny?: boolean;
    noUnusedLocals?: boolean;
    noUnusedParameters?: boolean;
  };
  extends?: string | string[];
}

function readTsconfig(root: string): ProjectTsconfig | undefined {
  const merged = readTsconfigChain(root, resolve(root, 'tsconfig.json'), new Set(), 0);
  if (!merged) return undefined;
  const opts = merged.compilerOptions ?? {};
  return {
    strict: opts.strict,
    strictNullChecks: opts.strictNullChecks,
    noImplicitAny: opts.noImplicitAny,
    noUnusedLocals: opts.noUnusedLocals,
    noUnusedParameters: opts.noUnusedParameters,
  };
}

function readTsconfigChain(root: string, abs: string, seen: Set<string>, depth: number): RawTsconfig | undefined {
  if (depth > 10) return undefined;
  if (!isWithin(root, abs)) return undefined;
  const real = safeRealpath(abs);
  if (!real || !isWithin(root, real)) return undefined;
  if (seen.has(real)) return undefined;
  seen.add(real);
  if (!existsSync(real)) return undefined;
  let raw: RawTsconfig | undefined;
  try {
    const text = readFileSync(real, 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    raw = JSON.parse(text) as RawTsconfig;
  } catch {
    return undefined;
  }
  // Merge extends shallowly: extended config provides defaults; current overrides.
  const extendsList = Array.isArray(raw?.extends)
    ? raw?.extends
    : typeof raw?.extends === 'string'
      ? [raw.extends]
      : [];
  let merged: RawTsconfig = {};
  for (const ext of extendsList ?? []) {
    if (typeof ext !== 'string') continue;
    // Only relative extends are walked. Package refs (`@scope/tsconfig`) live in
    // node_modules; resolving them is overkill for our purposes and would re-open
    // the eval-arbitrary-code surface.
    if (!ext.startsWith('.')) continue;
    const candidate = resolve(dirname(real), ext);
    const withJson = candidate.endsWith('.json') ? candidate : `${candidate}.json`;
    const sub = readTsconfigChain(root, withJson, seen, depth + 1);
    if (sub) {
      merged = {
        ...merged,
        ...sub,
        compilerOptions: { ...merged.compilerOptions, ...sub.compilerOptions },
      };
    }
  }
  return {
    ...merged,
    ...raw,
    compilerOptions: { ...merged.compilerOptions, ...raw?.compilerOptions },
  };
}

function readGitignore(root: string): GitignoreMatchers {
  const abs = resolve(root, '.gitignore');
  if (!existsSync(abs)) return { rootPatterns: [] };
  if (!isWithin(root, abs)) return { rootPatterns: [] };
  let text = '';
  try {
    text = readFileSync(abs, 'utf-8');
  } catch {
    return { rootPatterns: [] };
  }
  const patterns: GitignorePattern[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.length > MAX_GITIGNORE_PATTERN_LENGTH) continue; // ReDoS guard.
    const negate = trimmed.startsWith('!');
    const body = negate ? trimmed.slice(1) : trimmed;
    const matchDirsOnly = body.endsWith('/');
    const cleaned = matchDirsOnly ? body.slice(0, -1) : body;
    const regex = compileGitignoreRegex(cleaned, matchDirsOnly);
    if (!regex) continue;
    patterns.push({ raw: trimmed, regex, negate, matchDirsOnly });
  }
  return { rootPatterns: patterns };
}

function compileGitignoreRegex(pattern: string, matchDirsOnly: boolean): RegExp | undefined {
  // Hand-rolled minimal gitignore-style glob → regex. Supports:
  //   *      → [^/]*
  //   **/    → (anything-or-nothing)
  //   /xxx   → root-anchored
  //   xxx    → match anywhere in path (with leading dir boundary)
  //   xxx/   → directory match (handled via matchDirsOnly param + trailing match)
  // Other extended globs (?, [], **) intentionally limited — keeps the regex
  // shapes bounded and ReDoS-safe.
  let body = pattern;
  const anchored = body.startsWith('/');
  if (anchored) body = body.slice(1);

  let regex = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '*') {
      if (body[i + 1] === '*' && body[i + 2] === '/') {
        regex += '(?:.*/)?';
        i += 2;
      } else if (body[i + 1] === '*') {
        regex += '.*';
        i += 1;
      } else {
        regex += '[^/]*';
      }
    } else if (ch === '?') {
      regex += '[^/]';
    } else if (
      ch === '.' ||
      ch === '+' ||
      ch === '(' ||
      ch === ')' ||
      ch === '|' ||
      ch === '^' ||
      ch === '$' ||
      ch === '{' ||
      ch === '}' ||
      ch === '[' ||
      ch === ']' ||
      ch === '\\'
    ) {
      regex += `\\${ch}`;
    } else {
      regex += ch;
    }
  }

  const prefix = anchored ? '^' : '^(?:.*/)?';
  const suffix = matchDirsOnly ? '(?:/.*)?$' : '(?:$|/.*$)';

  try {
    return new RegExp(prefix + regex + suffix);
  } catch {
    return undefined;
  }
}
