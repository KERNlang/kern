/**
 * Evolve Rollback — remove or restore graduated nodes.
 *
 * Moves to .trash/ for recovery instead of deleting permanently.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import { removeFromManifest } from './graduation.js';
import type { EvolvedManifest } from './evolved-types.js';

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

// ── Prune ─────────────────────────────────────────────────────────────────

export interface PruneResult {
  keyword: string;
  daysUnused: number;
  pruned: boolean;
  error?: string;
}

/**
 * Prune evolved nodes that haven't been used in any .kern files
 * and are older than the given threshold (default: 90 days).
 *
 * @param dryRun — if true, just report what would be pruned
 */
export function pruneNodes(
  baseDir: string = process.cwd(),
  thresholdDays = 90,
  dryRun = false,
): PruneResult[] {
  const evolvedDir = resolve(baseDir, '.kern', 'evolved');
  const manifestPath = join(evolvedDir, 'manifest.json');

  if (!existsSync(manifestPath)) return [];

  let manifest: EvolvedManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return [];
  }

  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  const results: PruneResult[] = [];

  for (const [keyword, entry] of Object.entries(manifest.nodes)) {
    const graduatedAt = new Date(entry.graduatedAt).getTime();
    const ageMs = now - graduatedAt;
    const daysOld = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    if (ageMs < thresholdMs) continue; // Too young to prune

    // Check if used anywhere
    const usages = findUsages(keyword, baseDir);
    if (usages.length > 0) continue; // Still in use

    if (dryRun) {
      results.push({ keyword, daysUnused: daysOld, pruned: false });
    } else {
      const rollResult = rollbackNode(keyword, baseDir, true);
      results.push({
        keyword,
        daysUnused: daysOld,
        pruned: rollResult.success,
        error: rollResult.error,
      });
    }
  }

  return results;
}

// ── Migrate ───────────────────────────────────────────────────────────────

export interface CollisionInfo {
  keyword: string;
  displayName: string;
  graduatedAt: string;
}

/**
 * Detect keyword collisions between evolved nodes and core NODE_TYPES.
 * Called when KERN is upgraded and new core types may have been added.
 */
export function detectCollisions(
  coreTypes: readonly string[],
  baseDir: string = process.cwd(),
): CollisionInfo[] {
  const evolvedDir = resolve(baseDir, '.kern', 'evolved');
  const manifestPath = join(evolvedDir, 'manifest.json');

  if (!existsSync(manifestPath)) return [];

  let manifest: EvolvedManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return [];
  }

  const collisions: CollisionInfo[] = [];
  const coreSet = new Set(coreTypes);

  for (const [keyword, entry] of Object.entries(manifest.nodes)) {
    if (coreSet.has(keyword)) {
      collisions.push({
        keyword,
        displayName: entry.displayName,
        graduatedAt: entry.graduatedAt,
      });
    }
  }

  return collisions;
}

/**
 * Rename an evolved node's keyword.
 * Updates the manifest, directory name, and definition.json.
 */
export function renameEvolvedNode(
  oldKeyword: string,
  newKeyword: string,
  baseDir: string = process.cwd(),
): { success: boolean; error?: string } {
  const evolvedDir = resolve(baseDir, '.kern', 'evolved');
  const oldDir = join(evolvedDir, oldKeyword);
  const newDir = join(evolvedDir, newKeyword);

  if (!existsSync(oldDir)) {
    return { success: false, error: `Node '${oldKeyword}' not found` };
  }
  if (existsSync(newDir)) {
    return { success: false, error: `Node '${newKeyword}' already exists` };
  }

  try {
    // Rename directory
    renameSync(oldDir, newDir);

    // Update definition.json
    const defPath = join(newDir, 'definition.json');
    if (existsSync(defPath)) {
      const def = JSON.parse(readFileSync(defPath, 'utf-8'));
      def.keyword = newKeyword;
      writeFileSync(defPath, JSON.stringify(def, null, 2));
    }

    // Update manifest
    const manifestPath = join(evolvedDir, 'manifest.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest.nodes[oldKeyword]) {
        manifest.nodes[newKeyword] = { ...manifest.nodes[oldKeyword], keyword: newKeyword };
        delete manifest.nodes[oldKeyword];
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      }
    }

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
