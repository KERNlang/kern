/**
 * File Context — derives runtime boundary and import chain context from the import graph.
 *
 * Answers: "Is this file a server component or client component?"
 * Not by looking at the file itself, but by tracing the import chain back to the entry point.
 *
 * A file without 'use client' is still a client component if ALL its importers
 * are within a client boundary. A file under app/api/ is an API route handler.
 * A file imported by both server and client entry points is 'shared'.
 */

import { readFileSync } from 'fs';
import type { FileContext, GraphFile, GraphResult, RuntimeBoundary } from './types.js';

// ── Entry Point Classification ──────────────────────────────────────────

/** Classify an entry point file by its path and content */
function classifyEntryPoint(filePath: string): RuntimeBoundary {
  const lower = filePath.toLowerCase();

  // Next.js App Router conventions
  if (/\/app\/.*\/route\.(ts|tsx|js|jsx)$/.test(lower)) return 'api';
  if (/\/api\//.test(lower)) return 'api';
  if (/\/middleware\.(ts|tsx|js|jsx)$/.test(lower)) return 'middleware';

  // Check for 'use client' directive
  try {
    const source = readFileSync(filePath, 'utf-8');
    if (/^['"]use client['"];?\s*$/m.test(source.substring(0, 200))) return 'client';
  } catch {
    /* can't read — fall through */
  }

  // Next.js: page.tsx, layout.tsx, loading.tsx, error.tsx, template.tsx = server by default
  if (/\/(page|layout|loading|error|template|not-found|default)\.(ts|tsx|js|jsx)$/.test(lower)) return 'server';

  // Express/Fastapi route files
  if (/\/routes?\//.test(lower)) return 'api';
  if (/\/handlers?\//.test(lower)) return 'api';
  if (/\/controllers?\//.test(lower)) return 'api';

  // CLI entry points
  if (/\/cli\.(ts|js)$/.test(lower) || /\/bin\//.test(lower)) return 'server';

  return 'unknown';
}

// ── 'use client' Detection ──────────────────────────────────────────────

const useClientCache = new Map<string, boolean>();

/**
 * Check if a file starts with a `'use client'` directive.
 * Exported so App Router rules can detect client-boundary files without
 * going through the full graph pass. Results are memoized across calls.
 */
export function hasUseClientDirective(filePath: string): boolean {
  const cached = useClientCache.get(filePath);
  if (cached !== undefined) return cached;
  try {
    const source = readFileSync(filePath, 'utf-8');
    const result = /^['"]use client['"];?\s*$/m.test(source.substring(0, 200));
    useClientCache.set(filePath, result);
    return result;
  } catch {
    useClientCache.set(filePath, false);
    return false;
  }
}

// ── Client Boundary Propagation ─────────────────────────────────────────

/**
 * Determine if a file is within a client boundary.
 * A file is client if:
 *   1. It has 'use client' directive, OR
 *   2. ALL files that import it are within a client boundary (recursive)
 *
 * Entry files without 'use client' are server by definition.
 */
function isWithinClientBoundary(
  filePath: string,
  fileMap: Map<string, GraphFile>,
  entrySet: Set<string>,
  cache: Map<string, boolean>,
  visiting: Set<string>,
): boolean {
  if (hasUseClientDirective(filePath)) return true;

  const cached = cache.get(filePath);
  if (cached !== undefined) return cached;

  // Entry files without 'use client' are server components
  if (entrySet.has(filePath)) {
    cache.set(filePath, false);
    return false;
  }

  // Cycle guard — optimistic (assume client in cycles)
  if (visiting.has(filePath)) return true;

  const gf = fileMap.get(filePath);
  if (!gf || gf.importedBy.length === 0) {
    cache.set(filePath, false);
    return false;
  }

  visiting.add(filePath);
  const result = gf.importedBy.every((importer) =>
    isWithinClientBoundary(importer, fileMap, entrySet, cache, visiting),
  );
  visiting.delete(filePath);
  cache.set(filePath, result);
  return result;
}

// ── Import Chain Tracing ────────────────────────────────────────────────

/** Trace the shortest import chain from an entry point to the target file */
function traceImportChain(targetPath: string, fileMap: Map<string, GraphFile>, entrySet: Set<string>): string[] {
  if (entrySet.has(targetPath)) return [targetPath];

  // BFS backwards (following importedBy edges) from target toward entry points.
  // parent maps: child → its importer (one step closer to entry).
  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: string[] = [targetPath];
  visited.add(targetPath);
  let foundEntry: string | undefined;

  while (queue.length > 0) {
    const current = queue.shift()!;

    const gf = fileMap.get(current);
    if (!gf) continue;
    for (const importer of gf.importedBy) {
      if (visited.has(importer)) continue;
      visited.add(importer);
      parent.set(importer, current); // importer → current (toward target)

      if (entrySet.has(importer)) {
        foundEntry = importer;
        break;
      }
      queue.push(importer);
    }
    if (foundEntry) break;
  }

  if (!foundEntry) return [targetPath];

  // Reconstruct: walk from entry → target via parent map
  // parent maps importer→child, so walk: entry → parent.get(entry) → ... → target
  const chain: string[] = [foundEntry];
  let node = foundEntry;
  while (node !== targetPath) {
    const next = parent.get(node);
    if (!next) break;
    chain.push(next);
    node = next;
  }
  return chain;
}

// ── Main API ────────────────────────────────────────────────────────────

/**
 * Build FileContext for every file in the import graph.
 * This is the main function — call it once after resolving the import graph,
 * then pass the resulting Map into each rule via RuleContext.fileContext.
 */
export function buildFileContextMap(graph: GraphResult): Map<string, FileContext> {
  const contextMap = new Map<string, FileContext>();
  const fileMap = new Map<string, GraphFile>();
  // Internal maps key by canonicalPath (red-team #9 / Option B). Cross-file
  // edges (gf.imports / gf.importedBy / graph.entryFiles include canonical
  // forms after the canonicalisation pass in graph.ts), and ts-morph paths
  // round-trip through canonical, so canonical is the only stable key.
  // Display paths are reported via gf.path on the value side, not the key.
  const entrySet = new Set(graph.entryFiles.map((p) => graph.files.find((g) => g.path === p)?.canonicalPath ?? p));

  for (const gf of graph.files) {
    fileMap.set(gf.canonicalPath, gf);
  }

  // Classify entry points (key by canonicalPath so subsequent lookups match)
  const entryBoundaries = new Map<string, RuntimeBoundary>();
  for (const entry of graph.entryFiles) {
    const entryGf = graph.files.find((g) => g.path === entry);
    const key = entryGf?.canonicalPath ?? entry;
    // classifyEntryPoint reads suffix patterns (page.tsx, route.ts, etc.) —
    // those are the same regardless of /var vs /private/var, so passing
    // either form works. Use display so reads from disk hit the right file.
    entryBoundaries.set(key, classifyEntryPoint(entry));
  }

  // Client boundary propagation cache
  const clientBoundaryCache = new Map<string, boolean>();

  for (const gf of graph.files) {
    const isClient = isWithinClientBoundary(gf.canonicalPath, fileMap, entrySet, clientBoundaryCache, new Set());
    // hasUseClientDirective reads from disk — pass display so symlinked
    // paths work even on systems without realpath idempotence guarantees.
    const hasDirective = hasUseClientDirective(gf.path);
    const importChain = traceImportChain(gf.canonicalPath, fileMap, entrySet);

    // Determine boundary from import chain
    let boundary: RuntimeBoundary = 'unknown';

    if (isClient || hasDirective) {
      boundary = 'client';
    } else if (entrySet.has(gf.canonicalPath)) {
      boundary = entryBoundaries.get(gf.canonicalPath) || 'unknown';
    } else {
      // Inherit boundary from entry points that import this file
      const entryBounds = new Set<RuntimeBoundary>();
      for (const entry of graph.entryFiles) {
        const entryGf = graph.files.find((g) => g.path === entry);
        const entryKey = entryGf?.canonicalPath ?? entry;
        if (entryGf && canReach(entryKey, gf.canonicalPath, fileMap, new Set())) {
          entryBounds.add(entryBoundaries.get(entryKey) || 'unknown');
        }
      }

      if (entryBounds.size === 1) {
        boundary = [...entryBounds][0];
      } else if (entryBounds.size > 1) {
        boundary = 'shared'; // imported by both server and client entry points
      }
    }

    // Find which entry points reach this file
    const reachableEntries: string[] = [];
    for (const entry of graph.entryFiles) {
      const entryGf = graph.files.find((g) => g.path === entry);
      const entryKey = entryGf?.canonicalPath ?? entry;
      if (entryKey === gf.canonicalPath || canReach(entryKey, gf.canonicalPath, fileMap, new Set())) {
        // Push the DISPLAY entry path so consumers see what the user
        // passed in, not the realpath-resolved form.
        reachableEntries.push(entry);
      }
    }

    // contextMap keyed by gf.path (display) so callers querying by the
    // path they passed in find the entry directly. Internal lookups
    // (fileMap, traceImportChain) use canonicalPath — see above.
    contextMap.set(gf.path, {
      boundary,
      entryPoints: reachableEntries,
      importChain,
      depth: gf.distance,
      importedBy: gf.importedBy,
      isClientBoundary: isClient,
      hasUseClientDirective: hasDirective,
    });
  }

  return contextMap;
}

/** Check if source file can reach target file via imports (DFS) */
function canReach(source: string, target: string, fileMap: Map<string, GraphFile>, visited: Set<string>): boolean {
  if (visited.has(source)) return false;
  visited.add(source);

  const gf = fileMap.get(source);
  if (!gf) return false;

  for (const imp of gf.imports) {
    if (imp === target) return true;
    if (canReach(imp, target, fileMap, visited)) return true;
  }
  return false;
}

/**
 * Clear the 'use client' cache between runs (for watch mode / tests).
 */
export function clearFileContextCache(): void {
  useClientCache.clear();
}
