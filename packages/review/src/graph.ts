/**
 * Import graph resolver — BFS-walks TypeScript imports from entry files.
 *
 * Resolves: relative imports, .js→.ts extension mapping, path aliases (via tsconfig),
 * barrel files (index.ts re-exports). Skips: node_modules, .d.ts files.
 * Handles circular imports via visited set. Tracks shortest distance per file.
 *
 * Codex contributions: extension fallback, shortest-distance tracking, skip counters.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { Project, type SourceFile } from 'ts-morph';
import type { GraphEdge, GraphEdgeKind, GraphFile, GraphOptions, GraphResult } from './types.js';

/** Extension fallback map: .js→.ts, .jsx→.tsx (Codex idea) */
const EXT_FALLBACK: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

interface ModuleEdgeRef {
  specifier: string;
  resolved: SourceFile | undefined;
  kind: GraphEdgeKind;
  importedName?: string;
  localName?: string;
}

export function resolveImportGraph(entryFiles: string[], options: GraphOptions = {}): GraphResult {
  const maxDepth = options.maxDepth ?? 3;
  const project =
    options.project ??
    new Project({
      tsConfigFilePath: options.tsConfigFilePath,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: options.tsConfigFilePath
        ? undefined
        : {
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
      try {
        sf = project.addSourceFileAtPath(entry);
      } catch {
        const entryPath = resolve(entry);
        if (!existsSync(entryPath)) {
          skipped++;
          continue;
        }
        if (!fileMap.has(entryPath)) {
          fileMap.set(entryPath, makeGraphFile(entryPath, 0));
        }
        continue;
      }
    }
    const p = sf.getFilePath();
    if (!fileMap.has(p)) {
      fileMap.set(p, makeGraphFile(p, 0));
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
    const refs = collectModuleEdgeRefs(sf);

    for (const ref of refs) {
      const { sourceFile: resolvedFile, via } = resolveModuleReference(project, sf, ref.specifier, ref.resolved);

      if (!resolvedFile) {
        skipped++;
        continue;
      }

      const resolvedPath = resolvedFile.getFilePath();

      // Skip .d.ts and node_modules (even if resolved via path alias)
      if (resolvedPath.endsWith('.d.ts')) {
        skipped++;
        continue;
      }
      if (resolvedPath.includes('/node_modules/')) {
        skipped++;
        continue;
      }

      const edge: GraphEdge = {
        from: filePath,
        to: resolvedPath,
        specifier: ref.specifier,
        kind: ref.kind,
        importedName: ref.importedName,
        localName: ref.localName,
        via,
      };
      pushUniqueEdge(current.importEdges, edge);

      if (!current.imports.includes(resolvedPath)) {
        current.imports.push(resolvedPath);
      }

      if (!fileMap.has(resolvedPath)) {
        const nextFile = makeGraphFile(resolvedPath, distance + 1);
        nextFile.importedBy.push(filePath);
        nextFile.incomingEdges.push(edge);
        fileMap.set(resolvedPath, nextFile);
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
        pushUniqueEdge(existing.incomingEdges, edge);
      }
    }
  }

  const files = Array.from(fileMap.values());
  return {
    files,
    entryFiles: files.filter((f) => f.distance === 0).map((f) => f.path),
    totalFiles: files.length,
    skipped,
  };
}

/**
 * Extension fallback: when ts-morph can't resolve ./foo.js, try ./foo.ts and ./foo.tsx.
 * Common in ESM projects where imports use .js but source files are .ts.
 */
function tryExtensionFallback(project: Project, fromFile: SourceFile, specifier: string): SourceFile | undefined {
  for (const [jsExt, tsExts] of Object.entries(EXT_FALLBACK)) {
    if (!specifier.endsWith(jsExt)) continue;
    const base = specifier.slice(0, -jsExt.length);
    for (const tsExt of tsExts) {
      const candidate = base + tsExt;
      const fullPath = resolve(fromFile.getDirectoryPath(), candidate);
      const existing = project.getSourceFile(fullPath);
      if (existing) return existing;
      if (!existsSync(fullPath)) continue;
      try {
        return project.addSourceFileAtPath(fullPath);
      } catch {
        /* ignore unreadable candidates */
      }
    }
  }
  return undefined;
}

function makeGraphFile(path: string, distance: number): GraphFile {
  return {
    path,
    distance,
    imports: [],
    importedBy: [],
    importEdges: [],
    incomingEdges: [],
  };
}

function resolveModuleReference(
  project: Project,
  fromFile: SourceFile,
  specifier: string,
  resolved: SourceFile | undefined,
): { sourceFile: SourceFile | undefined; via: GraphEdge['via'] } {
  if (resolved) return { sourceFile: resolved, via: 'ts-morph' };
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const fallback = tryExtensionFallback(project, fromFile, specifier);
    if (fallback) return { sourceFile: fallback, via: 'extension-fallback' };
  }
  return { sourceFile: undefined, via: 'ts-morph' };
}

function collectModuleEdgeRefs(sourceFile: SourceFile): ModuleEdgeRef[] {
  const refs: ModuleEdgeRef[] = [];

  for (const decl of sourceFile.getImportDeclarations()) {
    try {
      const specifier = decl.getModuleSpecifierValue();
      const resolved = decl.getModuleSpecifierSourceFile();
      let recorded = false;

      const defaultImport = decl.getDefaultImport();
      if (defaultImport) {
        refs.push({
          specifier,
          resolved,
          kind: 'default-import',
          importedName: 'default',
          localName: defaultImport.getText(),
        });
        recorded = true;
      }

      for (const named of decl.getNamedImports()) {
        refs.push({
          specifier,
          resolved,
          kind: 'named-import',
          importedName: named.getName(),
          localName: named.getAliasNode()?.getText() ?? named.getName(),
        });
        recorded = true;
      }

      const namespaceImport = decl.getNamespaceImport();
      if (namespaceImport) {
        refs.push({
          specifier,
          resolved,
          kind: 'namespace-import',
          importedName: '*',
          localName: namespaceImport.getText(),
        });
        recorded = true;
      }

      if (!recorded) {
        refs.push({ specifier, resolved, kind: 'side-effect-import' });
      }
    } catch {
      /* skip dynamic imports with non-literal specifiers */
    }
  }

  for (const decl of sourceFile.getExportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (!specifier) continue;
    const resolved = decl.getModuleSpecifierSourceFile();
    const namedExports = decl.getNamedExports();

    if (namedExports.length === 0) {
      refs.push({ specifier, resolved, kind: 'export-all' });
      continue;
    }

    for (const named of namedExports) {
      refs.push({
        specifier,
        resolved,
        kind: 'named-reexport',
        importedName: named.getName(),
        localName: named.getAliasNode()?.getText() ?? named.getName(),
      });
    }
  }

  return refs;
}

function pushUniqueEdge(edges: GraphEdge[], edge: GraphEdge): void {
  const exists = edges.some(
    (existing) =>
      existing.from === edge.from &&
      existing.to === edge.to &&
      existing.specifier === edge.specifier &&
      existing.kind === edge.kind &&
      existing.importedName === edge.importedName &&
      existing.localName === edge.localName &&
      existing.via === edge.via,
  );
  if (!exists) edges.push(edge);
}
