import { parseDocumentWithDiagnostics } from './parser.js';
import type { ParseOptions } from './parser-core.js';
import { parseExpression } from './parser-expression.js';
import { moduleLinkErrors, ownExplicitExportKinds, type RunnerModuleExportRecord } from './runner-module-link.js';
import type { IRNode, ParseDiagnostic } from './types.js';
import type { ValueIR } from './value-ir.js';

export type CapabilityStatus = 'shipped' | 'planned';
export type CapabilitySyncBoundary = 'sync' | 'async-planned';
export type CapabilityInputShape = 'portable-literal' | 'host-bound';

export type CapabilityId =
  | 'app-http.queryParam'
  | 'crypto.randomBytes'
  | 'crypto.randomHex'
  | 'crypto.randomUUID'
  | 'fs.list'
  | 'fs.readText'
  | 'fs.writeText'
  | 'llm.complete'
  | 'net.fetch'
  | 'rag.answer'
  | 'rag.checkAnswer'
  | 'rag.ingest'
  | 'rag.promptContext'
  | 'rag.retrieve'
  | 'rag.retrieveAsync'
  | 'storage.clear'
  | 'storage.delete'
  | 'storage.get'
  | 'storage.has'
  | 'storage.keys'
  | 'storage.set';

const ASYNC_CAPABILITY_IDS = Object.freeze([
  'fs.list',
  'fs.readText',
  'fs.writeText',
  'llm.complete',
  'net.fetch',
  'rag.answer',
  'rag.ingest',
  'rag.retrieveAsync',
] as const satisfies readonly CapabilityId[]);

export type AsyncCapabilityId = (typeof ASYNC_CAPABILITY_IDS)[number];

export interface CapabilityDescriptor {
  readonly id: CapabilityId;
  readonly namespace: string;
  readonly operation: string;
  readonly status: CapabilityStatus;
  readonly syncBoundary: CapabilitySyncBoundary;
  readonly inputShape: CapabilityInputShape;
  readonly notes?: string;
}

export interface CapabilityRequirement {
  readonly id: CapabilityId;
  readonly namespace: string;
  readonly operation: string;
  readonly bindingName?: string;
  readonly literalInput?: string;
  readonly sourceLine: number;
  readonly descriptor: CapabilityDescriptor;
}

export interface UnknownCapabilityRequirement {
  readonly id: string;
  readonly namespace: string;
  readonly operation: string;
  readonly bindingName?: string;
  readonly literalInput?: string;
  readonly sourceLine: number;
}

export interface MalformedCapabilityRequirement {
  readonly namespace?: string;
  readonly operation?: string;
  readonly bindingName?: string;
  readonly literalInput?: string;
  readonly sourceLine: number;
  readonly reason: string;
}

export interface UnsupportedAsyncCapabilityRequirement extends CapabilityRequirement {
  readonly reason: 'outside-main' | 'unsupported';
}

export interface CapabilityAnalysisOptions {
  readonly parseOptions?: ParseOptions;
  readonly entryHandlerName?: string;
  readonly providedCapabilities?: readonly string[];
  readonly providedAsyncCapabilities?: readonly string[];
  readonly moduleLoader?: {
    resolve(specifier: string, context: { readonly importer: string }): string | null;
    readSource(canonicalPath: string): string;
  };
  readonly sourcePath?: string;
}

export interface CapabilityAnalysis {
  readonly requirements: readonly CapabilityRequirement[];
  readonly executableRequirements: readonly CapabilityRequirement[];
  readonly unknownCapabilities: readonly UnknownCapabilityRequirement[];
  readonly malformedCapabilities: readonly MalformedCapabilityRequirement[];
  readonly plannedCapabilities: readonly CapabilityRequirement[];
  readonly asyncPlannedCapabilities: readonly CapabilityRequirement[];
  readonly executableAsyncPlannedCapabilities: readonly CapabilityRequirement[];
  readonly missingProviders: readonly CapabilityRequirement[];
  readonly missingAsyncProviders: readonly CapabilityRequirement[];
  readonly unsupportedAsyncExecutions: readonly UnsupportedAsyncCapabilityRequirement[];
  readonly unknownProvidedCapabilities: readonly string[];
  readonly unknownProvidedAsyncCapabilities: readonly string[];
  readonly asyncBoundaryRequired: boolean;
  readonly hasParseErrors: boolean;
  readonly parseDiagnostics: readonly ParseDiagnostic[];
}

export const CAPABILITY_DESCRIPTORS = Object.freeze({
  'app-http.queryParam': capabilityDescriptor('app-http.queryParam', 'shipped', 'sync', 'host-bound'),
  'crypto.randomBytes': capabilityDescriptor('crypto.randomBytes', 'shipped', 'sync', 'portable-literal'),
  'crypto.randomHex': capabilityDescriptor('crypto.randomHex', 'shipped', 'sync', 'portable-literal'),
  'crypto.randomUUID': capabilityDescriptor('crypto.randomUUID', 'shipped', 'sync', 'portable-literal'),
  'fs.list': capabilityDescriptor('fs.list', 'planned', 'async-planned', 'host-bound'),
  'fs.readText': capabilityDescriptor('fs.readText', 'planned', 'async-planned', 'host-bound'),
  'fs.writeText': capabilityDescriptor('fs.writeText', 'planned', 'async-planned', 'host-bound'),
  'llm.complete': capabilityDescriptor('llm.complete', 'planned', 'async-planned', 'portable-literal'),
  'net.fetch': capabilityDescriptor('net.fetch', 'planned', 'async-planned', 'portable-literal'),
  'rag.answer': capabilityDescriptor('rag.answer', 'planned', 'async-planned', 'portable-literal'),
  'rag.checkAnswer': capabilityDescriptor('rag.checkAnswer', 'shipped', 'sync', 'portable-literal'),
  'rag.ingest': capabilityDescriptor('rag.ingest', 'planned', 'async-planned', 'host-bound'),
  'rag.promptContext': capabilityDescriptor('rag.promptContext', 'shipped', 'sync', 'portable-literal'),
  'rag.retrieve': capabilityDescriptor('rag.retrieve', 'shipped', 'sync', 'portable-literal'),
  'rag.retrieveAsync': capabilityDescriptor('rag.retrieveAsync', 'planned', 'async-planned', 'host-bound'),
  'storage.clear': capabilityDescriptor('storage.clear', 'shipped', 'sync', 'host-bound'),
  'storage.delete': capabilityDescriptor('storage.delete', 'shipped', 'sync', 'host-bound'),
  'storage.get': capabilityDescriptor('storage.get', 'shipped', 'sync', 'host-bound'),
  'storage.has': capabilityDescriptor('storage.has', 'shipped', 'sync', 'host-bound'),
  'storage.keys': capabilityDescriptor('storage.keys', 'shipped', 'sync', 'host-bound'),
  'storage.set': capabilityDescriptor('storage.set', 'shipped', 'sync', 'host-bound'),
} satisfies Record<CapabilityId, CapabilityDescriptor>);

const CAPABILITY_DESCRIPTOR_MAP: ReadonlyMap<string, CapabilityDescriptor> = new Map(
  Object.entries(CAPABILITY_DESCRIPTORS),
);
const ASYNC_CAPABILITY_DESCRIPTOR_MAP: ReadonlyMap<string, CapabilityDescriptor> = new Map(
  ASYNC_CAPABILITY_IDS.map((id) => [id, CAPABILITY_DESCRIPTORS[id]]),
);

export function analyzeKernSourceCapabilities(
  source: string,
  options: CapabilityAnalysisOptions = {},
): CapabilityAnalysis {
  const entryHandlerName = options.entryHandlerName ?? 'main';
  const rootPath = options.sourcePath ?? '<entry>';
  const graph = parseCapabilityGraph(source, options);
  const diagnostics = graph.diagnostics;
  const hasParseErrors =
    graph.roots.length === 0 ||
    graph.linkErrors.length > 0 ||
    diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const provided = options.providedCapabilities
    ? new Set(options.providedCapabilities.filter((id) => CAPABILITY_DESCRIPTOR_MAP.has(id)))
    : undefined;
  const providedAsync = options.providedAsyncCapabilities
    ? new Set(options.providedAsyncCapabilities.filter((id) => ASYNC_CAPABILITY_DESCRIPTOR_MAP.has(id)))
    : undefined;
  const unknownProvidedCapabilities = options.providedCapabilities
    ? options.providedCapabilities.filter((id) => !CAPABILITY_DESCRIPTOR_MAP.has(id))
    : [];
  const unknownProvidedAsyncCapabilities = options.providedAsyncCapabilities
    ? options.providedAsyncCapabilities.filter((id) => !ASYNC_CAPABILITY_DESCRIPTOR_MAP.has(id))
    : [];
  const requirements: CapabilityRequirement[] = [];
  const unknownCapabilities: UnknownCapabilityRequirement[] = [];
  const malformedCapabilities: MalformedCapabilityRequirement[] = [];

  for (const module of graph.roots) {
    for (const node of walkNodes(module.root)) {
      if (node.type !== 'capability') continue;
      const parsed = capabilityNodeRequirement(node);
      if ('reason' in parsed) {
        malformedCapabilities.push(parsed);
        continue;
      }
      const descriptor = CAPABILITY_DESCRIPTOR_MAP.get(parsed.id);
      if (!descriptor) {
        unknownCapabilities.push(parsed);
        continue;
      }
      requirements.push({ ...parsed, id: descriptor.id, descriptor });
    }
  }

  const asyncPlannedCapabilities = requirements.filter(
    (requirement) => requirement.descriptor.syncBoundary === 'async-planned',
  );
  // Executable-capability analysis walks the WHOLE linked module graph reachable
  // from the entry handler, not just the root file: a capability inside an
  // imported helper called from main must count exactly as if it lived in the
  // root file (finding: preflight readiness parity across module boundaries).
  const moduleRoots = graph.roots.map((module) => module.root);
  const unsupportedHandlers = new Set<IRNode>();
  const executableHandlers = crossModuleExecutableHandlers(
    graph,
    rootPath,
    entryHandlerName,
    unsupportedHandlers,
  );
  const executableRequirements = collectExecutableRequirements(moduleRoots, executableHandlers, requirements);
  const executableAsyncPlannedCapabilities = collectExecutableRequirements(
    moduleRoots,
    executableHandlers,
    asyncPlannedCapabilities,
  );
  return {
    requirements,
    executableRequirements,
    unknownCapabilities,
    malformedCapabilities,
    plannedCapabilities: requirements.filter((requirement) => requirement.descriptor.status === 'planned'),
    asyncPlannedCapabilities,
    executableAsyncPlannedCapabilities,
    missingProviders: provided
      ? executableRequirements.filter(
          (requirement) =>
            requirement.descriptor.status === 'shipped' &&
            requirement.descriptor.syncBoundary === 'sync' &&
            !provided.has(requirement.id),
        )
      : [],
    missingAsyncProviders: providedAsync
      ? executableAsyncPlannedCapabilities.filter(
          (requirement) =>
            requirement.descriptor.syncBoundary === 'async-planned' && !providedAsync.has(requirement.id),
        )
      : [],
    unsupportedAsyncExecutions: collectUnsupportedAsyncExecutionsAcrossModules(
      moduleRoots,
      executableHandlers,
      unsupportedHandlers,
      asyncPlannedCapabilities,
    ),
    unknownProvidedCapabilities,
    unknownProvidedAsyncCapabilities,
    asyncBoundaryRequired: executableAsyncPlannedCapabilities.length > 0,
    hasParseErrors,
    parseDiagnostics: [...diagnostics, ...graph.linkErrors],
  };
}

interface CapabilityGraphImport {
  readonly localName: string;
  readonly importedName: string;
  readonly kind?: string;
  readonly targetPath: string;
  readonly exportOnly: boolean;
}

interface CapabilityGraphModule {
  readonly path: string;
  readonly root: IRNode;
  readonly imports: readonly CapabilityGraphImport[];
  readonly ownExports: Map<string, RunnerModuleExportRecord>;
  readonly ownCallableNames: ReadonlySet<string>;
}

const PORTABLE_IMPORT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isPortableImportName(value: unknown): value is string {
  return typeof value === 'string' && PORTABLE_IMPORT_NAME.test(value);
}

function parseCapabilityGraph(
  source: string,
  options: CapabilityAnalysisOptions,
): {
  readonly roots: readonly CapabilityGraphModule[];
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly linkErrors: readonly ParseDiagnostic[];
} {
  const rootPath = options.sourcePath ?? '<entry>';
  const rootResult = parseDocumentWithDiagnostics(source, undefined, options.parseOptions);
  const diagnostics = [...rootResult.diagnostics];
  const linkErrors: ParseDiagnostic[] = [];
  const modules = new Map<string, CapabilityGraphModule>();
  const resolving = new Set<string>();
  const loader = options.moduleLoader;

  function linkError(message: string): void {
    linkErrors.push({
      code: 'INVALID_PROPAGATION',
      severity: 'error',
      message,
      line: 1,
      col: 1,
      endCol: 2,
      suggestion: 'Fix the module import graph before running capability preflight.',
      category: 'validator',
    });
  }

  // Resolve a module's export (own or re-exported) to its defining module and
  // canonical name, unifying export-set computation with the runtime linker so
  // preflight accepts exactly what the executor links (re-exports included).
  function resolveModuleExport(
    path: string,
    name: string,
    seen: Set<string>,
  ): (RunnerModuleExportRecord & { readonly path: string }) | undefined {
    const key = `${path} ${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const module = modules.get(path);
    if (!module) return undefined;
    const own = module.ownExports.get(name);
    if (own) return { ...own, path };
    const reexport = module.imports.find((imported) => imported.exportOnly && imported.localName === name);
    if (reexport && reexport.targetPath !== '') {
      return resolveModuleExport(reexport.targetPath, reexport.importedName, seen);
    }
    return undefined;
  }

  function collectImports(root: IRNode, path: string): CapabilityGraphImport[] {
    const imports: CapabilityGraphImport[] = [];
    const localNames = new Set<string>();
    for (const use of topLevelNodes(root)) {
      if (use.type !== 'use') continue;
      const rawPath = use.props?.path;
      if (typeof rawPath !== 'string' || rawPath.trim() === '') {
        linkError(moduleLinkErrors.useMissingPath(path));
        continue;
      }
      let targetPath = '';
      if (!loader) {
        linkError(moduleLinkErrors.cannotResolveNoLoader(rawPath, path));
      } else {
        const resolved = loader.resolve(rawPath, { importer: path });
        if (!resolved) linkError(moduleLinkErrors.cannotResolve(rawPath, path));
        else targetPath = resolved;
      }
      for (const child of use.children ?? []) {
        if (child.type !== 'from') continue;
        const importedName = child.props?.name;
        if (!isPortableImportName(importedName)) {
          linkError(moduleLinkErrors.importMissingName(rawPath, path));
          continue;
        }
        const aliasRaw = child.props?.as;
        const localName = typeof aliasRaw === 'string' && aliasRaw !== '' ? aliasRaw : importedName;
        if (!isPortableImportName(localName)) {
          linkError(moduleLinkErrors.aliasNotPortable(localName, path));
          continue;
        }
        const exportOnly = child.props?.export === true || child.props?.export === 'true';
        // export=true is ADDITIVE (local import AND re-export) — mirror the
        // executor: every import claims a local alias.
        if (localNames.has(localName)) {
          linkError(moduleLinkErrors.duplicateAlias(localName, path));
          continue;
        }
        localNames.add(localName);
        imports.push({
          localName,
          importedName,
          kind: typeof child.props?.kind === 'string' ? child.props.kind : undefined,
          targetPath,
          exportOnly,
        });
      }
    }
    return imports;
  }

  function ownCallableNames(root: IRNode): Set<string> {
    const names = new Set<string>();
    for (const node of topLevelNodes(root)) {
      if ((node.type === 'fn' && node.props?.name !== 'main') || node.type === 'class') {
        const name = node.props?.name;
        if (typeof name === 'string' && name !== '') names.add(name);
      }
    }
    return names;
  }

  function load(path: string, root: IRNode | undefined, imported: boolean): void {
    if (resolving.has(path)) {
      linkError(moduleLinkErrors.importCycle(path));
      return;
    }
    if (modules.has(path)) return;
    resolving.add(path);
    let moduleRoot = root;
    if (!moduleRoot) {
      if (!loader) {
        linkError(moduleLinkErrors.missingLoader(path));
        resolving.delete(path);
        return;
      }
      // Fail closed if a misbehaving loader hands back a non-string source: the
      // parser would otherwise crash with a raw TypeError instead of a diagnostic.
      const rawSource = loader.readSource(path);
      if (typeof rawSource !== 'string') {
        linkError(moduleLinkErrors.unreadableSource(path));
        resolving.delete(path);
        return;
      }
      const parsed = parseDocumentWithDiagnostics(rawSource, undefined, options.parseOptions);
      diagnostics.push(...parsed.diagnostics);
      moduleRoot = parsed.root;
    }
    // Defensive: never index into a null/undefined or non-document root.
    if (!moduleRoot || typeof (moduleRoot as { type?: unknown }).type !== 'string') {
      linkError(moduleLinkErrors.unreadableSource(path));
      resolving.delete(path);
      return;
    }
    if (imported && topLevelNodes(moduleRoot).some((node) => node.type === 'fn' && node.props?.name === 'main')) {
      linkError(moduleLinkErrors.importedMain(path));
    }
    const imports = collectImports(moduleRoot, path);
    const module: CapabilityGraphModule = {
      path,
      root: moduleRoot,
      imports,
      ownExports: ownExplicitExportKinds(moduleRoot),
      ownCallableNames: ownCallableNames(moduleRoot),
    };
    modules.set(path, module);
    const reexportLocals = new Set<string>();
    for (const imported of imports) {
      if (imported.targetPath !== '') load(imported.targetPath, undefined, true);
      const resolved =
        imported.targetPath !== ''
          ? resolveModuleExport(imported.targetPath, imported.importedName, new Set())
          : undefined;
      if (imported.targetPath !== '' && !resolved) {
        linkError(moduleLinkErrors.doesNotExport(imported.targetPath, imported.importedName, path));
        continue;
      }
      if (resolved && imported.kind && imported.kind !== resolved.kind) {
        linkError(moduleLinkErrors.kindMismatch(imported.importedName, imported.targetPath, imported.kind, resolved.kind));
        continue;
      }
      if (imported.exportOnly) {
        if (reexportLocals.has(imported.localName) || module.ownExports.has(imported.localName)) {
          linkError(moduleLinkErrors.duplicateExport(imported.localName, path));
        }
        reexportLocals.add(imported.localName);
      }
      // Additive export=true also binds locally, so alias conflicts apply to
      // every import, re-exporting or not — mirrors the executor.
      if (module.ownCallableNames.has(imported.localName)) {
        linkError(moduleLinkErrors.aliasConflicts(imported.localName, path));
      }
    }
    resolving.delete(path);
  }

  load(rootPath, rootResult.root, false);
  return { roots: [...modules.values()], diagnostics, linkErrors };
}

function topLevelNodes(root: IRNode): readonly IRNode[] {
  return root.type === 'document' ? (root.children ?? []) : [];
}

export const ASYNC_SOURCE_UNSUPPORTED_CONTAINER_TYPES: ReadonlySet<string> = new Set();

interface CapabilityModuleScope {
  readonly path: string;
  readonly root: IRNode;
  readonly importedFn: Map<string, { readonly path: string; readonly name: string }>;
  readonly importedClass: Map<string, { readonly path: string; readonly name: string }>;
}

function buildCapabilityModuleScopes(graph: {
  readonly roots: readonly CapabilityGraphModule[];
}): Map<string, CapabilityModuleScope> {
  const byPath = new Map(graph.roots.map((module) => [module.path, module]));
  const scopes = new Map<string, CapabilityModuleScope>();

  function resolveExport(
    path: string,
    name: string,
    seen: Set<string>,
  ): (RunnerModuleExportRecord & { readonly path: string }) | undefined {
    const key = `${path} ${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const module = byPath.get(path);
    if (!module) return undefined;
    const own = module.ownExports.get(name);
    if (own) return { ...own, path };
    const reexport = module.imports.find((imported) => imported.exportOnly && imported.localName === name);
    if (reexport && reexport.targetPath !== '') return resolveExport(reexport.targetPath, reexport.importedName, seen);
    return undefined;
  }

  for (const module of graph.roots) {
    const importedFn = new Map<string, { path: string; name: string }>();
    const importedClass = new Map<string, { path: string; name: string }>();
    for (const imported of module.imports) {
      // export=true imports are additive (locally bound AND re-exported), so
      // they resolve into the local scope exactly like plain imports.
      if (imported.targetPath === '') continue;
      const resolved = resolveExport(imported.targetPath, imported.importedName, new Set());
      if (!resolved) continue;
      if (resolved.kind === 'fn') importedFn.set(imported.localName, { path: resolved.path, name: resolved.sourceName });
      else importedClass.set(imported.localName, { path: resolved.path, name: resolved.sourceName });
    }
    scopes.set(module.path, { path: module.path, root: module.root, importedFn, importedClass });
  }
  return scopes;
}

/**
 * Executable handler nodes reachable from the entry handler ACROSS the linked
 * module graph. Within each module the existing single-file reachability walk is
 * reused unchanged; imported function calls jump to the defining module and the
 * walk continues there. Imported classes that are referenced are treated
 * fail-closed (all members marked executable + unsupported), since class-member
 * capabilities can never execute at runtime.
 */
function crossModuleExecutableHandlers(
  graph: { readonly roots: readonly CapabilityGraphModule[] },
  rootPath: string,
  entryHandlerName: string,
  unsupported: Set<IRNode>,
): ReadonlySet<IRNode> {
  const scopes = buildCapabilityModuleScopes(graph);
  const out = new Set<IRNode>();
  const visited = new Set<string>();
  const queue: { path: string; entry: string }[] = [{ path: rootPath, entry: entryHandlerName }];
  while (queue.length > 0) {
    const item = queue.pop();
    if (!item) continue;
    const key = `${item.path} ${item.entry}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const scope = scopes.get(item.path);
    if (!scope) continue;
    const localUnsupported = new Set<IRNode>();
    const localHandlers = findExecutableKernHandlers(scope.root, item.entry, localUnsupported);
    for (const handler of localHandlers) out.add(handler);
    for (const handler of localUnsupported) unsupported.add(handler);
    for (const handler of localHandlers) {
      for (const name of calledSymbolNames(handler)) {
        const importedFn = scope.importedFn.get(name);
        if (importedFn) queue.push({ path: importedFn.path, entry: importedFn.name });
        const importedClass = scope.importedClass.get(name);
        if (importedClass) enqueueImportedClassMembers(importedClass, scopes, out, unsupported);
      }
    }
  }
  return out;
}

function enqueueImportedClassMembers(
  ref: { readonly path: string; readonly name: string },
  scopes: ReadonlyMap<string, CapabilityModuleScope>,
  out: Set<IRNode>,
  unsupported: Set<IRNode>,
): void {
  const scope = scopes.get(ref.path);
  if (!scope) return;
  for (const node of topLevelNodes(scope.root)) {
    if (node.type !== 'class' || node.props?.name !== ref.name) continue;
    for (const member of node.children ?? []) {
      if (member.type !== 'method' && member.type !== 'getter' && member.type !== 'constructor') continue;
      const handler = previewHelperHandler(member);
      if (handler) {
        out.add(handler);
        unsupported.add(handler);
      }
    }
  }
}

function calledSymbolNames(handler: IRNode): Set<string> {
  const names = new Set<string>();
  for (const node of walkNodes(handler)) {
    for (const expr of supportedHelperCallExpressions(node)) {
      collectCalledSymbolNames(expr.node, names);
    }
  }
  return names;
}

function collectCalledSymbolNames(node: ValueIR, names: Set<string>): void {
  if (node.kind === 'call' && node.callee.kind === 'ident') names.add(node.callee.name);
  if (node.kind === 'new' && node.argument.kind === 'call' && node.argument.callee.kind === 'ident') {
    names.add(node.argument.callee.name);
  }
  for (const child of allValueChildren(node)) collectCalledSymbolNames(child, names);
}

function allValueChildren(node: ValueIR): readonly ValueIR[] {
  switch (node.kind) {
    case 'unary':
    case 'spread':
    case 'await':
    case 'new':
    case 'propagate':
      return [node.argument];
    case 'binary':
      return [node.left, node.right];
    case 'conditional':
      return [node.test, node.consequent, node.alternate];
    case 'member':
      return [node.object];
    case 'index':
      return [node.object, node.index];
    case 'call':
      return [node.callee, ...node.args];
    case 'typeAssert':
    case 'nonNull':
      return [node.expression];
    case 'tmplLit':
      return node.expressions;
    case 'arrayLit':
      return node.items.filter((item): item is ValueIR => Boolean(item));
    case 'objectLit':
      return node.entries.map((entry) => ('kind' in entry ? entry.argument : entry.value));
    default:
      return [];
  }
}

function collectExecutableRequirements(
  roots: readonly IRNode[],
  executableHandlers: ReadonlySet<IRNode>,
  requirements: readonly CapabilityRequirement[],
): CapabilityRequirement[] {
  if (requirements.length === 0) return [];
  const requirementsByLineAndId = requirementsByLine(requirements);
  const out: CapabilityRequirement[] = [];
  for (const root of roots) {
    collectExecutableAsyncRequirements(root, executableHandlers, false, requirementsByLineAndId, out);
  }
  return out;
}

function collectUnsupportedAsyncExecutionsAcrossModules(
  roots: readonly IRNode[],
  executableHandlers: ReadonlySet<IRNode>,
  unsupported: ReadonlySet<IRNode>,
  asyncRequirements: readonly CapabilityRequirement[],
): UnsupportedAsyncCapabilityRequirement[] {
  if (asyncRequirements.length === 0) return [];
  const requirementsByLineAndId = requirementsByLine(asyncRequirements);
  const out: UnsupportedAsyncCapabilityRequirement[] = [];
  for (const root of roots) {
    collectUnsupportedAsyncExecutions(
      root,
      executableHandlers,
      unsupported,
      false,
      undefined,
      requirementsByLineAndId,
      out,
    );
  }
  return out;
}

function requirementsByLine(
  requirements: readonly CapabilityRequirement[],
): Map<string, CapabilityRequirement[]> {
  const requirementsByLineAndId = new Map<string, CapabilityRequirement[]>();
  for (const requirement of requirements) {
    const key = `${requirement.sourceLine}:${requirement.id}`;
    const existing = requirementsByLineAndId.get(key);
    if (existing) existing.push(requirement);
    else requirementsByLineAndId.set(key, [requirement]);
  }
  return requirementsByLineAndId;
}

function collectUnsupportedAsyncExecutions(
  node: IRNode,
  exec: ReadonlySet<IRNode>,
  bad: ReadonlySet<IRNode>,
  inside: boolean,
  badNode: IRNode | undefined,
  byLine: Map<string, CapabilityRequirement[]>,
  out: UnsupportedAsyncCapabilityRequirement[],
): void {
  const nextInsideExecutableHandler = inside || exec.has(node);
  const nextUnsupportedContainer = exec.has(node) && bad.has(node) ? node : badNode;
  if (node.type === 'capability') {
    const requirement = asyncRequirementForNode(node, byLine);
    if (requirement) {
      if (!nextInsideExecutableHandler) {
        out.push({ ...requirement, reason: 'outside-main' });
      } else if (nextUnsupportedContainer) {
        out.push({
          ...requirement,
          reason: 'unsupported',
        });
      }
    }
  }
  for (const child of node.children ?? []) {
    collectUnsupportedAsyncExecutions(
      child,
      exec,
      bad,
      nextInsideExecutableHandler,
      nextUnsupportedContainer,
      byLine,
      out,
    );
  }
}

function collectExecutableAsyncRequirements(
  node: IRNode,
  executableHandlers: ReadonlySet<IRNode>,
  insideExecutableHandler: boolean,
  requirementsByLineAndId: Map<string, CapabilityRequirement[]>,
  out: CapabilityRequirement[],
): void {
  const nextInsideExecutableHandler = insideExecutableHandler || executableHandlers.has(node);
  if (node.type === 'capability' && nextInsideExecutableHandler) {
    const requirement = asyncRequirementForNode(node, requirementsByLineAndId);
    if (requirement) out.push(requirement);
  }
  for (const child of node.children ?? []) {
    collectExecutableAsyncRequirements(
      child,
      executableHandlers,
      nextInsideExecutableHandler,
      requirementsByLineAndId,
      out,
    );
  }
}

function asyncRequirementForNode(
  node: IRNode,
  requirementsByLineAndId: Map<string, CapabilityRequirement[]>,
): CapabilityRequirement | undefined {
  const namespace = stringProp(node, 'namespace');
  const operation = stringProp(node, 'operation');
  if (!namespace || !operation) return undefined;
  const key = `${node.loc?.line ?? -1}:${namespace}.${operation}`;
  return requirementsByLineAndId.get(key)?.shift();
}

function findExecutableKernHandlers(
  root: IRNode,
  entryHandlerName: string,
  unsupported = new Set<IRNode>(),
): ReadonlySet<IRNode> {
  const out = new Set<IRNode>();
  const helpers = new Map<string, IRNode>();
  const classMethods = new Map<string, IRNode[]>();
  const classMethodsByName = new Map<string, IRNode[]>();
  const classConstructors = new Map<string, IRNode>();
  const classExtends = new Map<string, string>();
  const classFieldInitializers = new Map<string, ValueIR[]>();
  let entryHandler: IRNode | undefined;

  for (const node of root.children ?? []) {
    if (node.type === 'fn') {
      const name = typeof node.props?.name === 'string' ? node.props.name : '';
      const handler = previewHelperHandler(node);
      if (!handler) continue;
      if (name === entryHandlerName) entryHandler = handler;
      else if (isPreviewHelperFunction(node, name)) helpers.set(name, handler);
      continue;
    }
    if (node.type === 'class') {
      const className = typeof node.props?.name === 'string' ? node.props.name : '';
      const extendsName = typeof node.props?.extends === 'string' ? node.props.extends : '';
      if (className && extendsName) classExtends.set(className, extendsName);
      for (const member of node.children ?? []) {
        if (member.type === 'field' && className && typeof member.props?.value === 'string' && member.props.value) {
          try {
            const existing = classFieldInitializers.get(className);
            const parsed = parseExpression(member.props.value);
            if (existing) existing.push(parsed);
            else classFieldInitializers.set(className, [parsed]);
          } catch {
            // Parser/runtime diagnostics own malformed expressions.
          }
          continue;
        }
        if (member.type === 'constructor') {
          const handler = previewHelperHandler(member);
          if (className && handler) classConstructors.set(className, handler);
          continue;
        }
        if (member.type !== 'method' && member.type !== 'getter') continue;
        const name = typeof member.props?.name === 'string' ? member.props.name : '';
        const handler = previewHelperHandler(member);
        if (!name || !handler) continue;
        if (className) {
          const key = `${className}.${name}`;
          const existing = classMethods.get(key);
          if (existing) existing.push(handler);
          else classMethods.set(key, [handler]);
        }
        const existingByName = classMethodsByName.get(name);
        if (existingByName) existingByName.push(handler);
        else classMethodsByName.set(name, [handler]);
      }
    }
  }
  if (!entryHandler) return out;

  out.add(entryHandler);
  const queued = calledExecutableHandlers(
    entryHandler.children ?? [],
    helpers,
    classMethods,
    classMethodsByName,
    classConstructors,
    classExtends,
    classFieldInitializers,
  );
  const visited = new Set<string>();
  while (queued.length > 0) {
    const item = queued.pop();
    if (!item || visited.has(item.key)) continue;
    visited.add(item.key);
    const handler = item.handler;
    if (!handler) continue;
    out.add(handler);
    if (item.u) unsupported.add(handler);
    queued.push(
      ...calledExecutableHandlers(
        handler.children ?? [],
        helpers,
        classMethods,
        classMethodsByName,
        classConstructors,
        classExtends,
        classFieldInitializers,
      ).map((ref) => (item.u ? { ...ref, u: true } : ref)),
    );
  }
  return out;
}

interface ExecutableHandlerRef {
  readonly key: string;
  readonly handler: IRNode;
  readonly u?: boolean;
}

function calledExecutableHandlers(
  nodes: readonly IRNode[],
  helpers: ReadonlyMap<string, IRNode>,
  classMethods: ReadonlyMap<string, readonly IRNode[]>,
  classMethodsByName: ReadonlyMap<string, readonly IRNode[]>,
  classConstructors: ReadonlyMap<string, IRNode>,
  classExtends: ReadonlyMap<string, string>,
  classFieldInitializers: ReadonlyMap<string, readonly ValueIR[]>,
): ExecutableHandlerRef[] {
  const helperNames = new Set<string>();
  const methodKeys = new Set<string>();
  const ambiguousMethodNames = new Set<string>();
  const constructorNames = new Set<string>();
  const unsupportedHelperNames = new Set<string>();
  const classBindings = new Map<string, string>();
  for (const node of walkNodes({ type: '__block', children: [...nodes] })) {
    recordClassBinding(node, classBindings, helpers);
    for (const expr of supportedHelperCallExpressions(node)) {
      collectHelperCalls(
        expr.node,
        helpers,
        helperNames,
        methodKeys,
        ambiguousMethodNames,
        constructorNames,
        classBindings,
        expr.mode,
      );
    }
  }
  const expandedConstructorNames = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const name of [...constructorNames]) {
      if (expandedConstructorNames.has(name)) continue;
      expandedConstructorNames.add(name);
      for (const className of classAncestry(name, classExtends)) {
        for (const initializer of classFieldInitializers.get(className) ?? []) {
          collectHelperCalls(
            initializer,
            helpers,
            unsupportedHelperNames,
            methodKeys,
            ambiguousMethodNames,
            constructorNames,
            classBindings,
            'scalar',
          );
        }
      }
      changed = true;
    }
  }
  const out: ExecutableHandlerRef[] = [];
  for (const name of helperNames) {
    const handler = helpers.get(name);
    if (handler) out.push({ key: `fn:${name}`, handler });
  }
  for (const name of unsupportedHelperNames) {
    const handler = helpers.get(name);
    if (handler) out.push({ key: `fn:${name}`, handler, u: true });
  }
  for (const key of methodKeys) {
    const [className, methodName] = key.split('.', 2);
    if (!className || !methodName) continue;
    const resolved = resolveClassMethodHandlers(className, methodName, classMethods, classExtends);
    for (const [index, handler] of resolved.entries()) {
      out.push({ key: `method:${key}:${index}`, handler, u: true });
    }
  }
  for (const name of ambiguousMethodNames) {
    for (const [index, handler] of (classMethodsByName.get(name) ?? []).entries()) {
      out.push({ key: `method:${name}:${index}`, handler, u: true });
    }
  }
  for (const name of constructorNames) {
    for (const className of classAncestry(name, classExtends)) {
      const handler = classConstructors.get(className);
      if (handler) out.push({ key: `constructor:${className}`, handler, u: true });
    }
  }
  return out;
}

const AMBIGUOUS_CLASS_BINDING = '*';

function resolveClassMethodHandlers(
  className: string,
  methodName: string,
  classMethods: ReadonlyMap<string, readonly IRNode[]>,
  classExtends: ReadonlyMap<string, string>,
): readonly IRNode[] {
  for (const current of classAncestry(className, classExtends)) {
    const handlers = classMethods.get(`${current}.${methodName}`);
    if (handlers && handlers.length > 0) return handlers;
  }
  return [];
}

function classAncestry(className: string, classExtends: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (
    let current: string | undefined = className;
    current && !seen.has(current);
    current = classExtends.get(current)
  ) {
    seen.add(current);
    out.push(current);
  }
  return out;
}

function recordClassBinding(
  node: IRNode,
  classBindings: Map<string, string>,
  helpers: ReadonlyMap<string, IRNode>,
): void {
  if (node.type !== 'let') return;
  const name = typeof node.props?.name === 'string' ? node.props.name : '';
  const rawValue = typeof node.props?.value === 'string' ? node.props.value : '';
  if (!name || !rawValue) return;
  try {
    const parsed = parseExpression(rawValue);
    if (parsed.kind === 'new' && parsed.argument.kind === 'call' && parsed.argument.callee.kind === 'ident') {
      recordClassName(classBindings, name, parsed.argument.callee.name);
    } else if (parsed.kind === 'call' && parsed.callee.kind === 'ident' && helpers.has(parsed.callee.name)) {
      recordClassName(classBindings, name, AMBIGUOUS_CLASS_BINDING);
    }
  } catch {
    // Parser/runtime diagnostics own malformed expressions.
  }
}

function recordClassName(classBindings: Map<string, string>, name: string, className: string): void {
  const existing = classBindings.get(name);
  if (!existing) {
    classBindings.set(name, className);
  } else if (existing !== className) {
    classBindings.set(name, AMBIGUOUS_CLASS_BINDING);
  }
}

type HelperCallExpressionMode = 'scalar' | 'let' | 'cap';

interface HelperCallExpression {
  readonly node: ValueIR;
  readonly mode: HelperCallExpressionMode;
}

function supportedHelperCallExpressions(node: IRNode): HelperCallExpression[] {
  const props = node.props ?? {};
  const out: HelperCallExpression[] = [];
  function add(raw: unknown, mode: HelperCallExpressionMode): void {
    if (typeof raw !== 'string' || raw.trim() === '') return;
    try {
      out.push({ node: parseExpression(raw), mode });
    } catch {
      // Ignore malformed expressions here; parser/runtime diagnostics own them.
    }
  }
  if (node.type === 'let') {
    add(props.value, 'let');
  } else if (node.type === 'capability') {
    add(props.input, 'cap');
  } else if (node.type === 'do') {
    add(props.value, 'scalar');
  } else if (
    node.type === 'assign' ||
    node.type === 'print' ||
    node.type === 'return' ||
    node.type === 'if' ||
    node.type === 'while'
  ) {
    add(node.type === 'if' || node.type === 'while' ? props.cond : props.value, 'scalar');
  } else if (node.type === 'fmt' && typeof props.template === 'string') {
    try {
      out.push({ node: parseExpression(`\`${props.template}\``), mode: 'scalar' });
    } catch {
      // Ignore malformed templates here; parser/runtime diagnostics own them.
    }
  }
  return out;
}

function collectHelperCalls(
  node: ValueIR,
  helpers: ReadonlyMap<string, IRNode>,
  helperNames: Set<string>,
  methodKeys: Set<string>,
  ambiguousMethodNames: Set<string>,
  constructorNames: Set<string>,
  classBindings: ReadonlyMap<string, string>,
  mode: HelperCallExpressionMode,
): void {
  if (node.kind === 'call' && node.callee.kind === 'ident' && helpers.has(node.callee.name)) {
    helperNames.add(node.callee.name);
  }
  if (node.kind === 'call' && node.callee.kind === 'member') {
    if (node.callee.object.kind === 'ident' && classBindings.has(node.callee.object.name)) {
      const className = classBindings.get(node.callee.object.name);
      if (className === AMBIGUOUS_CLASS_BINDING) {
        ambiguousMethodNames.add(node.callee.property);
      } else {
        methodKeys.add(`${className}.${node.callee.property}`);
      }
    } else {
      ambiguousMethodNames.add(node.callee.property);
    }
  }
  if (node.kind === 'new' && node.argument.kind === 'call' && node.argument.callee.kind === 'ident') {
    constructorNames.add(node.argument.callee.name);
  }
  if (node.kind === 'member') {
    if (node.object.kind === 'ident' && classBindings.has(node.object.name)) {
      const className = classBindings.get(node.object.name);
      if (className === AMBIGUOUS_CLASS_BINDING) {
        ambiguousMethodNames.add(node.property);
      } else {
        methodKeys.add(`${className}.${node.property}`);
      }
    } else if (
      node.object.kind === 'new' &&
      node.object.argument.kind === 'call' &&
      node.object.argument.callee.kind === 'ident'
    ) {
      methodKeys.add(`${node.object.argument.callee.name}.${node.property}`);
    }
  }
  for (const child of valueChildren(node, helpers, mode)) {
    collectHelperCalls(
      child.node,
      helpers,
      helperNames,
      methodKeys,
      ambiguousMethodNames,
      constructorNames,
      classBindings,
      child.mode,
    );
  }
}

function valueChildren(
  node: ValueIR,
  helpers: ReadonlyMap<string, IRNode>,
  mode: HelperCallExpressionMode,
): readonly HelperCallExpression[] {
  switch (node.kind) {
    case 'unary':
      return [{ node: node.argument, mode: 'scalar' }];
    case 'binary':
      return [
        { node: node.left, mode: 'scalar' },
        { node: node.right, mode: 'scalar' },
      ];
    case 'conditional':
      return [
        { node: node.test, mode: 'scalar' },
        { node: node.consequent, mode: 'scalar' },
        { node: node.alternate, mode: 'scalar' },
      ];
    case 'member':
      return [{ node: node.object, mode: 'scalar' }];
    case 'index':
      return [];
    case 'call':
      if (
        node.callee.kind === 'ident' &&
        (helpers.has(node.callee.name) || node.callee.name === 'String' || node.callee.name === 'super')
      ) {
        return node.args.map((arg) => ({ node: arg, mode: 'scalar' }));
      }
      if (node.callee.kind === 'member') {
        return [
          { node: node.callee.object, mode: 'scalar' },
          ...node.args.map((arg): HelperCallExpression => ({ node: arg, mode: 'scalar' })),
        ];
      }
      return [];
    case 'new':
      return node.argument.kind === 'call' ? node.argument.args.map((arg) => ({ node: arg, mode: 'scalar' })) : [];
    case 'typeAssert':
    case 'nonNull':
      return [{ node: node.expression, mode: 'scalar' }];
    case 'tmplLit':
      return node.expressions.map((expression) => ({ node: expression, mode: 'scalar' }));
    case 'arrayLit':
      if (mode === 'cap') {
        return node.items.filter((item): item is ValueIR => Boolean(item)).map((item) => ({ node: item, mode: 'cap' }));
      }
      if (mode === 'let') {
        return node.items
          .filter((item): item is ValueIR => Boolean(item))
          .map((item) => ({ node: item, mode: item.kind === 'arrayLit' ? 'let' : 'scalar' }));
      }
      return [];
    case 'objectLit':
      if (mode === 'cap') {
        return node.entries.flatMap((entry) => ('kind' in entry ? [] : [{ node: entry.value, mode }]));
      }
      if (mode === 'let') {
        return node.entries.flatMap((entry) =>
          'kind' in entry ? [] : [{ node: entry.value, mode: 'scalar' as const }],
        );
      }
      return [];
    default:
      return [];
  }
}

function isPreviewHelperFunction(fn: IRNode, name: string): boolean {
  return (
    isPortableHelperName(name) &&
    !isTrueProp(fn.props?.async) &&
    !isTrueProp(fn.props?.stream) &&
    fn.props?.returns !== undefined &&
    fn.props.returns !== '' &&
    fn.props.returns !== 'void' &&
    previewHelperParamsAreSupported(fn)
  );
}

function previewHelperHandler(fn: IRNode): IRNode | undefined {
  const handlers = (fn.children ?? []).filter((child) => child.type === 'handler' && child.props?.lang === 'kern');
  return handlers.length === 1 ? handlers[0] : undefined;
}

function isTrueProp(value: unknown): boolean {
  return value === true || value === 'true';
}

function isPortableHelperName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function previewHelperParamsAreSupported(fn: IRNode): boolean {
  const paramChildren = (fn.children ?? []).filter((child) => child.type === 'param');
  const legacyParams = typeof fn.props?.params === 'string' ? fn.props.params.trim() : '';
  if (paramChildren.length > 0 && legacyParams !== '') return false;
  const names =
    paramChildren.length > 0 ? previewParamChildNames(paramChildren) : previewLegacyParamNames(legacyParams);
  if (!names) return false;
  return new Set(names).size === names.length;
}

function previewParamChildNames(paramChildren: readonly IRNode[]): string[] | undefined {
  const names: string[] = [];
  for (const param of paramChildren) {
    const name = param.props?.name;
    if (!isPortableHelperName(name)) return undefined;
    if ((param.children ?? []).length > 0) return undefined;
    if (param.props?.value !== undefined || param.props?.default !== undefined) return undefined;
    if (isTrueProp(param.props?.optional) || isTrueProp(param.props?.variadic)) return undefined;
    names.push(name);
  }
  return names;
}

function previewLegacyParamNames(params: string): string[] | undefined {
  if (params === '') return [];
  const names: string[] = [];
  for (const part of params.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '' || trimmed.includes('=') || trimmed.startsWith('...') || trimmed.includes('?')) return undefined;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*[A-Za-z_][A-Za-z0-9_]*(?:\[\])?)?$/.exec(trimmed);
    if (!match) return undefined;
    names.push(match[1]);
  }
  return names;
}

function capabilityDescriptor(
  id: CapabilityId,
  status: CapabilityStatus,
  syncBoundary: CapabilitySyncBoundary,
  inputShape: CapabilityInputShape,
): CapabilityDescriptor {
  const parts = id.split('.');
  if (parts.length !== 2) {
    throw new Error(`bad id ${id}`);
  }
  const [namespace, operation] = parts;
  return Object.freeze({ id, namespace, operation, status, syncBoundary, inputShape });
}

function* walkNodes(root: IRNode): Generator<IRNode> {
  const stack: IRNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    yield node;
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
}

function capabilityNodeRequirement(node: IRNode): UnknownCapabilityRequirement | MalformedCapabilityRequirement {
  const namespace = capabilityTokenProp(node, 'namespace');
  const operation = capabilityTokenProp(node, 'operation');
  if (!namespace.value || !operation.value) {
    const issues = [namespace.issue, operation.issue].filter((issue): issue is string => Boolean(issue));
    return {
      ...(namespace.value ? { namespace: namespace.value } : {}),
      ...(operation.value ? { operation: operation.value } : {}),
      ...(stringProp(node, 'name') ? { bindingName: stringProp(node, 'name') } : {}),
      ...(stringProp(node, 'input') ? { literalInput: stringProp(node, 'input') } : {}),
      sourceLine: node.loc?.line ?? -1,
      reason: issues.length > 0 ? issues.join('; ') : 'capability nodes require namespace and operation properties',
    };
  }
  return {
    id: `${namespace.value}.${operation.value}`,
    namespace: namespace.value,
    operation: operation.value,
    ...(stringProp(node, 'name') ? { bindingName: stringProp(node, 'name') } : {}),
    ...(stringProp(node, 'input') ? { literalInput: stringProp(node, 'input') } : {}),
    sourceLine: node.loc?.line ?? -1,
  };
}

function stringProp(node: IRNode, key: string): string {
  const value = node.props?.[key];
  return typeof value === 'string' ? value : '';
}

function capabilityTokenProp(node: IRNode, key: 'namespace' | 'operation'): { value?: string; issue?: string } {
  const value = node.props?.[key];
  if (value === undefined) return { issue: `capability ${key} is required` };
  if (typeof value !== 'string') return { issue: `${key} must be string` };
  if (!isCapabilityToken(value)) return { issue: `bad cap ${key} '${value}'` };
  return { value };
}

function isCapabilityToken(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}
