/** Project-wide registry of exported KERN module metadata. Built once before
 *  the compile loop; consulted per-file via a
 *  caller-specific `ImportResolver` that resolves `use path="…"` strings
 *  against the current module's directory.
 *
 *  Scope: records exported symbol kinds for target-aware import lowering, and
 *  still indexes Result/Option-returning fns for `?` / `!` propagation. */

import {
  type ImportResolver,
  type IRNode,
  type ModuleExportSymbol,
  type ModuleExports,
  parseDocument,
} from '@kernlang/core';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';

const RESULT_RETURN_RE = /^Result<[\s\S]*>$/;
const OPTION_RETURN_RE = /^Option<[\s\S]*>$/;

/** Strip an outer `Promise<…>` wrapper if present. Mirrors the helper in
 *  `parser-validate-propagation.ts` so the registry classifies async
 *  exports the same way the propagation pass does. */
function unwrapPromise(s: string): { inner: string; wasPromise: boolean } {
  const t = s.trim();
  if (t.startsWith('Promise<') && t.endsWith('>')) {
    return { inner: t.slice('Promise<'.length, -1).trim(), wasPromise: true };
  }
  return { inner: t, wasPromise: false };
}

function emptyExports(): ModuleExports {
  return {
    symbols: new Map<string, ModuleExportSymbol>(),
    resultFns: new Set<string>(),
    optionFns: new Set<string>(),
    asyncResultFns: new Set<string>(),
    asyncOptionFns: new Set<string>(),
  };
}

function cloneExports(exports: ModuleExports): ModuleExports {
  return {
    symbols: new Map(exports.symbols ?? []),
    resultFns: new Set(exports.resultFns),
    optionFns: new Set(exports.optionFns),
    asyncResultFns: new Set(exports.asyncResultFns ?? []),
    asyncOptionFns: new Set(exports.asyncOptionFns ?? []),
  };
}

function copyExportSymbol(target: ModuleExports, source: ModuleExports, name: string): void {
  const symbol = source.symbols?.get(name);
  if (symbol) target.symbols?.set(name, symbol);
  if (source.resultFns.has(name)) target.resultFns.add(name);
  if (source.optionFns.has(name)) target.optionFns.add(name);
  if (source.asyncResultFns?.has(name)) target.asyncResultFns?.add(name);
  if (source.asyncOptionFns?.has(name)) target.asyncOptionFns?.add(name);
}

function mergeAllExports(target: ModuleExports, source: ModuleExports): void {
  for (const name of source.symbols?.keys() ?? []) {
    copyExportSymbol(target, source, name);
  }
}

function splitNames(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
}

function resolveKernImportPath(currentFileAbs: string, rawPath: string): string | null {
  if (!rawPath.startsWith('./') && !rawPath.startsWith('../')) return null;
  const withExt = rawPath.endsWith('.kern') ? rawPath : `${rawPath}.kern`;
  const abs = resolve(dirname(currentFileAbs), withExt);
  return existsSync(abs) ? abs : null;
}

function classifyDirectExports(root: IRNode): ModuleExports {
  const moduleExports = emptyExports();
  const symbols = new Map<string, ModuleExportSymbol>();

  function exportedName(node: IRNode): string | null {
    const props = node.props || {};
    const name = props.name;
    const exportProp = props.export;
    if (typeof name !== 'string' || exportProp === 'false' || exportProp === false) return null;
    return name;
  }

  function symbolKind(node: IRNode): string | null {
    switch (node.type) {
      case 'fn':
      case 'method':
        return 'fn';
      case 'type':
      case 'interface':
      case 'union':
      case 'enum':
      case 'class':
      case 'service':
      case 'model':
      case 'derive':
      case 'transform':
      case 'action':
      case 'expect':
      case 'dependency':
        return node.type;
      default:
        return null;
    }
  }

  function walk(node: IRNode): void {
    const name = exportedName(node);
    const kind = symbolKind(node);
    if (name && kind) {
      symbols.set(name, { name, kind });
    }

    if (node.type === 'fn' || node.type === 'method') {
      const props = node.props || {};
      const returns = props.returns;
      const isAsync = props.async === true || props.async === 'true';
      if (name && typeof returns === 'string') {
        const { inner, wasPromise } = unwrapPromise(returns);
        const effectivelyAsync = wasPromise || isAsync;
        if (RESULT_RETURN_RE.test(inner)) {
          (effectivelyAsync ? moduleExports.asyncResultFns : moduleExports.resultFns)?.add(name);
        } else if (OPTION_RETURN_RE.test(inner)) {
          (effectivelyAsync ? moduleExports.asyncOptionFns : moduleExports.optionFns)?.add(name);
        }
      }
    }
    if (node.children) for (const c of node.children) walk(c);
  }

  walk(root);
  moduleExports.symbols = symbols;
  return moduleExports;
}

function walkExportNodes(root: IRNode, visit: (node: IRNode) => void): void {
  if (root.type === 'export') visit(root);
  for (const child of root.children ?? []) {
    walkExportNodes(child, visit);
  }
}

function resolveExportsForFile(
  fileAbs: string,
  roots: Map<string, IRNode>,
  direct: Map<string, ModuleExports>,
  resolved: Map<string, ModuleExports>,
  resolving: Set<string>,
): ModuleExports {
  const cached = resolved.get(fileAbs);
  if (cached) return cached;

  const base = cloneExports(direct.get(fileAbs) ?? emptyExports());
  if (resolving.has(fileAbs)) return base;
  resolving.add(fileAbs);

  const root = roots.get(fileAbs);
  if (root) {
    walkExportNodes(root, (node) => {
      const from = node.props?.from;
      if (typeof from !== 'string') return;
      const targetAbs = resolveKernImportPath(fileAbs, from);
      if (!targetAbs || !roots.has(targetAbs)) return;
      const source = resolveExportsForFile(targetAbs, roots, direct, resolved, resolving);
      const star = node.props?.star === true || node.props?.star === 'true';
      if (star) {
        mergeAllExports(base, source);
      }
      for (const name of [...splitNames(node.props?.names), ...splitNames(node.props?.types)]) {
        copyExportSymbol(base, source, name);
      }
    });
  }

  resolving.delete(fileAbs);
  resolved.set(fileAbs, base);
  return base;
}

/** Walk every `.kern` file in the project once and produce a
 *  `Map<absoluteFilePath, ModuleExports>`. Files that fail to parse are
 *  skipped silently — their per-file compile will surface its own errors. */
export function buildCrossModuleRegistry(kernFiles: readonly string[]): Map<string, ModuleExports> {
  const roots = new Map<string, IRNode>();
  const direct = new Map<string, ModuleExports>();
  for (const file of kernFiles) {
    try {
      const abs = resolve(file);
      const source = readFileSync(abs, 'utf-8');
      const root = parseDocument(source);
      roots.set(abs, root);
      direct.set(abs, classifyDirectExports(root));
    } catch {
      // Parse failures aren't a registry concern — skip and let the
      // per-file compile surface its diagnostics.
    }
  }

  const registry = new Map<string, ModuleExports>();
  for (const abs of roots.keys()) {
    registry.set(abs, resolveExportsForFile(abs, roots, direct, registry, new Set()));
  }
  return registry;
}

/** Build a per-file `ImportResolver` that maps `use path="…"` strings to
 *  the corresponding `ModuleExports`. Resolves relative paths against the
 *  current file's directory and accepts both `./helper` and `./helper.kern`
 *  forms (preserving parity with KERN's import syntax). Bare imports
 *  (`zod`, `react`, …) and unresolvable paths return `null`, leaving the
 *  call to pass through propagation unchanged. */
export function makeImportResolverForFile(
  currentFileAbs: string,
  registry: Map<string, ModuleExports>,
): ImportResolver {
  return (path: string): ModuleExports | null => {
    const abs = resolveKernImportPath(currentFileAbs, path);
    if (!abs) return null;
    return registry.get(abs) ?? null;
  };
}
