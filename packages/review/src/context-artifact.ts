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

import type {
  FileNode,
  ImportRef,
  ProjectContextGraph,
  SymbolKind,
  SymbolNode,
  UsageEntry,
  UseSite,
} from '@kernlang/context';
import { CONTEXT_SCHEMA_VERSION } from '@kernlang/context';
import type { CallGraph } from './call-graph.js';
import type { GraphResult } from './types.js';

/**
 * Build the portable context artifact from a resolved import graph and its call
 * graph. Functions come from the call graph, so their `calledBy` usage edges are
 * first-class (precise call sites). Exported classes/consts/types/interfaces/enums
 * are added in a second pass (via ts-morph), with file-level usage from the
 * import graph. Requires `graph.project` for the second pass; without it, only
 * function symbols are produced.
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
  // Dedup key is `${fileId}#${namespace}#${name}` (namespace = value | type), NOT
  // exact kind: an arrow-function `const foo = () => {}` is seen by the call
  // graph (function) AND the declared pass (const) — both VALUE, so it dedups —
  // while a legal `function Foo` + `type Foo` pair stays distinct across namespaces.
  const seen = new Set<string>();
  let n = 0;
  for (const fn of callGraph.functions.values()) {
    const fileId = fileIdByCanonical.get(fn.filePath);
    if (!fileId) continue; // function in a file outside the artifact's file set
    const id = `s${++n}`;
    seen.add(`${fileId}#value#${fn.name}`);
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

  // Second pass: exported non-function declarations (classes, consts, types,
  // interfaces, enums). The call graph only knows functions, so these would be
  // invisible to the spine otherwise. Their usage is file-level — derived from
  // the import graph (who imports this name) — since precise reference tracking
  // for values/types is out of the call graph's scope. Caveat: the import graph
  // omits type-only imports (compile-time-erased, not runtime edges), so a
  // type used only via `import type {...}` reads as used=0. This never
  // OVER-counts; it can under-count type usage.
  n = addDeclaredSymbols(graph, fileIdByCanonical, display, seen, symbols, usage, n);

  return { schemaVersion: CONTEXT_SCHEMA_VERSION, files, symbols, usage };
}

/**
 * Reverse import index: `${targetCanonical}#${importedName}` → the files that
 * import it. Gives file-level usage ("used in N files") for any exported symbol.
 */
function buildImportUsage(graph: GraphResult, display: (canonical: string) => string): Map<string, UseSite[]> {
  const index = new Map<string, UseSite[]>();
  for (const gf of graph.files) {
    for (const edge of gf.importEdges) {
      if (!edge.importedName) continue;
      const key = `${edge.to}#${edge.importedName}`;
      const sites = index.get(key) ?? [];
      // line 0 = "imported by this file" (the import statement line isn't on the edge).
      sites.push({
        path: display(edge.from),
        line: 0,
        confidence: edge.via === 'ts-morph' ? 'resolved' : 'heuristic',
      });
      index.set(key, sites);
    }
  }
  return index;
}

/** TS namespace a symbol kind lives in. Types/interfaces are `type`; the rest
 *  (function/class/const/enum) are `value`. Used for cross-pass dedup so a
 *  value and a same-named type coexist but duplicate values collapse. */
function namespaceOf(kind: SymbolKind): 'value' | 'type' {
  return kind === 'type' ? 'type' : 'value';
}

/**
 * Add exported class/const/type/interface/enum symbols via ts-morph. Gaps
 * (all under-count, never assert false usage): NAMED defaults
 * (`export default class Foo`) are captured, but ANONYMOUS defaults and bare
 * `export default <expr>` are not; default IMPORTS aren't counted in usage
 * (the reverse index keys on the exported name); enums map to `const` since the
 * schema has no `enum` kind.
 */
function addDeclaredSymbols(
  graph: GraphResult,
  fileIdByCanonical: Map<string, string>,
  display: (canonical: string) => string,
  seen: Set<string>,
  symbols: SymbolNode[],
  usage: Record<string, UsageEntry>,
  n: number,
): number {
  const project = graph.project;
  if (!project) return n;
  const importUsage = buildImportUsage(graph, display);

  for (const gf of graph.files) {
    const fileId = fileIdByCanonical.get(gf.canonicalPath);
    if (!fileId) continue;
    const sf = project.getSourceFile(gf.canonicalPath);
    if (!sf) continue;

    const declared: Array<{ name: string; kind: SymbolKind; line: number }> = [];
    for (const c of sf.getClasses()) {
      const name = c.getName();
      if (c.isExported() && name) declared.push({ name, kind: 'class', line: c.getStartLineNumber() });
    }
    for (const t of sf.getTypeAliases())
      if (t.isExported()) declared.push({ name: t.getName(), kind: 'type', line: t.getStartLineNumber() });
    for (const i of sf.getInterfaces())
      if (i.isExported()) declared.push({ name: i.getName(), kind: 'type', line: i.getStartLineNumber() });
    for (const e of sf.getEnums())
      if (e.isExported()) declared.push({ name: e.getName(), kind: 'const', line: e.getStartLineNumber() });
    for (const stmt of sf.getVariableStatements())
      if (stmt.isExported())
        for (const d of stmt.getDeclarations())
          declared.push({ name: d.getName(), kind: 'const', line: d.getStartLineNumber() });

    for (const dcl of declared) {
      const key = `${fileId}#${namespaceOf(dcl.kind)}#${dcl.name}`;
      if (seen.has(key)) continue; // already added (e.g. arrow-fn const seen as a function)
      seen.add(key);
      const id = `s${++n}`;
      symbols.push({ id, fileId, name: dcl.name, kind: dcl.kind, exported: true, line: dcl.line });
      const sites = importUsage.get(`${gf.canonicalPath}#${dcl.name}`) ?? [];
      usage[id] = { callers: sites, totalCount: sites.length };
    }
  }
  return n;
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
