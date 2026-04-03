/**
 * Taint Tracking — cross-file analysis.
 *
 * Traces tainted data across import boundaries:
 *   handler(req) → importedFn(req.body) → exec() in another file.
 */

import type { InferResult } from './types.js';
import type { TaintSource, TaintSink, CrossFileTaintResult, ExportedFunction } from './taint-types.js';
import { classifyParams, propagateTaint, findTaintedSinks, findClosingParen, detectSanitizers } from './taint-regex.js';

// ── Export Map ───────────────────────────────────────────────────────────

/**
 * Build a map of exported functions across all files.
 * Maps "filePath::fnName" → ExportedFunction with sink info.
 */
export function buildExportMap(
  inferredPerFile: Map<string, InferResult[]>,
): Map<string, ExportedFunction> {
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
      const handler = r.node.children?.find(c => c.type === 'handler');
      const code = (handler?.props?.code as string) || '';

      // Check if the function body contains dangerous sinks
      const sinks: TaintSink[] = [];
      if (code) {
        const dummyTaint: TaintSource[] = [];
        // Parse params to get variable names for sink detection
        const paramNames = params.split(',').map(p => p.trim().split(':')[0]?.trim()).filter(Boolean);
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
  graphImports: Map<string, string[]>,  // filePath → [resolved import paths]
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
      const resolvedPath = resolvedImports.find(p =>
        p.includes(from.replace(/^\.\//, '').replace(/\.(js|ts|tsx)$/, ''))
      );
      if (!resolvedPath) continue;

      // Map each imported name to its resolved file
      if (names) {
        for (const name of names.split(',').map(n => n.trim())) {
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
): CrossFileTaintResult[] {
  const exportMap = buildExportMap(inferredPerFile);
  const importMap = buildImportMap(inferredPerFile, graphImports);
  const results: CrossFileTaintResult[] = [];

  for (const [filePath, inferred] of inferredPerFile) {
    for (const r of inferred) {
      if (r.node.type !== 'fn') continue;

      const fnName = (r.node.props?.name as string) || 'anonymous';
      const paramsStr = (r.node.props?.params as string) || '';
      const handler = r.node.children?.find(c => c.type === 'handler');
      const code = (handler?.props?.code as string) || '';
      if (!code) continue;

      // Only analyze functions with tainted params
      const taintedParams = classifyParams(paramsStr);
      if (taintedParams.length === 0) continue;

      const taintedVars = propagateTaint(code, taintedParams);
      const taintedNames = new Set(taintedVars.map(v => v.name));

      // Find calls to imported functions: importedFn(taintedVar)
      const callRegex = /\b(\w+)\s*\(/g;
      let callMatch;
      while ((callMatch = callRegex.exec(code)) !== null) {
        const calledFn = callMatch[0].replace(/\s*\($/, '');

        // Is this an imported function?
        const resolvedFile = importMap.get(`${filePath}::${calledFn}`);
        if (!resolvedFile) continue;

        // Does the target have dangerous sinks?
        const targetFn = exportMap.get(`${resolvedFile}::${calledFn}`);
        if (!targetFn || !targetFn.hasSink) continue;

        // Extract arguments passed to this call
        const callStart = callMatch.index + callMatch[0].length;
        const parenEnd = findClosingParen(code, callStart);
        const argText = code.slice(callStart, parenEnd);

        // Check if any tainted variable is passed as argument
        const taintedArgs: string[] = [];
        for (const tName of taintedNames) {
          if (new RegExp(`\\b${tName}\\b`).test(argText)) {
            taintedArgs.push(tName);
          }
        }

        if (taintedArgs.length === 0) continue;

        // Check for sanitizers between the taint and the call
        const beforeCall = code.slice(0, callMatch.index);
        const foundSanitizers = detectSanitizers(beforeCall);
        const hasSanitizer = taintedArgs.some(arg =>
          foundSanitizers.some(s =>
            new RegExp(`\\b${arg}\\b`).test(s.context)
          )
        );

        if (hasSanitizer) continue; // Sanitized before passing to callee

        // Found cross-file taint path
        for (const sink of targetFn.sinks) {
          const source = taintedVars.find(v => taintedArgs.includes(v.name));
          if (!source) continue;

          results.push({
            callerFile: filePath,
            callerFn: fnName,
            callerLine: r.startLine,
            calleeFile: resolvedFile,
            calleeFn: calledFn,
            taintedArgs,
            sinkInCallee: sink,
            source,
          });
        }
      }
    }
  }

  return results;
}
