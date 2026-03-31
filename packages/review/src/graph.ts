/**
 * Import graph resolver — BFS-walks TypeScript imports from entry files.
 *
 * Resolves: relative imports, .js→.ts extension mapping, path aliases (via tsconfig),
 * barrel files (index.ts re-exports). Skips: node_modules, .d.ts files.
 * Handles circular imports via visited set. Tracks shortest distance per file.
 *
 * Codex contributions: extension fallback, shortest-distance tracking, skip counters.
 */

import { Project, type SourceFile } from 'ts-morph';
import type { GraphResult, GraphFile, GraphOptions } from './types.js';

/** Extension fallback map: .js→.ts, .jsx→.tsx (Codex idea) */
const EXT_FALLBACK: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

export function resolveImportGraph(
  entryFiles: string[],
  options: GraphOptions = {},
): GraphResult {
  const maxDepth = options.maxDepth ?? 3;
  const project = options.project ?? new Project({
    tsConfigFilePath: options.tsConfigFilePath,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: options.tsConfigFilePath ? undefined : {
      strict: true,
      target: 99,
      module: 99,
      moduleResolution: 100, // Bundler
    },
  });

  const fileMap = new Map<string, GraphFile>();
  const visited = new Set<string>();
  const queue: Array<{ path: string; distance: number }> = [];
  let skipped = 0;

  // Seed BFS with entry files
  for (const entry of entryFiles) {
    let sf = project.getSourceFile(entry);
    if (!sf) {
      try { sf = project.addSourceFileAtPath(entry); } catch { skipped++; continue; }
    }
    const p = sf.getFilePath();
    if (!fileMap.has(p)) {
      fileMap.set(p, { path: p, distance: 0, imports: [], importedBy: [] });
      queue.push({ path: p, distance: 0 });
    }
  }

  // BFS walk
  while (queue.length > 0) {
    const { path: filePath, distance } = queue.shift()!;

    if (visited.has(filePath)) continue;
    visited.add(filePath);

    if (distance >= maxDepth) continue;

    const sf = project.getSourceFile(filePath);
    if (!sf) continue;

    const current = fileMap.get(filePath)!;

    // Collect module references from imports and re-exports (barrel file support)
    const refs: Array<{ specifier: string; resolved: SourceFile | undefined }> = [];

    for (const decl of sf.getImportDeclarations()) {
      try {
        refs.push({
          specifier: decl.getModuleSpecifierValue(),
          resolved: decl.getModuleSpecifierSourceFile(),
        });
      } catch { /* skip dynamic imports with non-literal specifiers */ }
    }
    for (const decl of sf.getExportDeclarations()) {
      const spec = decl.getModuleSpecifierValue();
      if (spec) {
        refs.push({ specifier: spec, resolved: decl.getModuleSpecifierSourceFile() });
      }
    }

    for (const { specifier, resolved } of refs) {
      // Try ts-morph resolution first (handles path aliases via tsconfig)
      let resolvedFile = resolved;

      // For relative imports that weren't resolved, try extension fallback
      if (!resolvedFile && (specifier.startsWith('.') || specifier.startsWith('/'))) {
        resolvedFile = tryExtensionFallback(project, sf, specifier);
      }

      if (!resolvedFile) { skipped++; continue; }

      const resolvedPath = resolvedFile.getFilePath();

      // Skip .d.ts and node_modules (even if resolved via path alias)
      if (resolvedPath.endsWith('.d.ts')) { skipped++; continue; }
      if (resolvedPath.includes('/node_modules/')) { skipped++; continue; }

      if (!current.imports.includes(resolvedPath)) {
        current.imports.push(resolvedPath);
      }

      if (!fileMap.has(resolvedPath)) {
        fileMap.set(resolvedPath, {
          path: resolvedPath,
          distance: distance + 1,
          imports: [],
          importedBy: [filePath],
        });
        queue.push({ path: resolvedPath, distance: distance + 1 });
      } else {
        const existing = fileMap.get(resolvedPath)!;
        // Shortest distance wins (Codex idea)
        if (distance + 1 < existing.distance) {
          existing.distance = distance + 1;
        }
        if (!existing.importedBy.includes(filePath)) {
          existing.importedBy.push(filePath);
        }
      }
    }
  }

  const files = Array.from(fileMap.values());
  return {
    files,
    entryFiles: files.filter(f => f.distance === 0).map(f => f.path),
    totalFiles: files.length,
    skipped,
  };
}

/**
 * Extension fallback: when ts-morph can't resolve ./foo.js, try ./foo.ts and ./foo.tsx.
 * Common in ESM projects where imports use .js but source files are .ts.
 */
function tryExtensionFallback(
  project: Project,
  fromFile: SourceFile,
  specifier: string,
): SourceFile | undefined {
  for (const [jsExt, tsExts] of Object.entries(EXT_FALLBACK)) {
    if (!specifier.endsWith(jsExt)) continue;
    const base = specifier.slice(0, -jsExt.length);
    for (const tsExt of tsExts) {
      const candidate = base + tsExt;
      // Try resolving relative to the importing file's directory
      const fromDir = fromFile.getDirectoryPath();
      const fullPath = fromDir + '/' + candidate.replace(/^\.\//, '');
      const sf = project.getSourceFile(fullPath);
      if (sf) return sf;
    }
  }
  return undefined;
}
