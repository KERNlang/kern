/**
 * Maps KERN review's existing analyses — the import graph (graph.ts) and the
 * function call graph (call-graph.ts) — into a {@link ProjectContextGraph}, the
 * portable artifact consumed by `@kernlang/context` (spine rendering + the
 * `kern context` CLI).
 *
 * This is the bridge that finally gets the call graph's `calledBy` edges in
 * front of the LLM: today only per-file `fileDistances` reach the prompt, so the
 * reviewer never learns who calls the function it is looking at. The artifact
 * carries that usage so the spine can surface "validateSession → used by 6
 * files" alongside the code under review.
 *
 * Path discipline: the call graph keys everything by CANONICAL path (realpath,
 * for symlink-safety — see call-graph.ts / path-canonical.ts), but report
 * file paths, batch file lists, and any user-facing surface use the DISPLAY
 * path. The artifact is a user/LLM-facing surface, so every path here is mapped
 * back to DISPLAY via the graph's canonical→display table. A canonical path with
 * no display entry (a use-site outside the walked graph) falls back to itself.
 */

import type { FileNode, ImportRef, ProjectContextGraph, SymbolNode, UsageEntry, UseSite } from '@kernlang/context';
import { CONTEXT_SCHEMA_VERSION } from '@kernlang/context';
import type { CallGraph } from './call-graph.js';
import type { GraphResult } from './types.js';

/**
 * Build the portable context artifact from a resolved import graph and its call
 * graph. Symbols come from the call graph (functions/methods), so usage edges
 * (`calledBy`) are first-class. Non-callable symbols (consts, types) are out of
 * scope for this pass — they require a wider symbol index (a later phase).
 */
export function buildContextArtifact(graph: GraphResult, callGraph: CallGraph): ProjectContextGraph {
  // canonical → display, so artifact paths match report.filePath / batchFiles.
  const canonicalToDisplay = new Map<string, string>();
  for (const gf of graph.files) canonicalToDisplay.set(gf.canonicalPath, gf.path);
  const display = (canonical: string): string => canonicalToDisplay.get(canonical) ?? canonical;

  // Stable file ids keyed by CANONICAL path — canonical is unique per physical
  // file (realpath), so two symlinked display paths can never collide onto one
  // id and silently merge files. FileNode.path stays the display path.
  const files: FileNode[] = [];
  const fileIdByCanonical = new Map<string, string>();
  graph.files.forEach((gf, i) => {
    const id = `f${i + 1}`;
    fileIdByCanonical.set(gf.canonicalPath, id);
    files.push({ id, path: gf.path, imports: importsOf(gf, display) });
  });

  // One symbol per function node, with its incoming calls as use-sites. The call
  // graph keys functions by canonical filePath, so look the file up by canonical.
  const symbols: SymbolNode[] = [];
  const usage: Record<string, UsageEntry> = {};
  let n = 0;
  for (const fn of callGraph.functions.values()) {
    const fileId = fileIdByCanonical.get(fn.filePath);
    if (!fileId) continue; // function in a file outside the artifact's file set
    const id = `s${++n}`;
    symbols.push({
      id,
      fileId,
      name: fn.name,
      kind: 'function',
      exported: fn.isExported,
      line: fn.line,
    });
    const callers: UseSite[] = fn.calledBy.map((c) => ({
      path: display(c.callerFile),
      line: c.line,
      confidence: c.resolved ? 'resolved' : 'unresolved',
    }));
    usage[id] = { callers, totalCount: callers.length };
  }

  return { schemaVersion: CONTEXT_SCHEMA_VERSION, files, symbols, usage };
}

/** Collapse a file's import edges into one ImportRef per target, with bound names. */
function importsOf(gf: GraphResult['files'][number], display: (canonical: string) => string): ImportRef[] {
  const byTarget = new Map<string, Set<string>>();
  for (const edge of gf.importEdges) {
    const target = display(edge.to);
    const names = byTarget.get(target) ?? new Set<string>();
    if (edge.importedName) names.add(edge.importedName);
    byTarget.set(target, names);
  }
  return [...byTarget].map(([path, names]) => (names.size ? { path, symbols: [...names] } : { path }));
}
