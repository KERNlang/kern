/**
 * Evolve Rollback — remove or restore graduated nodes.
 *
 * Moves to .trash/ for recovery instead of deleting permanently.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import { removeFromManifest } from './graduation.js';

export interface RollbackResult {
  success: boolean;
  error?: string;
  usageFiles?: string[];
}

/**
 * Check if a keyword is used in any .kern files under the project.
 */
export function findUsages(keyword: string, baseDir: string = process.cwd()): string[] {
  const usages: string[] = [];

  function walk(dir: string): void {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.kern')) {
          try {
            const content = readFileSync(full, 'utf-8');
            // Check if any line starts with this keyword (at any indent level)
            const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`^\\s*${escaped}\\b`, 'm');
            if (re.test(content)) {
              usages.push(full);
            }
          } catch { /* skip unreadable files */ }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  walk(baseDir);
  return usages;
}

/**
 * Rollback a graduated node. Moves to .trash/ (recoverable).
 *
 * @param force — skip usage check
 */
export function rollbackNode(
  keyword: string,
  baseDir: string = process.cwd(),
  force = false,
): RollbackResult {
  const evolvedDir = resolve(baseDir, '.kern', 'evolved');
  const nodeDir = join(evolvedDir, keyword);

  if (!existsSync(nodeDir)) {
    return { success: false, error: `Node '${keyword}' is not graduated` };
  }

  // Check usage unless forced
  if (!force) {
    const usages = findUsages(keyword, baseDir);
    if (usages.length > 0) {
      return {
        success: false,
        error: `Node '${keyword}' is used in ${usages.length} file(s). Use --force to rollback anyway.`,
        usageFiles: usages,
      };
    }
  }

  try {
    // Move to .trash/
    const trashDir = join(evolvedDir, '.trash');
    mkdirSync(trashDir, { recursive: true });
    const trashDest = join(trashDir, keyword);

    // Remove previous trash if exists
    if (existsSync(trashDest)) {
      rmSync(trashDest, { recursive: true });
    }

    renameSync(nodeDir, trashDest);

    // Update manifest
    removeFromManifest(evolvedDir, keyword);

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Restore a previously rolled-back node from .trash/.
 */
export function restoreNode(
  keyword: string,
  baseDir: string = process.cwd(),
): { success: boolean; error?: string } {
  const evolvedDir = resolve(baseDir, '.kern', 'evolved');
  const trashDir = join(evolvedDir, '.trash', keyword);
  const nodeDir = join(evolvedDir, keyword);

  if (!existsSync(trashDir)) {
    return { success: false, error: `No trashed node '${keyword}' found` };
  }

  if (existsSync(nodeDir)) {
    return { success: false, error: `Node '${keyword}' already exists. Rollback it first.` };
  }

  try {
    renameSync(trashDir, nodeDir);

    // Re-add to manifest from definition.json
    const defPath = join(nodeDir, 'definition.json');
    if (existsSync(defPath)) {
      const def = JSON.parse(readFileSync(defPath, 'utf-8'));
      const manifestPath = join(evolvedDir, 'manifest.json');
      const manifest = existsSync(manifestPath)
        ? JSON.parse(readFileSync(manifestPath, 'utf-8'))
        : { version: 1, nodes: {} };
      manifest.nodes[keyword] = {
        keyword: def.keyword,
        displayName: def.displayName,
        codegenTier: 1,
        childTypes: def.childTypes || [],
        parserHints: def.parserHints,
        hash: def.hash,
        graduatedBy: def.graduatedBy,
        graduatedAt: def.graduatedAt,
        evolveRunId: def.evolveRunId,
        kernVersion: def.kernVersion,
      };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
