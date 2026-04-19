/**
 * Public API resolver — decides whether an exported symbol is part of a package's
 * intentional public API, so dead-export doesn't flag symbols consumed outside the
 * analyzed graph.
 *
 * Sources of truth, in order:
 *   1. package.json `exports` (string / object / conditional)
 *   2. package.json `main` / `module` / `types`
 *   3. package.json `bin`
 *   4. Conservative barrel fallback: `src/index.ts(x)`, `index.ts(x)`
 *   5. kern.config `review.publicApi` — explicit escape hatch
 *
 * A file listed as a package entry has ALL its named exports treated as public.
 * Re-exports resolved through call-graph are already kept live by existing logic;
 * this rule covers exports consumed by EXTERNAL callers who never show up in
 * the graph (library consumers, dynamic loaders, platform entry points).
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

export interface PublicApiMap {
  /** Absolute paths where every named export is considered public. */
  entryFiles: Set<string>;
  /** Per-symbol overrides in `absolutePath#name` form. */
  explicitSymbols: Set<string>;
}

export interface PublicApiOverrides {
  /** Paths (absolute or relative to projectRoot) whose exports are all public. */
  files?: string[];
  /** Per-symbol overrides in `path#name` form (path absolute or relative to projectRoot). */
  symbols?: string[];
  /** Root to resolve relative `files`/`symbols` against. Defaults to process.cwd(). */
  projectRoot?: string;
}

interface PackageJsonLike {
  exports?: unknown;
  main?: string;
  module?: string;
  types?: string;
  bin?: string | Record<string, string>;
}

const SRC_EXTS = ['.ts', '.tsx'] as const;

function collectSpecifiers(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(collectSpecifiers);
  const out: string[] = [];
  for (const v of Object.values(value as Record<string, unknown>)) {
    out.push(...collectSpecifiers(v));
  }
  return out;
}

/**
 * Resolve a package.json specifier (e.g. `./dist/index.js`) to the source file
 * the review operates on (e.g. `./src/index.ts`). Returns undefined if nothing
 * plausible exists on disk.
 */
export function resolveSpecifierToSrc(
  packageRoot: string,
  specifier: string,
  fileExists: (p: string) => boolean = existsSync,
): string | undefined {
  if (typeof specifier !== 'string' || !specifier.startsWith('.')) return undefined;

  const abs = resolve(packageRoot, specifier);
  const stemMatch = abs.match(/^(.+?)(\.d\.ts|\.js|\.cjs|\.mjs|\.ts|\.tsx)$/);
  const stem = stemMatch ? stemMatch[1] : abs;

  const candidates: string[] = [];

  if (abs.endsWith('.ts') || abs.endsWith('.tsx')) candidates.push(abs);
  for (const ext of SRC_EXTS) candidates.push(`${stem}${ext}`);

  // dist → src swap
  const withSrc = candidates.flatMap((c) => (c.includes('/dist/') ? [c.replace('/dist/', '/src/')] : []));
  candidates.push(...withSrc);

  // Directory entry — try index.{ts,tsx}
  for (const base of [abs, stem]) {
    for (const ext of SRC_EXTS) candidates.push(join(base, `index${ext}`));
  }

  for (const c of candidates) {
    if (fileExists(c)) return c;
  }
  return undefined;
}

/**
 * For a parsed package.json at packageRoot, return all source files that act as
 * public entry points. Missing files are silently dropped.
 */
export function resolvePackageEntryFiles(
  packageRoot: string,
  pkg: PackageJsonLike,
  fileExists: (p: string) => boolean = existsSync,
): string[] {
  const specs = new Set<string>();

  if (pkg.exports !== undefined) {
    for (const s of collectSpecifiers(pkg.exports)) specs.add(s);
  }
  if (typeof pkg.main === 'string') specs.add(pkg.main);
  if (typeof pkg.module === 'string') specs.add(pkg.module);
  if (typeof pkg.types === 'string') specs.add(pkg.types);
  if (typeof pkg.bin === 'string') {
    specs.add(pkg.bin);
  } else if (pkg.bin && typeof pkg.bin === 'object') {
    for (const v of Object.values(pkg.bin)) {
      if (typeof v === 'string') specs.add(v);
    }
  }

  // Conservative barrel fallback — only contributes if the file actually exists.
  for (const ext of SRC_EXTS) {
    specs.add(`./src/index${ext}`);
    specs.add(`./index${ext}`);
  }

  const resolved = new Set<string>();
  for (const s of specs) {
    const p = resolveSpecifierToSrc(packageRoot, s, fileExists);
    if (p) resolved.add(p);
  }
  return [...resolved];
}

function findPackageRoot(startFile: string, cache: Map<string, string | null>): string | null {
  const startDir = dirname(startFile);
  if (cache.has(startDir)) return cache.get(startDir) ?? null;

  const visited: string[] = [];
  let dir = startDir;
  for (let i = 0; i < 30; i++) {
    if (cache.has(dir)) {
      const hit = cache.get(dir) ?? null;
      for (const v of visited) cache.set(v, hit);
      return hit;
    }
    visited.push(dir);
    if (existsSync(join(dir, 'package.json'))) {
      for (const v of visited) cache.set(v, dir);
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const v of visited) cache.set(v, null);
  return null;
}

/**
 * Build a public-API map by walking up from each file to its nearest package.json
 * and collecting declared entry points. Applies config overrides on top.
 */
export function buildPublicApiMap(filePaths: string[], overrides?: PublicApiOverrides): PublicApiMap {
  const rootCache = new Map<string, string | null>();
  const roots = new Set<string>();

  for (const fp of filePaths) {
    const r = findPackageRoot(fp, rootCache);
    if (r) roots.add(r);
  }

  const entryFiles = new Set<string>();
  for (const root of roots) {
    const pkgPath = join(root, 'package.json');
    let pkg: PackageJsonLike;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJsonLike;
    } catch {
      continue;
    }
    for (const f of resolvePackageEntryFiles(root, pkg)) entryFiles.add(f);
  }

  const explicitSymbols = new Set<string>();
  const projectRoot = overrides?.projectRoot ?? process.cwd();

  if (overrides?.files) {
    for (const pattern of overrides.files) {
      if (typeof pattern !== 'string' || pattern.length === 0) continue;
      const abs = isAbsolute(pattern) ? pattern : resolve(projectRoot, pattern);
      entryFiles.add(abs);
    }
  }
  if (overrides?.symbols) {
    for (const spec of overrides.symbols) {
      if (typeof spec !== 'string') continue;
      const idx = spec.lastIndexOf('#');
      if (idx <= 0 || idx === spec.length - 1) continue;
      const rawPath = spec.slice(0, idx);
      const name = spec.slice(idx + 1);
      const abs = isAbsolute(rawPath) ? rawPath : resolve(projectRoot, rawPath);
      explicitSymbols.add(`${abs}#${name}`);
    }
  }

  return { entryFiles, explicitSymbols };
}

export const EMPTY_PUBLIC_API: PublicApiMap = {
  entryFiles: new Set(),
  explicitSymbols: new Set(),
};

export function isPublicApi(map: PublicApiMap, filePath: string, exportName: string): boolean {
  if (map.entryFiles.has(filePath)) return true;
  if (map.explicitSymbols.has(`${filePath}#${exportName}`)) return true;
  return false;
}
