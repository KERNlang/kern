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
import { dirname, relative, resolve } from 'path';
import { type NoSubstitutionTemplateLiteral, Project, type SourceFile, type StringLiteral, SyntaxKind } from 'ts-morph';
import { createPathCanonicalizer } from './path-canonical.js';
import type { GraphEdge, GraphEdgeKind, GraphFile, GraphOptions, GraphResult, ReachabilityBlocker } from './types.js';

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
  /**
   * Source line of the spec node. Currently populated only for re-export
   * specifiers — Producer 1 needs it for the blocker's audit-trail `site`
   * when ts-morph fails to resolve the target. Other ref kinds leave it
   * undefined; nobody reads it for them.
   */
  line?: number;
}

interface ModuleRefScan {
  refs: ModuleEdgeRef[];
  /**
   * Producer 2 (telemetry-only): non-literal `import(expr)` count. Aggregated
   * onto GraphResult.unmappedDynamicImports across the BFS walk. NEVER
   * promoted to a ReachabilityBlocker — would re-introduce red-team
   * CRITICAL #1 (file-scope silencer).
   */
  unmappedDynamicImports: number;
  /**
   * Static import declarations whose ts-morph processing threw. Surfaced
   * via review-health so silent catches don't hide failures from operators.
   */
  malformedImports: number;
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
  // Producer 1 (unresolved named re-export → blocker on importing file's
  // localName) and Producer 2 (non-literal dynamic import → telemetry).
  // Both accumulate across the BFS walk and ride out on GraphResult.
  const blockers: ReachabilityBlocker[] = [];
  let unmappedDynamicImports = 0;
  let malformedImports = 0;
  // Path canonicalisation (red-team #9). Every path that becomes a fileMap
  // KEY or is fed to ts-morph's `addSourceFileAtPath` runs through this
  // memoised canonicaliser so two display paths pointing at the same
  // physical file (pnpm symlinks, macOS /var → /private/var) collapse to
  // a single GraphFile. Display paths are preserved on `gf.path` —
  // the canonicalisation only affects internal identity keys.
  const canonicalize = createPathCanonicalizer();

  // Seed BFS with entry files
  for (const entry of entryFiles) {
    const canonicalEntry = canonicalize(entry);
    // Feed the canonical form to ts-morph so its internal SourceFile
    // store is keyed canonically. When a barrel reachable via a symlink
    // imports the same file via realpath, ts-morph's resolution uses
    // dirname(canonical) and lands on the canonical form too — keeping
    // the project consistent without any other intervention.
    let sf = project.getSourceFile(canonicalEntry);
    if (!sf) {
      try {
        sf = project.addSourceFileAtPath(canonicalEntry);
      } catch {
        const entryPath = resolve(canonicalEntry);
        if (!existsSync(entryPath)) {
          skipped++;
          continue;
        }
        if (!fileMap.has(entryPath)) {
          // Fallback path — rare, only when ts-morph rejects but the file
          // exists on disk. We can't get a SourceFile so we synthesise a
          // GraphFile entry with display = caller's input.
          fileMap.set(entryPath, makeGraphFile(entry, entryPath, 0));
        }
        continue;
      }
    }
    const p = canonicalize(sf.getFilePath());
    if (!fileMap.has(p)) {
      // Display = caller's original entry path (so `report.filePath`
      // matches what the user passed in, even when the entry sits behind
      // a symlinked tmpdir — the regression-repo-shapes fixtures rely on
      // this).
      fileMap.set(p, makeGraphFile(entry, p, 0));
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
    const scan = collectModuleEdgeRefs(sf, canonicalize);
    unmappedDynamicImports += scan.unmappedDynamicImports;
    malformedImports += scan.malformedImports;

    for (const ref of scan.refs) {
      const { sourceFile: resolvedFile, via } = resolveModuleReference(
        project,
        sf,
        ref.specifier,
        ref.resolved,
        canonicalize,
      );

      if (!resolvedFile) {
        // Producer 1: a re-export with a relative specifier that even the
        // extension-fallback couldn't resolve becomes a symbol-scoped
        // blocker on the IMPORTING file's localName. Symbol scope only —
        // never file scope (see ReachabilityBlocker jsdoc and red-team v3).
        //
        // Two re-export shapes carry a concrete local name and qualify:
        //   - `named-reexport`     — `export { foo } from './x'`
        //   - `namespace-reexport` — `export * as ns from './x'`
        // Bare `export *` (kind `export-all`) is excluded because there is
        // no symbol to pin. Bare specifiers (`react`, `lodash/get`) are
        // also excluded: unresolved bare specifiers mean a missing dep,
        // not an unknowable target, and dead-export's package-public-API
        // logic already shields those callers.
        if (
          (ref.kind === 'named-reexport' || ref.kind === 'namespace-reexport') &&
          ref.localName &&
          (ref.specifier.startsWith('.') || ref.specifier.startsWith('/'))
        ) {
          blockers.push({
            reason: 'unresolved-re-export',
            filePath,
            exportName: ref.localName,
            site: { file: filePath, line: ref.line ?? 0 },
          });
        }
        skipped++;
        continue;
      }

      // Canonical-key the resolved file. ts-morph's getFilePath() is
      // verbatim from the parent's path; if we fed canonical above, it
      // returns canonical here too, so this is usually a no-op. Run it
      // anyway so any externally-supplied `options.project` (which may
      // not have been seeded canonical) still produces a clean key.
      const resolvedPath = canonicalize(resolvedFile.getFilePath());

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
        // Derive a DISPLAY path for the reached file from the parent's
        // display path (red-team #9, multi-AI brainstorm Option B + 4th
        // option). The relative form between parent's canonical dir and
        // the resolved canonical path applied to the parent's display
        // dir reproduces the symlink view the user sees: a barrel
        // imported from `/var/folders/.../entry.ts` resolves its './worker'
        // import to `/var/folders/.../worker.ts`, not the realpath form.
        const parentCanonicalDir = dirname(filePath);
        const relFromCanonical = relative(parentCanonicalDir, resolvedPath);
        const displayPath = resolve(dirname(current.path), relFromCanonical);
        const nextFile = makeGraphFile(displayPath, resolvedPath, distance + 1);
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
    project,
    blockers,
    unmappedDynamicImports,
    malformedImports,
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
  canonicalize: (p: string) => string,
): SourceFile | undefined {
  for (const [jsExt, tsExts] of Object.entries(EXT_FALLBACK)) {
    if (!specifier.endsWith(jsExt)) continue;
    const base = specifier.slice(0, -jsExt.length);
    for (const tsExt of tsExts) {
      const candidate = base + tsExt;
      // Canonicalise before adding so ts-morph stores the realpath form.
      // Same physical file reachable via two display paths collapses to
      // a single SourceFile, preventing duplicate entries (red-team #9).
      const fullPath = canonicalize(resolve(fromFile.getDirectoryPath(), candidate));
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

function makeGraphFile(path: string, canonicalPath: string, distance: number): GraphFile {
  return {
    path,
    canonicalPath,
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
  canonicalize: (p: string) => string,
): { sourceFile: SourceFile | undefined; via: GraphEdge['via'] } {
  if (resolved) return { sourceFile: resolved, via: 'ts-morph' };
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const fallback = tryExtensionFallback(project, fromFile, specifier, canonicalize);
    if (fallback) return { sourceFile: fallback, via: 'extension-fallback' };
  }
  return { sourceFile: undefined, via: 'ts-morph' };
}

function collectModuleEdgeRefs(sourceFile: SourceFile, canonicalize: (p: string) => string): ModuleRefScan {
  const refs: ModuleEdgeRef[] = [];
  let unmappedDynamicImports = 0;
  let malformedImports = 0;

  for (const decl of sourceFile.getImportDeclarations()) {
    try {
      // `import type { X } from './m'` and `import type Foo from './m'` are
      // erased at compile time. They MUST NOT contribute caller edges,
      // otherwise dead-export reachability counts type-only references as
      // proof a runtime symbol is alive — a category of FP red-team flagged.
      if (decl.isTypeOnly()) continue;

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
        // Mixed form: `import { Foo, type Bar } from './m'` — Bar is erased.
        if (named.isTypeOnly()) continue;
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
    } catch (err) {
      // ts-morph threw while reading this static-import declaration.
      // Causes seen in the wild: malformed AST after a parse-error file,
      // transient FS race during watch-mode, an internal ts-morph
      // assertion. Swallowing silently was a bug — operators had no way
      // to know analysis was incomplete. Now we count, surface via
      // review-health, and log under KERN_DEBUG so the failure is
      // recoverable AND observable.
      malformedImports++;
      if (process.env.KERN_DEBUG) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`graph: failed to read import declaration in ${sourceFile.getFilePath()}: ${msg}`);
      }
    }
  }

  // Dynamic imports — `import('./mod')` / `await import('./mod')`. ts-morph
  // models the call's expression as `SyntaxKind.ImportKeyword` (NOT an
  // identifier whose text is "import"), so this is the correct discriminator
  // — red-team #5 specifically called out the identifier-based check as a
  // bug that would silently skip every dynamic import.
  //
  // Only LITERAL specifiers produce an edge here. A non-literal argument
  // (e.g. `import(routes[role])`) is left untouched: step 9b will record a
  // symbol-scoped ReachabilityBlocker for that case so the resulting
  // dead-export confidence is capped — never silently suppressed.
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.ImportKeyword) continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    const first = args[0];
    if (!first) continue;
    const argKind = first.getKind();
    if (argKind !== SyntaxKind.StringLiteral && argKind !== SyntaxKind.NoSubstitutionTemplateLiteral) {
      // Producer 2 (telemetry-only): the specifier isn't a literal so we can't
      // derive a target file or export name. Step 9b's invariant #5 — NEVER
      // produce a blocker here. The exportName cannot be inferred and falling
      // back to file scope re-introduces red-team CRITICAL #1 (one dynamic
      // import silenced 50 unrelated symbols). Counter only.
      unmappedDynamicImports++;
      continue;
    }

    let specifier: string;
    try {
      specifier = (first as StringLiteral | NoSubstitutionTemplateLiteral).getLiteralValue();
    } catch {
      continue;
    }

    const resolved = resolveDynamicImportTarget(sourceFile, specifier, canonicalize);
    refs.push({
      specifier,
      resolved,
      kind: 'dynamic-import',
    });
  }

  for (const decl of sourceFile.getExportDeclarations()) {
    // `export type { X } from './m'` is erased at compile time and must not
    // contribute a re-export edge. Same reasoning as the import side: a
    // type-only re-export is not evidence the runtime symbol is alive.
    if (decl.isTypeOnly()) continue;

    let specifier: string | undefined;
    let resolved: SourceFile | undefined;
    try {
      specifier = decl.getModuleSpecifierValue();
      if (!specifier) continue;
      resolved = decl.getModuleSpecifierSourceFile() ?? undefined;
    } catch {
      continue;
    }
    // `export * as ns from './m'` — ts-morph models this distinctly from
    // bare `export *` (which has no namespace export node). The namespace
    // alias is a concrete local name we can scope a Producer 1 blocker
    // against when the target is unresolved. Bare `export *` stays under
    // `export-all` and never produces a blocker (no symbol to pin).
    const namespaceExport = decl.getNamespaceExport();
    if (namespaceExport) {
      refs.push({
        specifier,
        resolved,
        kind: 'namespace-reexport',
        importedName: '*',
        localName: namespaceExport.getName(),
        line: namespaceExport.getStartLineNumber(),
      });
      continue;
    }

    const namedExports = decl.getNamedExports();

    if (namedExports.length === 0) {
      refs.push({ specifier, resolved, kind: 'export-all' });
      continue;
    }

    for (const named of namedExports) {
      // Mixed form: `export { foo, type Bar } from './m'`.
      if (named.isTypeOnly()) continue;
      refs.push({
        specifier,
        resolved,
        kind: 'named-reexport',
        importedName: named.getName(),
        localName: named.getAliasNode()?.getText() ?? named.getName(),
        line: named.getStartLineNumber(),
      });
    }
  }

  return { refs, unmappedDynamicImports, malformedImports };
}

/**
 * Resolve a literal dynamic-import specifier to a SourceFile in the project.
 * ts-morph's CallExpression has no `getModuleSpecifierSourceFile()` analogue,
 * so this mirrors the resolution shape that static imports get for free:
 *
 *   1. Direct hit on the joined absolute path (already a `.ts(x)` file).
 *   2. Extension probe: append `.ts`, `.tsx`, `.js`, `.jsx`.
 *   3. Directory probe: `<spec>/index.ts(x)`.
 *
 * Returns undefined for relative specifiers that don't land on any source
 * file under the project — those become unresolved dynamic-import edges,
 * which step 9b's blocker logic distinguishes from non-literal cases.
 *
 * Bare/package specifiers (e.g. `import('react')`) are intentionally NOT
 * resolved; the import-graph already skips node_modules at the BFS level.
 */
function resolveDynamicImportTarget(
  fromFile: SourceFile,
  specifier: string,
  canonicalize: (p: string) => string,
): SourceFile | undefined {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return undefined;

  const project = fromFile.getProject();
  const fromDir = fromFile.getDirectoryPath();
  // Canonicalise the joined path so dynamic-import targets that traverse
  // a symlink (pnpm `node_modules/.pnpm/...`) collapse to the same key
  // ts-morph already has for the realpath form.
  const abs = canonicalize(resolve(fromDir, specifier));

  const direct = project.getSourceFile(abs);
  if (direct) return direct;

  const extensionCandidates = ['.ts', '.tsx', '.js', '.jsx'];
  for (const ext of extensionCandidates) {
    const cand = canonicalize(abs + ext);
    const known = project.getSourceFile(cand);
    if (known) return known;
    if (existsSync(cand)) {
      try {
        return project.addSourceFileAtPath(cand);
      } catch {
        /* unreadable candidate — fall through */
      }
    }
  }

  for (const ext of ['.ts', '.tsx']) {
    const cand = canonicalize(resolve(abs, `index${ext}`));
    const known = project.getSourceFile(cand);
    if (known) return known;
    if (existsSync(cand)) {
      try {
        return project.addSourceFileAtPath(cand);
      } catch {
        /* unreadable candidate — fall through */
      }
    }
  }

  return undefined;
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
