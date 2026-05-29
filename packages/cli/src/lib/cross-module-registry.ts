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
const PYTHON_SNAKE_SYMBOL_KINDS = new Set(['fn', 'derive', 'transform', 'action', 'expect', 'dependency']);

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

interface ExportBinding {
  source: string;
  exported: string;
}

function parseExportBinding(raw: string): ExportBinding | null {
  const match = raw.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u);
  if (!match) return null;
  const source = match[1];
  return { source, exported: match[2] ?? source };
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function targetNamesForSymbol(name: string, kind: string): Record<string, string> {
  return {
    ts: name,
    python: PYTHON_SNAKE_SYMBOL_KINDS.has(kind) ? toSnakeCase(name) : name,
  };
}

function copyExportSymbol(target: ModuleExports, source: ModuleExports, name: string, exportedName = name): void {
  const symbol = source.symbols?.get(name);
  if (symbol) {
    const targetNames =
      exportedName === name ? symbol.targetNames : { ...symbol.targetNames, ts: exportedName, python: exportedName };
    target.symbols?.set(exportedName, {
      ...symbol,
      name: exportedName,
      sourceName: symbol.sourceName ?? name,
      targetNames,
    });
  }
  if (source.resultFns.has(name)) target.resultFns.add(exportedName);
  if (source.optionFns.has(name)) target.optionFns.add(exportedName);
  if (source.asyncResultFns?.has(name)) target.asyncResultFns?.add(exportedName);
  if (source.asyncOptionFns?.has(name)) target.asyncOptionFns?.add(exportedName);
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
      case 'repository':
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

  function walk(node: IRNode, nestedMember = false): void {
    const structuralContainer =
      node.type === 'class' ||
      node.type === 'service' ||
      node.type === 'interface' ||
      node.type === 'model' ||
      node.type === 'repository';
    const name = exportedName(node);
    const kind = symbolKind(node);
    if (!nestedMember && name && kind) {
      symbols.set(name, { name, sourceName: name, kind, targetNames: targetNamesForSymbol(name, kind) });
    }

    if (!nestedMember && (node.type === 'fn' || node.type === 'method')) {
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
    if (node.children) for (const c of node.children) walk(c, nestedMember || structuralContainer);
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
      for (const rawName of [...splitNames(node.props?.names), ...splitNames(node.props?.types)]) {
        const binding = parseExportBinding(rawName);
        if (binding) copyExportSymbol(base, source, binding.source, binding.exported);
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

// ── Shadow real-types: project-wide type-node index ──────────────────────────

/** Type-declaration kinds whose real shape the shadow analyzer can reproduce.
 *  Mirrors EMITTABLE_TYPE_NODES in shadow-analyzer.ts. */
const SHADOW_TYPE_KINDS = new Set(['interface', 'union', 'type']);

function collectTypeDecls(root: IRNode, out: Map<string, IRNode>): void {
  // Only top-level, exported type declarations are importable, so only those
  // can back a `use…from` reference. Nested types (declared inside a
  // class/service) and non-exported types can't be imported by name — indexing
  // them would let --shadow-real-types validate against a shape the generated
  // import can't actually access.
  const topLevel = SHADOW_TYPE_KINDS.has(root.type) ? [root] : (root.children ?? []);
  for (const node of topLevel) {
    if (!SHADOW_TYPE_KINDS.has(node.type)) continue;
    const props = node.props ?? {};
    if (props.export === 'false' || props.export === false) continue;
    const name = props.name;
    if (typeof name === 'string' && /^[A-Za-z_]\w*$/.test(name) && !out.has(name)) {
      out.set(name, node);
    }
  }
}

/** Index every emittable type declaration (interface/union/type) in each
 *  project file, keyed by absolute path → simple type name → IR node. Feeds
 *  the shadow analyzer's real-type emission so a `<<< >>>` fence that touches
 *  an imported domain type is checked against its true shape rather than an
 *  `any` stub. First declaration wins on a same-file name clash. Parse
 *  failures are skipped — the per-file compile surfaces its own diagnostics. */
export function buildProjectTypeNodeIndex(kernFiles: readonly string[]): Map<string, Map<string, IRNode>> {
  const index = new Map<string, Map<string, IRNode>>();
  for (const file of kernFiles) {
    try {
      const abs = resolve(file);
      const root = parseDocument(readFileSync(abs, 'utf-8'));
      const types = new Map<string, IRNode>();
      collectTypeDecls(root, types);
      index.set(abs, types);
    } catch {
      // Parse failures aren't an index concern — skip and let the per-file
      // compile surface its diagnostics.
    }
  }
  return index;
}

/** Resolve the emittable type declarations a file pulls in via `use path="…"`
 *  imports, keyed by the LOCAL name (honoring `from … as alias`). Direct
 *  imports only: a type reached through a re-export barrel isn't followed and
 *  degrades to an `any` stub in the shadow support file, which is safe — it
 *  weakens checking, never introduces a false positive. */
export function resolveImportedTypeNodesForFile(
  currentFileAbs: string,
  root: IRNode,
  typeIndex: Map<string, Map<string, IRNode>>,
): Map<string, IRNode> {
  const result = new Map<string, IRNode>();

  function walk(node: IRNode): void {
    const path = node.props?.path;
    if (node.type === 'use' && typeof path === 'string') {
      const targetAbs = resolveKernImportPath(currentFileAbs, path);
      const targetTypes = targetAbs ? typeIndex.get(targetAbs) : null;
      if (targetTypes) {
        for (const child of node.children ?? []) {
          if (child.type !== 'from') continue;
          const sourceName = child.props?.name;
          if (typeof sourceName !== 'string') continue;
          const typeNode = targetTypes.get(sourceName);
          if (!typeNode) continue;
          const aliasRaw = child.props?.as;
          const localName = typeof aliasRaw === 'string' && aliasRaw ? aliasRaw : sourceName;
          if (result.has(localName)) continue;
          // Under an alias the node must emit under the LOCAL name: the shadow
          // support file renders each node via its `props.name`, so an un-renamed
          // clone would emit `interface UserProfile` while the handler references
          // `Profile` → a spurious "Cannot find name 'Profile'". Clone with the
          // local name so the emitted declaration matches the key.
          const localNode =
            localName === sourceName
              ? typeNode
              : { ...typeNode, props: { ...(typeNode.props ?? {}), name: localName } };
          result.set(localName, localNode);
        }
      }
    }
    for (const child of node.children ?? []) walk(child);
  }

  walk(root);
  return result;
}
