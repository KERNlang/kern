import { parseDocumentWithDiagnostics } from './parser.js';
import type { ParseOptions } from './parser-core.js';
import {
  ASYNC_CAPABILITY_IDS,
  CAPABILITY_DESCRIPTORS,
  type CapabilityDescriptor,
  type CapabilityId,
} from './runner-capability-catalog.js';
import { linkedExecutableKernHandlers } from './runner-capability-linked-handlers.js';
import {
  collectExecutableRequirements,
  collectUnsupportedAsyncExecutionsAcrossModules,
} from './runner-capability-requirement-reachability.js';
import {
  type LinkedClassFrameAdmission,
  linkedClassFrameAdmission,
} from './runner-class-frame-capability-admission.js';
import { moduleLinkErrors, ownExplicitExportKinds, type RunnerModuleExportRecord } from './runner-module-link.js';
import { collectRunnerClasses, collectRunnerFunctions } from './runner-runtime-scope.js';
import type { IRNode, ParseDiagnostic } from './types.js';

export type {
  AsyncCapabilityId,
  CapabilityDescriptor,
  CapabilityId,
  CapabilityInputShape,
  CapabilityStatus,
  CapabilitySyncBoundary,
} from './runner-capability-catalog.js';
export { CAPABILITY_DESCRIPTORS } from './runner-capability-catalog.js';
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
  readonly iterationBudget?: number;
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
  const rootModule = graph.roots.find((module) => module.path === rootPath);
  const admission = rootModule
    ? capabilityLinkedAdmission(graph, rootModule, entryHandlerName, options.iterationBudget)
    : { ownsClassFrames: false };
  const executable = linkedExecutableKernHandlers(
    admission.entryHandler,
    admission.rootScope,
    admission.ownsClassFrames,
  );
  const executableHandlers = executable.handlers;
  const unsupportedHandlers = executable.unsupported;
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
    const key = `${path}\u0000${name}`;
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
        linkError(
          moduleLinkErrors.kindMismatch(imported.importedName, imported.targetPath, imported.kind, resolved.kind),
        );
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

function capabilityLinkedAdmission(
  graph: { readonly roots: readonly CapabilityGraphModule[] },
  rootModule: CapabilityGraphModule,
  entryName: string,
  iterationBudget: number | undefined,
): LinkedClassFrameAdmission {
  try {
    const records = graph.roots.map((module) => ({
      classes: collectRunnerClasses(module.root),
      exports: module.ownExports,
      functions: collectRunnerFunctions(module.root),
      imports: module.imports,
      path: module.path,
    }));
    return linkedClassFrameAdmission(records, rootModule.path, rootModule.root, entryName, iterationBudget);
  } catch {
    return { ownsClassFrames: false };
  }
}

export const ASYNC_SOURCE_UNSUPPORTED_CONTAINER_TYPES: ReadonlySet<string> = new Set();
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
