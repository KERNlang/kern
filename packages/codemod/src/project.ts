/**
 * Shared ts-morph Project loader.
 *
 * Mirrors the tsconfig lookup from packages/review/src/inferrer.ts so codemod
 * runs against the same type-resolution graph as review. A single Project is
 * reused across all files in a codemod run so affected-set diagnostics amortize
 * well under --interactive.
 */

import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { Project } from 'ts-morph';

function findTsConfig(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    const candidate = resolve(dir, 'tsconfig.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export interface LoadProjectOptions {
  /** Start directory for tsconfig lookup. Defaults to process.cwd(). */
  cwd?: string;
  /** Force in-memory project (used by unit tests). */
  inMemory?: boolean;
}

export function loadHostProject(opts: LoadProjectOptions = {}): Project {
  if (opts.inMemory) {
    return new Project({
      compilerOptions: { strict: true, target: 99 },
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
  }

  const startDir = opts.cwd ?? process.cwd();
  const tsConfigFilePath = findTsConfig(startDir);

  if (tsConfigFilePath) {
    return new Project({
      tsConfigFilePath,
      skipAddingFilesFromTsConfig: true,
    });
  }

  return new Project({
    compilerOptions: { strict: true, target: 99 },
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
  });
}
