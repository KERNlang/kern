import { ReviewReport, ReviewConfig } from './types.js';
import { createHash } from 'crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';

export class ReviewCache {
  private l1 = new Map<string, ReviewReport>();
  private cacheDir = join(process.cwd(), '.kern/cache/review/');

  constructor() {
    this.ensureCacheDir();
  }

  private ensureCacheDir() {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
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
  hash.update(fileContent);
  hash.update(JSON.stringify(config));
  hash.update(filePath);
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
      } catch { /* skip unreadable dirs */ }
    }
  }
  return hash.digest('hex');
}

export const reviewCache = new ReviewCache();

export function clearReviewCache(): void {
  reviewCache.clear();
}
