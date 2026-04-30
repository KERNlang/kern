/** Slice 7 v2 — project-wide registry of exported Result/Option-returning
 *  fns. Built once before the compile loop; consulted per-file via a
 *  caller-specific `ImportResolver` that resolves `use path="…"` strings
 *  against the current module's directory.
 *
 *  Scope: the registry only indexes fns whose `returns` is exactly
 *  `Result<…>` or `Option<…>` (the same shape `parser-validate-propagation`
 *  classifies as `result`/`option`). Imports of any other return shape
 *  contribute nothing — the propagation pass leaves those calls alone. */

import { type ImportResolver, type IRNode, type ModuleExports, parseDocument } from '@kernlang/core';
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

function classifyExports(root: IRNode): ModuleExports {
  const resultFns = new Set<string>();
  const optionFns = new Set<string>();
  const asyncResultFns = new Set<string>();
  const asyncOptionFns = new Set<string>();

  function walk(node: IRNode): void {
    if (node.type === 'fn' || node.type === 'method') {
      const props = node.props || {};
      const name = typeof props.name === 'string' ? props.name : null;
      const returns = props.returns;
      // KERN fns are exported by default; `export=false` opts out. Only
      // exported names contribute to cross-module recognition.
      const exportProp = props.export;
      const isExported = !(exportProp === 'false' || exportProp === false);
      const isAsync = props.async === true || props.async === 'true';
      if (name && isExported && typeof returns === 'string') {
        const { inner, wasPromise } = unwrapPromise(returns);
        const effectivelyAsync = wasPromise || isAsync;
        if (RESULT_RETURN_RE.test(inner)) {
          (effectivelyAsync ? asyncResultFns : resultFns).add(name);
        } else if (OPTION_RETURN_RE.test(inner)) {
          (effectivelyAsync ? asyncOptionFns : optionFns).add(name);
        }
      }
    }
    if (node.children) for (const c of node.children) walk(c);
  }

  walk(root);
  return { resultFns, optionFns, asyncResultFns, asyncOptionFns };
}

/** Walk every `.kern` file in the project once and produce a
 *  `Map<absoluteFilePath, ModuleExports>`. Files that fail to parse are
 *  skipped silently — their per-file compile will surface its own errors. */
export function buildCrossModuleRegistry(kernFiles: readonly string[]): Map<string, ModuleExports> {
  const registry = new Map<string, ModuleExports>();
  for (const file of kernFiles) {
    try {
      const abs = resolve(file);
      const source = readFileSync(abs, 'utf-8');
      const root = parseDocument(source);
      registry.set(abs, classifyExports(root));
    } catch {
      // Parse failures aren't a registry concern — skip and let the
      // per-file compile surface its diagnostics.
    }
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
  const dir = dirname(currentFileAbs);
  return (path: string): ModuleExports | null => {
    if (!path.startsWith('./') && !path.startsWith('../')) return null;
    const withExt = path.endsWith('.kern') ? path : `${path}.kern`;
    const abs = resolve(dir, withExt);
    if (!existsSync(abs)) return null;
    return registry.get(abs) ?? null;
  };
}
