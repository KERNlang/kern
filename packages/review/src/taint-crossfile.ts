/**
 * Taint Tracking — cross-file analysis.
 *
 * Traces tainted data across import boundaries:
 *   handler(req) → importedFn(req.body) → exec() in another file.
 */

import { extname } from 'path';
import type { Project, SourceFile } from 'ts-morph';
import { classifyParams, detectSanitizers, findClosingParen, findTaintedSinks, propagateTaint } from './taint-regex.js';
import type { CrossFileTaintResult, ExportedFunction, TaintSink, TaintSource } from './taint-types.js';
import type { GraphResult, InferResult } from './types.js';

const TS_MORPH_GRAPH_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);

function supportsTsMorphGraphFile(filePath: string): boolean {
  return TS_MORPH_GRAPH_EXTENSIONS.has(extname(filePath).toLowerCase());
}

// ── Export Map ───────────────────────────────────────────────────────────

/**
 * Build a map of exported functions across all files.
 * Maps "filePath::fnName" → ExportedFunction with sink info.
 */
export function buildExportMap(inferredPerFile: Map<string, InferResult[]>): Map<string, ExportedFunction> {
  const exportMap = new Map<string, ExportedFunction>();

  for (const [filePath, inferred] of inferredPerFile) {
    for (const r of inferred) {
      if (r.node.type !== 'fn') continue;
      const fnName = (r.node.props?.name as string) || '';
      if (!fnName) continue;

      // Check if function is exported (absence of export='false' means exported)
      const isExported = r.node.props?.export !== 'false';
      if (!isExported) continue;

      const params = (r.node.props?.params as string) || '';
      const handler = r.node.children?.find((c) => c.type === 'handler');
      const code = (handler?.props?.code as string) || '';

      // Check if the function body contains dangerous sinks
      const sinks: TaintSink[] = [];
      if (code) {
        const dummyTaint: TaintSource[] = [];
        // Parse params to get variable names for sink detection
        const paramNames = params
          .split(',')
          .map((p) => p.trim().split(':')[0]?.trim())
          .filter(Boolean);
        for (const name of paramNames) {
          dummyTaint.push({ name, origin: `param:${name}` });
        }
        if (dummyTaint.length > 0) {
          sinks.push(...findTaintedSinks(code, dummyTaint));
        }
      }

      exportMap.set(`${filePath}::${fnName}`, {
        filePath,
        fnName,
        params,
        hasSink: sinks.length > 0,
        sinks,
      });
    }
  }

  return exportMap;
}

// ── Import Map ──────────────────────────────────────────────────────────

/**
 * Build import→function resolution map.
 * Maps "importingFile::importedName" → absolute file path of the definition.
 */
export function buildImportMap(
  inferredPerFile: Map<string, InferResult[]>,
  graphImports: Map<string, string[]>, // filePath → [resolved import paths]
): Map<string, string> {
  const importMap = new Map<string, string>();

  for (const [filePath, inferred] of inferredPerFile) {
    const resolvedImports = graphImports.get(filePath) || [];

    for (const r of inferred) {
      if (r.node.type !== 'import') continue;
      const from = (r.node.props?.from as string) || '';
      const names = (r.node.props?.names as string) || '';
      const defaultImport = (r.node.props?.default as string) || '';

      if (!from) continue;

      // Find the resolved path for this import specifier
      const resolvedPath = resolvedImports.find((p) =>
        p.includes(from.replace(/^\.\//, '').replace(/\.(js|ts|tsx)$/, '')),
      );
      if (!resolvedPath) continue;

      // Map each imported name to its resolved file
      if (names) {
        for (const name of names.split(',').map((n) => n.trim())) {
          if (name) importMap.set(`${filePath}::${name}`, resolvedPath);
        }
      }
      if (defaultImport) {
        importMap.set(`${filePath}::${defaultImport}`, resolvedPath);
      }
    }
  }

  return importMap;
}

// ── ts-morph-Backed Export / Import Maps ────────────────────────────────

/**
 * Build an export map from ts-morph — works on ANY TypeScript codebase,
 * regardless of whether the file has been KERN-inferred.
 *
 * Scans every exported function declaration and arrow/function-expression
 * variable, extracts its body text, and runs the same sink detector the
 * IR-based map uses. Output keys are identical (`filePath::fnName`) so the
 * result merges cleanly with `buildExportMap`.
 */
export function buildExportMapFromGraph(project: Project, graph: GraphResult): Map<string, ExportedFunction> {
  const exportMap = new Map<string, ExportedFunction>();

  for (const gf of graph.files) {
    if (!supportsTsMorphGraphFile(gf.canonicalPath)) continue;
    // Use canonical for the ts-morph lookup — cgProject is keyed canonical.
    const sf = project.getSourceFile(gf.canonicalPath);
    if (!sf) continue;

    for (const [exportName, decls] of sf.getExportedDeclarations()) {
      for (const decl of decls) {
        const collected = collectFnSignature(decl);
        if (!collected) continue;

        const { params, code } = collected;
        const paramNames = params
          .split(',')
          .map((p) => p.trim().split(':')[0]?.trim())
          .filter(Boolean);

        const sinks: TaintSink[] = [];
        if (code && paramNames.length > 0) {
          const dummyTaint: TaintSource[] = paramNames.map((name) => ({
            name,
            origin: `param:${name}`,
          }));
          sinks.push(...findTaintedSinks(code, dummyTaint));
        }

        // Keys use canonicalPath so callers building keys from a callGraph
        // function (which has fn.filePath = canonical) match. filePath on
        // the value side stays canonical for the same reason; reporters
        // map back to display via the canonicalToDisplay map in index.ts.
        const key = `${gf.canonicalPath}::${exportName}`;
        exportMap.set(key, {
          filePath: gf.canonicalPath,
          fnName: exportName,
          params,
          hasSink: sinks.length > 0,
          sinks,
        });
      }
    }
  }

  return exportMap;
}

/**
 * Build an import map from ts-morph for any TS codebase.
 *
 * Keys: `importingFile::localName`. Works for named imports (including
 * aliased `import { foo as bar }`), default imports, and re-exports resolved
 * via ts-morph's module resolution.
 */
export function buildImportMapFromGraph(project: Project, graph: GraphResult): Map<string, string> {
  const importMap = new Map<string, string>();

  for (const gf of graph.files) {
    if (!supportsTsMorphGraphFile(gf.canonicalPath)) continue;
    const sf = project.getSourceFile(gf.canonicalPath);
    if (!sf) continue;

    for (const imp of sf.getImportDeclarations()) {
      let target: SourceFile | undefined;
      try {
        target = imp.getModuleSpecifierSourceFile() ?? undefined;
      } catch {
        continue;
      }
      if (!target) continue;
      // ts-morph returns canonical here because cgProject was seeded
      // canonical — no extra canonicalisation needed for symmetry.
      const targetPath = target.getFilePath();

      for (const named of imp.getNamedImports()) {
        const localName = named.getAliasNode()?.getText() ?? named.getName();
        importMap.set(`${gf.canonicalPath}::${localName}`, targetPath);
      }
      const def = imp.getDefaultImport();
      if (def) importMap.set(`${gf.canonicalPath}::${def.getText()}`, targetPath);
    }
  }

  return importMap;
}

/**
 * Build a map of *local-name → exported-name* for aliased named imports.
 *
 * Keys: `importingFile::localName`. Values: the actual exported name at the
 * import target. Identity mappings (localName === exportedName) are omitted
 * to keep the map compact. Callers look up `aliasMap.get(key) ?? localName`
 * when they need the name to match against an export map.
 */
export function buildImportAliasMap(project: Project, graph: GraphResult): Map<string, string> {
  const aliasMap = new Map<string, string>();

  for (const gf of graph.files) {
    if (!supportsTsMorphGraphFile(gf.path)) continue;
    const sf = project.getSourceFile(gf.path);
    if (!sf) continue;

    for (const imp of sf.getImportDeclarations()) {
      for (const named of imp.getNamedImports()) {
        const alias = named.getAliasNode();
        if (!alias) continue; // not aliased — localName IS the exported name
        const localName = alias.getText();
        const exportedName = named.getName();
        aliasMap.set(`${gf.path}::${localName}`, exportedName);
      }
    }
  }

  return aliasMap;
}

/** Extract `{ params, code }` from an exported function-ish declaration. */
function collectFnSignature(decl: import('ts-morph').Node): { params: string; code: string } | undefined {
  const kind = decl.getKindName();

  if (kind === 'FunctionDeclaration') {
    const fn = decl as import('ts-morph').FunctionDeclaration;
    const body = fn.getBody();
    return {
      params: fn
        .getParameters()
        .map((p) => p.getText())
        .join(','),
      code: body?.getText() ?? '',
    };
  }

  if (kind === 'VariableDeclaration') {
    const vd = decl as import('ts-morph').VariableDeclaration;
    const init = vd.getInitializer();
    if (!init) return undefined;
    const initKind = init.getKindName();
    if (initKind !== 'ArrowFunction' && initKind !== 'FunctionExpression') return undefined;
    const fn = init as import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression;
    return {
      params: fn
        .getParameters()
        .map((p) => p.getText())
        .join(','),
      code: fn.getBody().getText(),
    };
  }

  return undefined;
}

// ── Cross-File Analysis ─────────────────────────────────────────────────

/**
 * Cross-file taint analysis.
 *
 * For each handler function with tainted params:
 *   1. Find calls to imported functions in the handler body
 *   2. Check if tainted data is passed as an argument
 *   3. Look up the target function — does it have a dangerous sink?
 *   4. If yes and no sanitizer in between → cross-file taint path
 */
export function analyzeTaintCrossFile(
  inferredPerFile: Map<string, InferResult[]>,
  graphImports: Map<string, string[]>,
  graph?: GraphResult,
): CrossFileTaintResult[] {
  const exportMap = buildExportMap(inferredPerFile);
  const importMap = buildImportMap(inferredPerFile, graphImports);

  // Alias resolution for aliased named imports (`import { foo as bar }`).
  // Populated only from ts-morph — the IR-derived path does not preserve alias
  // metadata. Keyed the same as importMap: `importingFile::localName`.
  const aliasMap = new Map<string, string>();

  // Augment with ts-morph-derived maps so taint works on files that were
  // never KERN-inferred. IR-derived entries take priority; ts-morph fills gaps.
  if (graph?.project) {
    const tsExportMap = buildExportMapFromGraph(graph.project, graph);
    for (const [key, fn] of tsExportMap) {
      if (!exportMap.has(key)) exportMap.set(key, fn);
    }
    const tsImportMap = buildImportMapFromGraph(graph.project, graph);
    for (const [key, path] of tsImportMap) {
      if (!importMap.has(key)) importMap.set(key, path);
    }
    const tsAliasMap = buildImportAliasMap(graph.project, graph);
    for (const [key, exportedName] of tsAliasMap) {
      aliasMap.set(key, exportedName);
    }
  }

  // Also walk files that have no IR at all but are present in the graph.
  // These are the files we previously missed entirely.
  const iteratedFiles = new Set(inferredPerFile.keys());
  const extraFiles: Array<[string, SourceFile]> = [];
  if (graph?.project) {
    for (const gf of graph.files) {
      if (iteratedFiles.has(gf.path)) continue;
      if (!supportsTsMorphGraphFile(gf.path)) continue;
      const sf = graph.project.getSourceFile(gf.path);
      if (sf) extraFiles.push([gf.path, sf]);
    }
  }

  const results: CrossFileTaintResult[] = [];

  const analyzeCaller = (args: {
    filePath: string;
    fnName: string;
    paramsStr: string;
    code: string;
    startLine: number;
  }) => {
    const { filePath, fnName, paramsStr, code, startLine } = args;
    if (!code) return;

    const taintedParams = classifyParams(paramsStr);
    if (taintedParams.length === 0) return;

    const taintedVars = propagateTaint(code, taintedParams);
    const taintedNames = new Set(taintedVars.map((v) => v.name));

    const callRegex = /\b(\w+)\s*\(/g;
    let callMatch;
    while ((callMatch = callRegex.exec(code)) !== null) {
      const calledFn = callMatch[0].replace(/\s*\($/, '');

      const resolvedFile = importMap.get(`${filePath}::${calledFn}`);
      if (!resolvedFile) continue;

      // Resolve alias: if `calledFn` is a local name for an aliased import, use
      // the exported name for the export-map lookup.
      const exportedName = aliasMap.get(`${filePath}::${calledFn}`) ?? calledFn;
      const targetFn = exportMap.get(`${resolvedFile}::${exportedName}`);
      if (!targetFn?.hasSink) continue;

      const callStart = callMatch.index + callMatch[0].length;
      const parenEnd = findClosingParen(code, callStart);
      const argText = code.slice(callStart, parenEnd);

      const taintedArgs: string[] = [];
      for (const tName of taintedNames) {
        if (new RegExp(`\\b${tName}\\b`).test(argText)) taintedArgs.push(tName);
      }
      if (taintedArgs.length === 0) continue;

      const beforeCall = code.slice(0, callMatch.index);
      const foundSanitizers = detectSanitizers(beforeCall);
      const hasSanitizer = taintedArgs.some((arg) =>
        foundSanitizers.some((s) => new RegExp(`\\b${arg}\\b`).test(s.context)),
      );
      if (hasSanitizer) continue;

      for (const sink of targetFn.sinks) {
        const source = taintedVars.find((v) => taintedArgs.includes(v.name));
        if (!source) continue;
        results.push({
          callerFile: filePath,
          callerFn: fnName,
          callerLine: startLine,
          calleeFile: resolvedFile,
          calleeFn: exportedName,
          taintedArgs,
          sinkInCallee: sink,
          source,
        });
      }
    }
  };

  // IR-derived callers
  for (const [filePath, inferred] of inferredPerFile) {
    for (const r of inferred) {
      if (r.node.type !== 'fn') continue;
      const handler = r.node.children?.find((c) => c.type === 'handler');
      analyzeCaller({
        filePath,
        fnName: (r.node.props?.name as string) || 'anonymous',
        paramsStr: (r.node.props?.params as string) || '',
        code: (handler?.props?.code as string) || '',
        startLine: r.startLine,
      });
    }
  }

  // ts-morph-derived callers for files that were never KERN-inferred.
  const seenCallers = new Set<string>(); // dedup: filePath::fnName
  for (const [filePath, inferred] of inferredPerFile) {
    for (const r of inferred) {
      if (r.node.type !== 'fn') continue;
      const name = (r.node.props?.name as string) || '';
      if (name) seenCallers.add(`${filePath}::${name}`);
    }
  }
  for (const [filePath, sf] of extraFiles) {
    for (const [exportName, decls] of sf.getExportedDeclarations()) {
      if (seenCallers.has(`${filePath}::${exportName}`)) continue;
      for (const decl of decls) {
        const sig = collectFnSignature(decl);
        if (!sig) continue;
        analyzeCaller({
          filePath,
          fnName: exportName,
          paramsStr: sig.params,
          code: sig.code,
          startLine: decl.getStartLineNumber(),
        });
      }
    }
  }

  return results;
}
