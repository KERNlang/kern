import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import type { ReviewConfig, ReviewReport } from './types.js';

// Version stamp for cache invalidation — changes when rules/analyzers change
const REVIEW_CACHE_VERSION = '3.2.1';
const IMPORT_SPECIFIER_RE =
  /(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXTENSION_FALLBACK: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.mts', '.cts'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

export class ReviewCache {
  private l1 = new Map<string, ReviewReport>();
  private cacheDir: string;

  constructor() {
    // Use home directory to avoid writing to root (/) when cwd is unavailable (e.g. VS Code extension host)
    const base = process.cwd() === '/' ? homedir() : process.cwd();
    this.cacheDir = join(base, '.kern/cache/review/');
    this.ensureCacheDir();
  }

  private ensureCacheDir() {
    try {
      if (!existsSync(this.cacheDir)) {
        mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch {
      // Fallback: if we can't create the cache dir, L1 (in-memory) still works
    }
  }

  public get(key: string): ReviewReport | undefined {
    // Check L1
    if (this.l1.has(key)) {
      return this.l1.get(key);
    }

    // Check L2
    const cachePath = join(this.cacheDir, `${key}.json`);
    if (existsSync(cachePath)) {
      try {
        const data = JSON.parse(readFileSync(cachePath, 'utf-8'));
        this.l1.set(key, data);
        return data;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  public set(key: string, report: ReviewReport): void {
    this.l1.set(key, report);
    const cachePath = join(this.cacheDir, `${key}.json`);
    try {
      this.ensureCacheDir();
      writeFileSync(cachePath, JSON.stringify(report), 'utf-8');
    } catch {
      // Ignore write errors
    }
  }

  public clear(): void {
    this.l1.clear();
    if (existsSync(this.cacheDir)) {
      try {
        rmSync(this.cacheDir, { recursive: true, force: true });
        this.ensureCacheDir();
      } catch {
        // Ignore clear errors
      }
    }
  }
}

export function computeCacheKey(fileContent: string, config: ReviewConfig, filePath: string): string {
  const hash = createHash('sha256');
  // Include version so cache auto-invalidates when kern-lang is upgraded
  hash.update(REVIEW_CACHE_VERSION);
  hash.update(fileContent);
  hash.update(JSON.stringify(config));
  hash.update(filePath);
  hashRelativeImportTree(hash, filePath, fileContent, new Set([filePath]), 0);
  // Include custom rule file contents in cache key to avoid stale hits when rules change
  if (config.rulesDirs) {
    for (const dir of config.rulesDirs) {
      try {
        if (existsSync(dir)) {
          for (const entry of readdirSync(dir)) {
            if (entry.endsWith('.kern')) {
              hash.update(readFileSync(join(dir, entry), 'utf-8'));
            }
          }
        }
      } catch {
        /* skip unreadable dirs */
      }
    }
  }
  return hash.digest('hex');
}

function hashRelativeImportTree(
  hash: ReturnType<typeof createHash>,
  filePath: string,
  fileContent: string,
  seen: Set<string>,
  depth: number,
  maxDepth = 3,
): void {
  if (depth >= maxDepth) return;

  for (const specifier of collectRelativeImportSpecifiers(fileContent)) {
    for (const candidate of resolveImportCandidates(filePath, specifier)) {
      if (!existsSync(candidate) || seen.has(candidate)) continue;
      seen.add(candidate);

      try {
        const importedContent = readFileSync(candidate, 'utf-8');
        hash.update(candidate);
        hash.update(importedContent);
        hashRelativeImportTree(hash, candidate, importedContent, seen, depth + 1, maxDepth);
        break;
      } catch {
        /* skip unreadable imports */
      }
    }
  }
}

function collectRelativeImportSpecifiers(fileContent: string): string[] {
  const specs = new Set<string>();
  for (const match of fileContent.matchAll(IMPORT_SPECIFIER_RE)) {
    const spec = match[1] ?? match[2];
    if (spec?.startsWith('.')) specs.add(spec);
  }
  return [...specs];
}

function resolveImportCandidates(filePath: string, specifier: string): string[] {
  const baseDir = dirname(filePath);
  const candidates: string[] = [];

  const pushResolved = (relativePath: string) => {
    candidates.push(resolve(baseDir, relativePath));
  };

  const ext = Object.keys(EXTENSION_FALLBACK).find((suffix) => specifier.endsWith(suffix));
  if (ext) {
    pushResolved(specifier);
    for (const fallback of EXTENSION_FALLBACK[ext]) {
      pushResolved(`${specifier.slice(0, -ext.length)}${fallback}`);
    }
    return candidates;
  }

  if (/\.[cm]?[jt]sx?$/.test(specifier)) {
    pushResolved(specifier);
    return candidates;
  }

  for (const suffix of ['.ts', '.tsx', '.mts', '.cts', '/index.ts', '/index.tsx', '/index.mts', '/index.cts']) {
    pushResolved(`${specifier}${suffix}`);
  }
  return candidates;
}

export const reviewCache = new ReviewCache();

export function clearReviewCache(): void {
  reviewCache.clear();
}
