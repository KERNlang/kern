import { asyncReferenceRunSequence } from './ir/semantics/async-reference-runner.js';
import {
  CONTRACT_REGISTRY,
  makeEnv,
  ReferenceRunnerError,
  type RunnerClassBinding,
  type RunnerClassFieldBinding,
  type RunnerClassMemberBinding,
  type RunnerFunctionBinding,
  type RunnerModuleScope,
  referenceRunSequence,
  registerAllContracts,
  type SemanticEnv,
} from './ir/semantics/index.js';
import { isPortableBindingName } from './ir/semantics/portable-scalar.js';
import { resetAllContractRegistration } from './ir/semantics/register-all.js';
import { moduleLinkErrors } from './runner-module-link.js';
import { parseDocumentWithDiagnostics } from './parser.js';
import type { ParseOptions } from './parser-core.js';
import { parseExpression } from './parser-expression.js';
import type {
  KernRunnerAsyncCapabilities,
  KernRunnerCapabilities,
  KernRunnerCapabilityContext,
} from './runner-capabilities.js';
import {
  ASYNC_SOURCE_UNSUPPORTED_CONTAINER_TYPES,
  analyzeKernSourceCapabilities,
  CAPABILITY_DESCRIPTORS,
  type CapabilityRequirement,
  type MalformedCapabilityRequirement,
  type UnknownCapabilityRequirement,
} from './runner-capability-plan.js';
import type { IRNode } from './types.js';
import type { ValueIR } from './value-ir.js';

export type {
  AsyncCapabilityId,
  CapabilityAnalysis,
  CapabilityAnalysisOptions,
  CapabilityDescriptor,
  CapabilityId,
  CapabilityInputShape,
  CapabilityRequirement,
  CapabilityStatus,
  CapabilitySyncBoundary,
  MalformedCapabilityRequirement,
  UnknownCapabilityRequirement,
  UnsupportedAsyncCapabilityRequirement,
} from './runner-capability-plan.js';
export { analyzeKernSourceCapabilities, CAPABILITY_DESCRIPTORS } from './runner-capability-plan.js';
export type { WebCryptoCapabilityOptions, WebCryptoCapabilitySource } from './runner-crypto.js';
export { createWebCryptoCapability } from './runner-crypto.js';
export type { MemoryStorageCapabilityOptions } from './runner-storage.js';
export { createMemoryStorageCapability } from './runner-storage.js';

/**
 * `@kernlang/core/runner` — the GUARANTEED typescript-free standalone runtime entry.
 *
 * This is the first-class executor surface for "KERN runs on its own": the
 * tree-walking ReferenceRunner plus the lazy expression parser the runner calls
 * at eval time, and nothing else. Its STATIC import closure has `decimal.js` as
 * its ONLY external dependency and ZERO `typescript` — pinned by
 * `tests/runner-entry-import-graph.test.ts` (the anti-rot gate).
 *
 * Why a dedicated entry: importing from the `.` barrel (`@kernlang/core`) loads
 * the whole module graph, which still includes Node-only TS-backed codegen and
 * the differential-test harness, dragging in the ~10MB TS compiler. A browser /
 * edge / embedded consumer imports from HERE instead and pays none of that.
 *
 * Usage:
 *   import { executeKernSource, registerAllContracts, referenceRun, makeEnv } from '@kernlang/core/runner';
 *   const stdout = executeKernSource(source);     // parse + execute one .kern program
 *   registerAllContracts();                       // for direct IR execution setup
 *   const trace = referenceRun(node, makeEnv());  // execute one IR node
 *
 * The differential harness (`runDifferential`, etc.) is INTENTIONALLY absent —
 * it is test-only and lives behind `@kernlang/core/testing`.
 */

/** Controlled program-runner failure: parse/setup/runtime abstention, never a raw stack. */
export class KernRunnerError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = 'KernRunnerError';
    this.exitCode = exitCode;
  }
}

export interface ExecuteKernSourceOptions {
  /**
   * Optional parser capabilities. Browser/embedded callers normally omit this;
   * Node tooling can inject TypeScript-backed classifiers without making this
   * runner entry statically depend on TypeScript.
   */
  parseOptions?: ParseOptions;
  /** Optional initial environment; cloned by `makeEnv` before execution. */
  env?: Partial<SemanticEnv>;
  /**
   * Explicit host capabilities. The browser runner never reads host globals;
   * operations such as `capability namespace=rag operation=retrieve` must be
   * provided here or they fail closed.
   */
  capabilities?: KernRunnerCapabilities;
  /** Opaque metadata passed to injected capability handlers. */
  capabilityContext?: KernRunnerCapabilityContext;
  /**
   * Browser-safe module loading hooks for `use path="..."` linking. Callers
   * decide how paths are canonicalized and contained; the runner memoizes by
   * the canonical id returned here and never imports Node filesystem APIs.
   */
  moduleLoader?: KernRunnerModuleLoader;
  /** Canonical id for the root source when moduleLoader is enabled. */
  sourcePath?: string;
}

export interface ExecuteKernSourceAsyncOptions extends ExecuteKernSourceOptions {
  /**
   * Capability provider ids the host intends to make available to the sync
   * executor. When supplied, async source preflight reports missing shipped sync
   * providers before delegating to executeKernSource. This is an explicit id
   * list because handler maps can expose namespace-level functions whose
   * operation coverage cannot be inferred safely.
   */
  providedCapabilities?: readonly string[];
  /**
   * Async provider ids the host intends to wire at the async boundary. These do
   * not imply broad async control-flow support; they enable the narrow
   * executeKernSourceAsync preview lane and keep missing-provider diagnostics
   * separate from runtime async dispatch failures.
   */
  providedAsyncCapabilities?: readonly string[];
  /**
   * Async host adapter surface used by executeKernSourceAsync for straight-line
   * statements, the matched arm of if/else, selected branch paths, structured
   * try/catch/finally, and sequential while/for/each loop bodies. Broader async
   * control flow remains fail-closed.
   */
  asyncCapabilities?: KernRunnerAsyncCapabilities;
  /**
   * Per-call timeout for async capability provider invocations, in
   * milliseconds. Host-configurable; a provider that has not settled within
   * this window fails closed rather than hanging the run. Defaults to
   * {@link DEFAULT_ASYNC_CAPABILITY_TIMEOUT_MS} when omitted.
   */
  capabilityTimeoutMs?: number;
}

export interface KernRunnerEntryDescriptor {
  readonly handler: string;
  readonly label?: string;
  readonly kind?: string;
  readonly name?: string;
}

export interface ExecuteKernEntrySourceOptions extends ExecuteKernSourceOptions {}

export interface ExecuteKernEntrySourceAsyncOptions extends ExecuteKernSourceAsyncOptions {}

export interface KernRunnerModuleLoader {
  resolve(specifier: string, context: { readonly importer: string }): string | null;
  readSource(canonicalPath: string): string;
}

interface LinkedModuleRecord {
  readonly path: string;
  readonly root: IRNode;
  readonly functions: ReadonlyMap<string, RunnerFunctionBinding>;
  readonly classes: ReadonlyMap<string, RunnerClassBinding>;
  readonly exports: ReadonlyMap<string, RunnerLinkedExport>;
  readonly imports: readonly RunnerLinkedImport[];
}

type RunnerLinkedExport =
  | { readonly kind: 'fn'; readonly sourceName: string; readonly binding: RunnerFunctionBinding }
  | { readonly kind: 'class'; readonly sourceName: string; readonly binding: RunnerClassBinding };

interface RunnerLinkedImport {
  readonly localName: string;
  readonly importedName: string;
  readonly kind?: string;
  readonly targetPath: string;
  readonly exportOnly: boolean;
}

const REQUIRED_RUNNER_CONTRACTS = [
  'assign',
  'branch',
  'capability',
  'do',
  'each',
  'expression-v1',
  'fmt',
  'for',
  'if',
  'lambda',
  'let',
  'print',
  'return',
  'throw',
  'try',
  'while',
] as const;
const REQUIRED_RUNNER_CONTRACT_SET = new Set<string>(REQUIRED_RUNNER_CONTRACTS);

function runnerContractsRegistered(): boolean {
  return REQUIRED_RUNNER_CONTRACTS.every((type) => CONTRACT_REGISTRY.has(type));
}

function rebuildRunnerContracts(): void {
  const extraContracts = Array.from(CONTRACT_REGISTRY.entries()).filter(
    ([type]) => !REQUIRED_RUNNER_CONTRACT_SET.has(type),
  );
  CONTRACT_REGISTRY.clear();
  resetAllContractRegistration();
  registerAllContracts();
  for (const [type, contract] of extraContracts) {
    if (!CONTRACT_REGISTRY.has(type)) CONTRACT_REGISTRY.set(type, contract);
  }
}

function ensureRunnerContractsRegistered(): void {
  if (runnerContractsRegistered()) return;
  let registrationError: unknown;
  try {
    registerAllContracts();
  } catch (error) {
    registrationError = error;
  }
  if (runnerContractsRegistered()) return;
  try {
    rebuildRunnerContracts();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new KernRunnerError(`runner contract registry is partially initialized: ${reason}`);
  }
  if (runnerContractsRegistered()) return;
  const reason = registrationError instanceof Error ? `: ${registrationError.message}` : '';
  throw new KernRunnerError(`runner contract registry is partially initialized${reason}`);
}

function topLevelNodes(root: IRNode): readonly IRNode[] {
  return root.type === 'document' ? (root.children ?? []) : [];
}

function resolveSingleKernHandler(fn: IRNode, label: string): IRNode {
  const handlers = (fn.children ?? []).filter((node) => node.type === 'handler' && node.props?.lang === 'kern');
  if (handlers.length !== 1) throw new KernRunnerError(`${label} must contain exactly one handler lang="kern"`);
  return handlers[0];
}

function singleKernHandler(fn: IRNode): IRNode | undefined {
  const handlers = (fn.children ?? []).filter((node) => node.type === 'handler' && node.props?.lang === 'kern');
  return handlers.length === 1 ? handlers[0] : undefined;
}

function isTrueProp(value: unknown): boolean {
  return value === true || value === 'true';
}

function entryLabel(entry: KernRunnerEntryDescriptor): string {
  if (entry.label) return entry.label;
  if (entry.kind && entry.name) return `${entry.kind} ${entry.name}`;
  return `entry ${entry.handler}`;
}

function assertVoidRunnerEntry(fn: IRNode, handlerName: string, label: string, mainMode: boolean): void {
  const messagePrefix = mainMode ? 'main' : `${label} handler ${handlerName}`;
  if (fn.props?.returns !== 'void') throw new KernRunnerError(`${messagePrefix} must declare returns=void`);
  if (typeof fn.props?.params === 'string' && fn.props.params.trim() !== '') {
    throw new KernRunnerError(`${messagePrefix} parameters are unsupported in native runner preview`);
  }
  if ((fn.children ?? []).some((node) => node.type === 'param')) {
    throw new KernRunnerError(`${messagePrefix} parameters are unsupported in native runner preview`);
  }
  if (isTrueProp(fn.props?.async))
    throw new KernRunnerError(`${messagePrefix} async is unsupported in native runner preview`);
  if (isTrueProp(fn.props?.stream)) {
    throw new KernRunnerError(`${messagePrefix} stream=true is unsupported in native runner preview`);
  }
}

function resolveNamedVoidKernHandler(root: IRNode, handlerName: string, label: string, mainMode = false): IRNode {
  const topLevel = topLevelNodes(root);
  const matches = topLevel.filter((node) => node.type === 'fn' && node.props?.name === handlerName);

  if (matches.length === 0) {
    throw new KernRunnerError(
      mainMode ? 'expected exactly one top-level fn name=main' : `${label} references missing handler ${handlerName}`,
    );
  }
  if (matches.length > 1) {
    throw new KernRunnerError(
      mainMode ? 'found multiple top-level fn name=main' : `${label} references duplicate handler ${handlerName}`,
    );
  }

  const entry = matches[0];
  assertVoidRunnerEntry(entry, handlerName, label, mainMode);
  return resolveSingleKernHandler(entry, mainMode ? 'main' : `${label} handler ${handlerName}`);
}

/** Strict native-runner entry resolution: exactly one top-level `fn main` with one KERN handler. */
export function resolveKernMainHandler(root: IRNode): IRNode {
  return resolveNamedVoidKernHandler(root, 'main', 'main', true);
}

/** Descriptor-driven native-runner entry resolution: exactly one declared top-level handler. */
export function resolveKernEntryHandler(root: IRNode, entry: KernRunnerEntryDescriptor): IRNode {
  return resolveNamedVoidKernHandler(root, entry.handler, entryLabel(entry));
}

function collectRunnerFunctions(root: IRNode): Map<string, RunnerFunctionBinding> {
  const functions = new Map<string, RunnerFunctionBinding>();
  for (const node of topLevelNodes(root)) {
    if (node.type !== 'fn' || node.props?.name === 'main') continue;
    const binding = runnerFunctionBinding(node);
    if (!binding) continue;
    if (functions.has(binding.name)) throw new KernRunnerError(`duplicate runner function '${binding.name}'`);
    functions.set(binding.name, binding);
  }
  return functions;
}

function collectRunnerClasses(root: IRNode): Map<string, RunnerClassBinding> {
  const classes = new Map<string, RunnerClassBinding>();
  for (const node of topLevelNodes(root)) {
    if (node.type !== 'class') continue;
    const binding = runnerClassBinding(node);
    if (!binding) continue;
    if (classes.has(binding.name)) throw new KernRunnerError(`duplicate runner class '${binding.name}'`);
    classes.set(binding.name, binding);
  }
  for (const cls of classes.values()) {
    if (cls.extendsName && !classes.has(cls.extendsName)) {
      throw new KernRunnerError(`runner class '${cls.name}' extends unknown class '${cls.extendsName}'`);
    }
  }
  assertRunnerClassAcyclic(classes);
  return classes;
}

function assertRunnerClassAcyclic(classes: ReadonlyMap<string, RunnerClassBinding>): void {
  for (const cls of classes.values()) {
    const seen = new Set<string>();
    for (let current: string | undefined = cls.name; current; ) {
      if (seen.has(current)) throw new KernRunnerError(`runner class '${cls.name}' has cyclic inheritance`);
      seen.add(current);
      current = classes.get(current)?.extendsName;
    }
  }
}

function validateRunnerCallableNames(
  runnerFunctions: ReadonlyMap<string, RunnerFunctionBinding>,
  runnerClasses: ReadonlyMap<string, RunnerClassBinding>,
): void {
  if (runnerClasses.has('main')) throw new KernRunnerError("runner class 'main' conflicts with the native entrypoint");
  for (const name of runnerClasses.keys()) {
    if (runnerFunctions.has(name)) {
      throw new KernRunnerError(`runner class '${name}' conflicts with runner function '${name}'`);
    }
  }
}

function modulePathForRoot(options: ExecuteKernSourceOptions): string {
  return options.sourcePath ?? '<entry>';
}

function parseRunnerModule(path: string, source: string, options: ExecuteKernSourceOptions): IRNode {
  const { root, diagnostics } = parseDocumentWithDiagnostics(source, undefined, options.parseOptions);
  const firstError = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (firstError) throw new KernRunnerError(`${path}: ${firstError.message}`);
  return root;
}

function importedMainError(path: string): KernRunnerError {
  return new KernRunnerError(`link error: imported module '${path}' must not declare fn main`);
}

function assertNoMainInImportedModule(root: IRNode, path: string): void {
  if (topLevelNodes(root).some((node) => node.type === 'fn' && node.props?.name === 'main')) {
    throw importedMainError(path);
  }
}

function collectExplicitRunnerExports(
  functions: ReadonlyMap<string, RunnerFunctionBinding>,
  classes: ReadonlyMap<string, RunnerClassBinding>,
  root: IRNode,
  path: string,
): Map<string, RunnerLinkedExport> {
  const exports = new Map<string, RunnerLinkedExport>();
  for (const node of topLevelNodes(root)) {
    if (!isTrueProp(node.props?.export)) continue;
    const name = node.props?.name;
    if (!isPortableBindingName(name)) continue;
    if (node.type === 'fn') {
      const binding = functions.get(name);
      if (!binding) {
        throw new KernRunnerError(
          `link error: exported function '${name}' in '${path}' is unsupported by the native runner`,
        );
      }
      exports.set(name, { kind: 'fn', sourceName: name, binding });
    } else if (node.type === 'class') {
      const binding = classes.get(name);
      if (!binding) {
        throw new KernRunnerError(
          `link error: exported class '${name}' in '${path}' is unsupported by the native runner`,
        );
      }
      exports.set(name, { kind: 'class', sourceName: name, binding });
    }
  }
  return exports;
}

function collectUseImports(root: IRNode, importerPath: string, loader: KernRunnerModuleLoader): RunnerLinkedImport[] {
  const imports: RunnerLinkedImport[] = [];
  const localNames = new Set<string>();
  for (const node of topLevelNodes(root)) {
    if (node.type !== 'use') continue;
    const rawPath = node.props?.path;
    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
      throw new KernRunnerError(`link error: use in '${importerPath}' must declare path=`);
    }
    const targetPath = loader.resolve(rawPath, { importer: importerPath });
    if (!targetPath) throw new KernRunnerError(`link error: cannot resolve import '${rawPath}' from '${importerPath}'`);
    for (const child of node.children ?? []) {
      if (child.type !== 'from') continue;
      const importedName = child.props?.name;
      if (!isPortableBindingName(importedName)) {
        throw new KernRunnerError(`link error: import from '${rawPath}' in '${importerPath}' must declare name=`);
      }
      const localNameRaw = child.props?.as;
      const localName = typeof localNameRaw === 'string' && localNameRaw !== '' ? localNameRaw : importedName;
      if (!isPortableBindingName(localName)) {
        throw new KernRunnerError(`link error: import alias '${localName}' in '${importerPath}' is not portable`);
      }
      const exportOnly = isTrueProp(child.props?.export);
      // export=true on `from` is ADDITIVE (import locally AND re-export),
      // matching the codegen legs, which emit both an import line and an
      // `export … from` line. Every import therefore claims a local alias.
      if (localNames.has(localName)) {
        throw new KernRunnerError(`link error: duplicate imported alias '${localName}' in '${importerPath}'`);
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

function linkRunnerModules(source: string, options: ExecuteKernSourceOptions): LinkedModuleRecord[] {
  const loader = options.moduleLoader;
  const rootPath = modulePathForRoot(options);
  const root = parseRunnerModule(rootPath, source, options);
  if (!loader) return [linkSingleModule(rootPath, root, [])];

  const records = new Map<string, LinkedModuleRecord>();
  const resolving = new Set<string>();

  const load = (path: string, moduleSource: string | undefined, isRoot: boolean): LinkedModuleRecord => {
    if (resolving.has(path)) throw new KernRunnerError(`link error: import cycle involving '${path}'`);
    const existing = records.get(path);
    if (existing) return existing;
    resolving.add(path);
    let moduleRoot = root;
    if (moduleSource === undefined) {
      // Fail closed if a misbehaving embedder loader hands back a non-string
      // source (mirrors the guard in runner-capability-plan.ts): the parser
      // would otherwise crash with a raw TypeError instead of a KernRunnerError.
      const rawSource = loader.readSource(path);
      if (typeof rawSource !== 'string') {
        throw new KernRunnerError(moduleLinkErrors.unreadableSource(path));
      }
      moduleRoot = parseRunnerModule(path, rawSource, options);
    }
    if (!isRoot) assertNoMainInImportedModule(moduleRoot, path);
    const imports = collectUseImports(moduleRoot, path, loader);
    const record = linkSingleModule(path, moduleRoot, imports);
    records.set(path, record);
    for (const imported of imports) {
      const target = load(imported.targetPath, undefined, false);
      const exported = target.exports.get(imported.importedName);
      if (!exported) {
        throw new KernRunnerError(
          `link error: module '${imported.targetPath}' does not export '${imported.importedName}' imported by '${path}'`,
        );
      }
      if (imported.kind && imported.kind !== exported.kind) {
        throw new KernRunnerError(
          `link error: import '${imported.importedName}' from '${imported.targetPath}' expected kind '${imported.kind}' but found '${exported.kind}'`,
        );
      }
      if (imported.exportOnly) {
        const mutableExports = record.exports as Map<string, RunnerLinkedExport>;
        if (mutableExports.has(imported.localName)) {
          throw new KernRunnerError(`link error: duplicate export '${imported.localName}' in '${path}'`);
        }
        mutableExports.set(imported.localName, {
          ...exported,
          sourceName: exported.sourceName,
          binding:
            exported.kind === 'fn'
              ? { ...exported.binding, name: imported.localName }
              : aliasRunnerClassBinding(exported.binding, imported.localName),
        } as RunnerLinkedExport);
      }
    }
    resolving.delete(path);
    return record;
  };

  load(rootPath, source, true);
  return [...records.values()];
}

function linkSingleModule(path: string, root: IRNode, imports: readonly RunnerLinkedImport[]): LinkedModuleRecord {
  const functions = collectRunnerFunctions(root);
  const classes = collectRunnerClasses(root);
  validateRunnerCallableNames(functions, classes);
  const exports = collectExplicitRunnerExports(functions, classes, root, path);
  return { path, root, functions, classes, exports, imports };
}

function linkedRoot(records: readonly LinkedModuleRecord[], options: ExecuteKernSourceOptions): LinkedModuleRecord {
  const path = modulePathForRoot(options);
  const root = records.find((record) => record.path === path);
  if (!root) throw new KernRunnerError(`link error: root module '${path}' was not linked`);
  return root;
}

/**
 * Build a private {@link RunnerModuleScope} for every linked module. Modules are
 * singletons: each scope holds the module's OWN functions/classes (each tagged
 * with the scope so their bodies resolve against it) plus references to the
 * bindings it imports — the SAME binding object from the defining module's
 * scope, never a copy flattened into this scope. So an imported helper resolves
 * its own module's private helpers/classes, transitive imports chain correctly,
 * and a name defined here does not shadow the imported module's same-named
 * private symbol. `linkRunnerModules` has already validated the import graph, so
 * this pass only wires references and re-checks callable-name conflicts.
 */
function buildRunnerModuleScopes(records: readonly LinkedModuleRecord[]): Map<string, RunnerModuleScope> {
  const byPath = new Map(records.map((record) => [record.path, record]));
  const scopes = new Map<string, RunnerModuleScope>();

  // Pass 1: seed each scope with its own declarations, tagged with the scope.
  for (const record of records) {
    const scope: RunnerModuleScope = { functions: new Map(), classes: new Map() };
    for (const [name, binding] of record.functions) scope.functions.set(name, { ...binding, module: scope });
    for (const [name, binding] of record.classes) scope.classes.set(name, { ...binding, module: scope });
    scopes.set(record.path, scope);
  }

  // Resolve an export (own or re-exported) to the DEFINING module's tagged binding.
  const resolveExport = (
    path: string,
    name: string,
    seen: Set<string>,
  ): { readonly kind: 'fn' | 'class'; readonly binding: RunnerFunctionBinding | RunnerClassBinding } | undefined => {
    const key = `${path} ${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const record = byPath.get(path);
    const scope = scopes.get(path);
    if (!record || !scope) return undefined;
    const reexport = record.imports.find((imported) => imported.exportOnly && imported.localName === name);
    if (reexport) return resolveExport(reexport.targetPath, reexport.importedName, seen);
    const exported = record.exports.get(name);
    if (exported?.kind === 'fn') {
      const binding = scope.functions.get(exported.sourceName);
      if (binding) return { kind: 'fn', binding };
    } else if (exported?.kind === 'class') {
      const binding = scope.classes.get(exported.sourceName);
      if (binding) return { kind: 'class', binding };
    }
    return undefined;
  };

  // Pass 2: wire each module's imports as references into its scope. Imports
  // with export=true are additive (local binding AND re-export), so they are
  // wired locally exactly like plain imports.
  for (const record of records) {
    const scope = scopes.get(record.path);
    if (!scope) continue;
    for (const imported of record.imports) {
      const resolved = resolveExport(imported.targetPath, imported.importedName, new Set());
      if (!resolved) {
        throw new KernRunnerError(
          moduleLinkErrors.doesNotExport(imported.targetPath, imported.importedName, record.path),
        );
      }
      if (scope.functions.has(imported.localName) || scope.classes.has(imported.localName)) {
        throw new KernRunnerError(moduleLinkErrors.aliasConflicts(imported.localName, record.path));
      }
      if (resolved.kind === 'fn') scope.functions.set(imported.localName, resolved.binding as RunnerFunctionBinding);
      else scope.classes.set(imported.localName, resolved.binding as RunnerClassBinding);
    }
    validateRunnerCallableNames(scope.functions, scope.classes);
    assertRunnerClassAcyclic(scope.classes);
  }

  return scopes;
}

function linkedRootScope(records: readonly LinkedModuleRecord[], rootRecord: LinkedModuleRecord): RunnerModuleScope {
  const scopes = buildRunnerModuleScopes(records);
  const rootScope = scopes.get(rootRecord.path);
  if (!rootScope) throw new KernRunnerError(`link error: root module '${rootRecord.path}' was not linked`);
  return rootScope;
}

function aliasRunnerClassBinding(binding: RunnerClassBinding, name: string): RunnerClassBinding {
  const aliasMember = (member: RunnerClassMemberBinding): RunnerClassMemberBinding => ({
    ...member,
    ownerClass: member.ownerClass === binding.name ? name : member.ownerClass,
  });
  return {
    ...binding,
    name,
    extendsName: binding.extendsName,
    constructor: binding.constructor ? aliasMember(binding.constructor) : undefined,
    methods: new Map([...binding.methods].map(([key, member]) => [key, aliasMember(member)])),
    getters: new Map([...binding.getters].map(([key, member]) => [key, aliasMember(member)])),
  };
}

function runnerClassBinding(node: IRNode): RunnerClassBinding | undefined {
  const name = node.props?.name;
  if (!isPortableBindingName(name)) return undefined;
  const fields: RunnerClassFieldBinding[] = [];
  const fieldNames = new Set<string>();
  const methods = new Map<string, RunnerClassMemberBinding>();
  const getters = new Map<string, RunnerClassMemberBinding>();
  let constructorBinding: RunnerClassMemberBinding | undefined;
  for (const child of node.children ?? []) {
    if (child.type === 'field') {
      const fieldName = child.props?.name;
      if (!isPortableBindingName(fieldName)) continue;
      if (fieldNames.has(fieldName))
        throw new KernRunnerError(`runner class '${name}' has duplicate field '${fieldName}'`);
      fieldNames.add(fieldName);
      fields.push({ name: fieldName, value: child.props?.value });
      continue;
    }
    if (child.type === 'constructor') {
      if (constructorBinding) throw new KernRunnerError(`runner class '${name}' has duplicate constructors`);
      const member = runnerClassMemberBinding(child, name, 'constructor');
      if (member) constructorBinding = member;
      continue;
    }
    if (child.type === 'method') {
      const member = runnerClassMemberBinding(child, name, 'method');
      if (member && methods.has(member.name)) {
        throw new KernRunnerError(`runner class '${name}' has duplicate method '${member.name}'`);
      }
      if (member) methods.set(member.name, member);
      continue;
    }
    if (child.type === 'getter') {
      const member = runnerClassMemberBinding(child, name, 'getter');
      if (member && getters.has(member.name)) {
        throw new KernRunnerError(`runner class '${name}' has duplicate getter '${member.name}'`);
      }
      if (member) getters.set(member.name, member);
    }
  }
  const extendsName =
    typeof node.props?.extends === 'string' && node.props.extends !== '' ? node.props.extends : undefined;
  return { name, extendsName, fields, constructor: constructorBinding, methods, getters };
}

function runnerClassMemberBinding(
  node: IRNode,
  ownerClass: string,
  fallbackName: string,
): RunnerClassMemberBinding | undefined {
  const name = node.type === 'constructor' ? fallbackName : node.props?.name;
  if (!isPortableBindingName(name)) return undefined;
  if (isTrueProp(node.props?.async) || isTrueProp(node.props?.stream) || isTrueProp(node.props?.static)) {
    throw new KernRunnerError(
      `runner class '${ownerClass}' member '${name}' uses unsupported async, stream, or static`,
    );
  }
  const handler = singleKernHandler(node);
  if (!handler) {
    throw new KernRunnerError(
      `runner class '${ownerClass}' member '${name}' must contain exactly one handler lang="kern"`,
    );
  }
  return {
    name,
    params: runnerParamNames(node, `${ownerClass}.${name}`),
    handler,
    body: handler.children ?? [],
    ownerClass,
  };
}

function runnerFunctionBinding(fn: IRNode): RunnerFunctionBinding | undefined {
  const name = fn.props?.name;
  if (!isPortableBindingName(name)) return undefined;
  if (isTrueProp(fn.props?.async) || isTrueProp(fn.props?.stream)) return undefined;
  if (fn.props?.returns === undefined || fn.props.returns === '' || fn.props.returns === 'void') return undefined;
  const handler = singleKernHandler(fn);
  if (!handler) return undefined;
  try {
    const params = runnerParamNames(fn, name);
    return { name, params, returns: fn.props.returns, handler, body: handler.children ?? [] };
  } catch (error) {
    if (error instanceof KernRunnerError) return undefined;
    throw error;
  }
}

function runnerParamNames(fn: IRNode, fnName: string): readonly string[] {
  const paramChildren = (fn.children ?? []).filter((child) => child.type === 'param');
  const legacyParams = typeof fn.props?.params === 'string' ? fn.props.params.trim() : '';
  if (paramChildren.length > 0 && legacyParams !== '') {
    throw new KernRunnerError(`runner function '${fnName}' cannot mix params= with param children`);
  }
  const names =
    paramChildren.length > 0
      ? paramChildren.map((param) => {
          const name = param.props?.name;
          if (!isPortableBindingName(name)) {
            throw new KernRunnerError(`runner function '${fnName}' param must be a portable identifier`);
          }
          if ((param.children ?? []).length > 0) {
            throw new KernRunnerError(`runner function '${fnName}' destructured params are unsupported`);
          }
          for (const unsupported of ['value', 'default'] as const) {
            if (param.props?.[unsupported] !== undefined) {
              throw new KernRunnerError(`runner function '${fnName}' param ${unsupported}= is unsupported`);
            }
          }
          for (const unsupported of ['optional', 'variadic'] as const) {
            const value = param.props?.[unsupported];
            if (isTrueProp(value)) {
              throw new KernRunnerError(`runner function '${fnName}' param ${unsupported}= is unsupported`);
            }
          }
          return name;
        })
      : legacyParamNames(legacyParams, fnName);

  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new KernRunnerError(`runner function '${fnName}' has duplicate param '${name}'`);
    seen.add(name);
  }
  return names;
}

function legacyParamNames(params: string, fnName: string): string[] {
  if (params === '') return [];
  return params.split(',').map((part) => {
    const trimmed = part.trim();
    if (trimmed === '' || trimmed.includes('=') || trimmed.startsWith('...') || trimmed.includes('?')) {
      throw new KernRunnerError(`runner function '${fnName}' has unsupported params= syntax`);
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*[A-Za-z_][A-Za-z0-9_]*(?:\[\])?)?$/.exec(trimmed);
    if (!match || !isPortableBindingName(match[1])) {
      throw new KernRunnerError(`runner function '${fnName}' has unsupported params= syntax`);
    }
    return match[1];
  });
}

function requirementLabel(requirement: Pick<CapabilityRequirement, 'id' | 'sourceLine'>): string {
  return requirement.sourceLine > 0 ? `${requirement.id}@${requirement.sourceLine}` : requirement.id;
}

function unknownRequirementLabel(requirement: UnknownCapabilityRequirement): string {
  const id = `${requirement.namespace}.${requirement.operation}`;
  return requirement.sourceLine > 0 ? `${id}@${requirement.sourceLine}` : id;
}

function malformedRequirementLabel(requirement: MalformedCapabilityRequirement): string {
  const id =
    requirement.namespace && requirement.operation ? `${requirement.namespace}.${requirement.operation}` : 'capability';
  const withLine = requirement.sourceLine > 0 ? `${id}@${requirement.sourceLine}` : id;
  return `${withLine} (${requirement.reason})`;
}

function requirementList(requirements: readonly Pick<CapabilityRequirement, 'id' | 'sourceLine'>[]): string {
  return requirements.map(requirementLabel).join(', ');
}

function asyncCapabilityNodeLabel(node: IRNode): string | undefined {
  const namespace = node.props?.namespace;
  const operation = node.props?.operation;
  if (typeof namespace !== 'string' || typeof operation !== 'string') return undefined;
  const id = `${namespace}.${operation}`;
  if (CAPABILITY_DESCRIPTORS[id as keyof typeof CAPABILITY_DESCRIPTORS]?.syncBoundary !== 'async-planned') {
    return undefined;
  }
  return node.loc?.line && node.loc.line > 0 ? `${id}@${node.loc.line}` : id;
}

function containsAsyncPlannedCapabilityNode(root: IRNode): boolean {
  const stack: IRNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (asyncCapabilityNodeLabel(node)) return true;
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
  return false;
}

function unsupportedAsyncContainerBeforeBranchSelection(root: IRNode): IRNode | undefined {
  const stack: IRNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node !== root && (node.type === 'branch' || node.type === 'if' || node.type === 'else')) continue;
    if (ASYNC_SOURCE_UNSUPPORTED_CONTAINER_TYPES.has(node.type) && containsAsyncPlannedCapabilityNode(node)) {
      return node;
    }
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
  return undefined;
}

function unsupportedAsyncContainerInExecutableHandlers(
  mainHandler: IRNode,
  runnerFunctions: ReadonlyMap<string, RunnerFunctionBinding>,
): IRNode | undefined {
  for (const handler of executableKernHandlers(mainHandler, runnerFunctions)) {
    const unsupported = unsupportedAsyncContainerBeforeBranchSelection(handler);
    if (unsupported) return unsupported;
  }
  return undefined;
}

function asyncCapabilityLabelsOutsideExecutable(
  root: IRNode,
  mainHandler: IRNode,
  runnerFunctions: ReadonlyMap<string, RunnerFunctionBinding>,
): string[] {
  const out: string[] = [];
  const executableHandlers = executableKernHandlers(mainHandler, runnerFunctions);
  const stack: Array<{ node: IRNode; insideExecutable: boolean }> = [
    { node: root, insideExecutable: executableHandlers.has(root) },
  ];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) continue;
    const { node, insideExecutable } = frame;
    const label = insideExecutable ? undefined : asyncCapabilityNodeLabel(node);
    if (label) out.push(label);
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      stack.push({ node: child, insideExecutable: insideExecutable || executableHandlers.has(child) });
    }
  }
  return out;
}

function executableKernHandlers(
  mainHandler: IRNode,
  runnerFunctions: ReadonlyMap<string, RunnerFunctionBinding>,
): ReadonlySet<IRNode> {
  const out = new Set<IRNode>([mainHandler]);
  const queued = [...calledRunnerFunctionNames(mainHandler.children ?? [], runnerFunctions)];
  const visited = new Set<string>();
  while (queued.length > 0) {
    const name = queued.pop();
    if (!name || visited.has(name)) continue;
    visited.add(name);
    const fn = runnerFunctions.get(name);
    if (!fn) continue;
    if (fn.handler) out.add(fn.handler);
    for (const next of calledRunnerFunctionNames(fn.body, runnerFunctions)) {
      if (!visited.has(next)) queued.push(next);
    }
  }
  return out;
}

function calledRunnerFunctionNames(
  nodes: readonly IRNode[],
  runnerFunctions: ReadonlyMap<string, RunnerFunctionBinding>,
): Set<string> {
  const out = new Set<string>();
  for (const node of walkRunnerNodes({ type: '__block', children: [...nodes] })) {
    for (const expr of supportedRunnerFunctionCallExpressions(node)) {
      collectRunnerFunctionCalls(expr.node, runnerFunctions, out, expr.mode);
    }
  }
  return out;
}

type RunnerFunctionCallExpressionMode = 'scalar' | 'let' | 'capabilityInput';

interface RunnerFunctionCallExpression {
  readonly node: ValueIR;
  readonly mode: RunnerFunctionCallExpressionMode;
}

function supportedRunnerFunctionCallExpressions(node: IRNode): RunnerFunctionCallExpression[] {
  const props = node.props ?? {};
  const out: RunnerFunctionCallExpression[] = [];
  function add(raw: unknown, mode: RunnerFunctionCallExpressionMode): void {
    if (typeof raw !== 'string' || raw.trim() === '') return;
    try {
      out.push({ node: parseExpression(raw), mode });
    } catch {
      // Parser/runtime diagnostics own malformed expressions.
    }
  }
  if (node.type === 'let') {
    add(props.value, 'let');
  } else if (node.type === 'capability') {
    add(props.input, 'capabilityInput');
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
      // Parser/runtime diagnostics own malformed templates.
    }
  }
  return out;
}

function collectRunnerFunctionCalls(
  node: ValueIR,
  runnerFunctions: ReadonlyMap<string, RunnerFunctionBinding>,
  out: Set<string>,
  mode: RunnerFunctionCallExpressionMode,
): void {
  if (node.kind === 'call' && node.callee.kind === 'ident' && runnerFunctions.has(node.callee.name)) {
    out.add(node.callee.name);
  }
  for (const child of valueChildren(node, runnerFunctions, mode)) {
    collectRunnerFunctionCalls(child.node, runnerFunctions, out, child.mode);
  }
}

function valueChildren(
  node: ValueIR,
  runnerFunctions: ReadonlyMap<string, RunnerFunctionBinding>,
  mode: RunnerFunctionCallExpressionMode,
): readonly RunnerFunctionCallExpression[] {
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
        (runnerFunctions.has(node.callee.name) || node.callee.name === 'String' || node.callee.name === 'super')
      ) {
        return node.args.map((arg) => ({ node: arg, mode: 'scalar' }));
      }
      if (node.callee.kind === 'member') {
        return [
          { node: node.callee.object, mode: 'scalar' },
          ...node.args.map((arg): RunnerFunctionCallExpression => ({ node: arg, mode: 'scalar' })),
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
      if (mode === 'capabilityInput') {
        return node.items
          .filter((item): item is ValueIR => Boolean(item))
          .map((item) => ({ node: item, mode: 'capabilityInput' }));
      }
      if (mode === 'let') {
        return node.items
          .filter((item): item is ValueIR => Boolean(item))
          .map((item) => ({ node: item, mode: item.kind === 'arrayLit' ? 'let' : 'scalar' }));
      }
      return [];
    case 'objectLit':
      if (mode === 'capabilityInput') {
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

function* walkRunnerNodes(root: IRNode): Generator<IRNode> {
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

function missingAsyncCapabilityHandlers(
  requirements: readonly CapabilityRequirement[],
  capabilities: KernRunnerAsyncCapabilities | undefined,
): CapabilityRequirement[] {
  return requirements.filter((requirement) => {
    const provider = capabilities?.[requirement.namespace];
    if (typeof provider === 'function') return false;
    return !(
      provider &&
      typeof provider === 'object' &&
      Object.hasOwn(provider, requirement.operation) &&
      typeof provider[requirement.operation] === 'function'
    );
  });
}

function stdoutFromTrace(trace: ReturnType<typeof referenceRunSequence>): string {
  const kind = trace.completion.kind;
  if (kind === 'normal' || (kind === 'return' && trace.completion.value === undefined)) {
    let out = '';
    for (const event of trace.events) {
      if (event.op === 'stdout') out += `${event.text}\n`;
    }
    return out;
  }
  if (kind === 'return') {
    throw new KernRunnerError('kern run: main must return without a value');
  }
  if (kind === 'throw') {
    throw new KernRunnerError(`kern run: uncaught ${trace.completion.error?.kind ?? 'Error'} escaped main`);
  }
  throw new KernRunnerError('control statement escaped main');
}

/**
 * Browser-safe source executor for the native runner preview.
 *
 * Parses a `.kern` source string, resolves the single void `main`, executes its
 * `handler lang="kern"` body through the reference runner, and returns replayed
 * stdout bytes. It performs no filesystem, process, or Node-only work.
 */
export function executeKernSource(source: string, options: ExecuteKernSourceOptions = {}): string {
  const records = linkRunnerModules(source, options);
  const rootRecord = linkedRoot(records, options);
  const handler = resolveKernMainHandler(rootRecord.root);
  return executeParsedKernHandler(rootRecord, records, handler, options, 'kern run');
}

export function executeKernEntrySource(
  source: string,
  entry: KernRunnerEntryDescriptor,
  options: ExecuteKernEntrySourceOptions = {},
): string {
  const records = linkRunnerModules(source, options);
  const rootRecord = linkedRoot(records, options);
  const handler = resolveKernEntryHandler(rootRecord.root, entry);
  return executeParsedKernHandler(rootRecord, records, handler, options, `kern run ${entryLabel(entry)}`);
}

function executeParsedKernHandler(
  rootRecord: LinkedModuleRecord,
  records: readonly LinkedModuleRecord[],
  handler: IRNode,
  options: ExecuteKernSourceOptions,
  errorPrefix: string,
): string {
  const rootScope = linkedRootScope(records, rootRecord);
  const runnerFunctions = rootScope.functions;
  const runnerClasses = rootScope.classes;
  ensureRunnerContractsRegistered();

  let trace: ReturnType<typeof referenceRunSequence>;
  try {
    const env = makeEnv({
      ...options.env,
      capabilities: options.capabilities ?? options.env?.capabilities,
      capabilityContext: {
        ...(options.env?.capabilityContext ?? {}),
        ...(options.capabilityContext ?? {}),
      },
    });
    env.runnerFunctions = runnerFunctions;
    env.runnerClasses = runnerClasses;
    env.runnerCallStack = [];
    env.runnerCallCache = new Map();
    trace = referenceRunSequence(handler.children ?? [], env);
  } catch (err) {
    if (err instanceof ReferenceRunnerError) {
      throw new KernRunnerError(
        `${errorPrefix}: cannot execute - non-portable operation (${referenceRunnerErrorMessage(err)})`,
      );
    }
    throw new KernRunnerError(`${errorPrefix}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return stdoutFromTrace(trace);
}

/**
 * Source-level async capability boundary for embedders.
 *
 * Purely synchronous programs delegate to executeKernSource and keep today's
 * runtime behavior. Programs that request known async-planned capabilities are
 * preflighted against explicit async provider ids, then run through a narrow
 * async preview lane: straight-line body statements, selected control-flow
 * paths, structured try/catch/finally, and sequential loops can await async
 * capability providers, while unsupported async source shapes still fail closed.
 */
export async function executeKernSourceAsync(
  source: string,
  options: ExecuteKernSourceAsyncOptions = {},
): Promise<string> {
  return executeKernSourceAsyncWithEntry(source, undefined, options);
}

export async function executeKernEntrySourceAsync(
  source: string,
  entry: KernRunnerEntryDescriptor,
  options: ExecuteKernEntrySourceAsyncOptions = {},
): Promise<string> {
  return executeKernSourceAsyncWithEntry(source, entry, options);
}

async function executeKernSourceAsyncWithEntry(
  source: string,
  entry: KernRunnerEntryDescriptor | undefined,
  options: ExecuteKernSourceAsyncOptions = {},
): Promise<string> {
  let analysis: ReturnType<typeof analyzeKernSourceCapabilities>;
  try {
    analysis = analyzeKernSourceCapabilities(source, {
      parseOptions: options.parseOptions,
      entryHandlerName: entry?.handler,
      providedCapabilities: options.providedCapabilities,
      providedAsyncCapabilities: options.providedAsyncCapabilities,
      moduleLoader: options.moduleLoader,
      sourcePath: options.sourcePath,
    });
  } catch (error) {
    throw new KernRunnerError(`kern run async preflight: ${error instanceof Error ? error.message : String(error)}`);
  }
  const firstError = analysis.parseDiagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (firstError || analysis.hasParseErrors) {
    throw new KernRunnerError(firstError?.message ?? 'kern run async preflight: source has parse errors');
  }

  if (analysis.malformedCapabilities.length > 0) {
    throw new KernRunnerError(
      `kern run async preflight: malformed capability requirements: ${analysis.malformedCapabilities
        .map(malformedRequirementLabel)
        .join(', ')}`,
    );
  }
  if (analysis.unknownCapabilities.length > 0) {
    throw new KernRunnerError(
      `kern run async preflight: unknown capabilities: ${analysis.unknownCapabilities
        .map(unknownRequirementLabel)
        .join(', ')}`,
    );
  }
  if (analysis.unknownProvidedCapabilities.length > 0) {
    throw new KernRunnerError(
      `kern run async preflight: unknown provided capabilities: ${analysis.unknownProvidedCapabilities.join(', ')}`,
    );
  }
  if (analysis.unknownProvidedAsyncCapabilities.length > 0) {
    throw new KernRunnerError(
      `kern run async preflight: unknown provided async capabilities: ${analysis.unknownProvidedAsyncCapabilities.join(
        ', ',
      )}`,
    );
  }
  if (analysis.missingProviders.length > 0) {
    throw new KernRunnerError(
      `kern run async preflight: missing sync providers: ${requirementList(analysis.missingProviders)}`,
    );
  }
  if (analysis.missingAsyncProviders.length > 0) {
    throw new KernRunnerError(
      `kern run async preflight: missing async providers: ${requirementList(analysis.missingAsyncProviders)}`,
    );
  }
  const unsupportedAsyncExecutions = entry
    ? analysis.unsupportedAsyncExecutions.filter((requirement) => requirement.reason !== 'outside-main')
    : analysis.unsupportedAsyncExecutions;
  if (
    unsupportedAsyncExecutions.length > 0 &&
    (analysis.asyncBoundaryRequired || options.providedAsyncCapabilities || options.asyncCapabilities)
  ) {
    throw new KernRunnerError(
      `kern run async preflight: unsupported async executions: ${requirementList(unsupportedAsyncExecutions)}`,
    );
  }
  if (analysis.asyncBoundaryRequired) {
    if (!options.providedAsyncCapabilities) {
      throw new KernRunnerError(
        `kern run async preflight: missing async providers: ${requirementList(
          analysis.executableAsyncPlannedCapabilities,
        )}`,
      );
    }
    if (!options.asyncCapabilities) {
      throw new KernRunnerError(
        `kern run async preflight: missing async capability handlers: ${requirementList(
          analysis.executableAsyncPlannedCapabilities,
        )}`,
      );
    }
    const missingHandlers = missingAsyncCapabilityHandlers(
      analysis.executableAsyncPlannedCapabilities,
      options.asyncCapabilities,
    );
    if (missingHandlers.length > 0) {
      throw new KernRunnerError(
        `kern run async preflight: missing async capability handlers: ${requirementList(missingHandlers)}`,
      );
    }

    const records = linkRunnerModules(source, options);
    const rootRecord = linkedRoot(records, options);
    const handler = entry ? resolveKernEntryHandler(rootRecord.root, entry) : resolveKernMainHandler(rootRecord.root);
    const rootScope = linkedRootScope(records, rootRecord);
    const runnerFunctions = rootScope.functions;
    const runnerClasses = rootScope.classes;
    const outsideMain = entry ? [] : asyncCapabilityLabelsOutsideExecutable(rootRecord.root, handler, runnerFunctions);
    if (outsideMain.length > 0) {
      throw new KernRunnerError(
        `kern run async: async source execution outside main handler is unsupported in this preview: ${outsideMain.join(
          ', ',
        )}`,
      );
    }
    const unsupportedContainer = unsupportedAsyncContainerInExecutableHandlers(handler, runnerFunctions);
    if (unsupportedContainer) {
      throw new KernRunnerError(
        `kern run async: async source execution for node type "${unsupportedContainer.type}" is unsupported in this preview`,
      );
    }
    ensureRunnerContractsRegistered();

    let trace: Awaited<ReturnType<typeof asyncReferenceRunSequence>>;
    try {
      const env = makeEnv({
        ...options.env,
        capabilities: options.capabilities ?? options.env?.capabilities,
        capabilityContext: {
          ...(options.env?.capabilityContext ?? {}),
          ...(options.capabilityContext ?? {}),
        },
      });
      env.runnerFunctions = runnerFunctions;
      env.runnerClasses = runnerClasses;
      env.runnerCallStack = [];
      env.runnerCallCache = new Map();
      trace = await asyncReferenceRunSequence(handler.children ?? [], env, {
        asyncCapabilities: options.asyncCapabilities,
        capabilityTimeoutMs: options.capabilityTimeoutMs,
      });
    } catch (err) {
      if (err instanceof ReferenceRunnerError) {
        throw new KernRunnerError(
          `kern run async${
            entry ? ` ${entryLabel(entry)}` : ''
          }: cannot execute - non-portable operation (${referenceRunnerErrorMessage(err)})`,
        );
      }
      throw new KernRunnerError(
        `kern run async${entry ? ` ${entryLabel(entry)}` : ''}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return stdoutFromTrace(trace);
  }

  // Async host adapters are intentionally not forwarded to the sync executor.
  // The module loader and source path MUST forward, though: a sync-only
  // multi-file program that passed async preflight would otherwise fail to
  // link when delegated here.
  const syncOptions = {
    parseOptions: options.parseOptions,
    env: options.env,
    capabilities: options.capabilities,
    capabilityContext: options.capabilityContext,
    moduleLoader: options.moduleLoader,
    sourcePath: options.sourcePath,
  };
  return entry ? executeKernEntrySource(source, entry, syncOptions) : executeKernSource(source, syncOptions);
}

export type {
  CanonicalError,
  CompletionKind,
  CompletionRecord,
  NodeContract,
  NodeFixture,
  SemanticEnv,
  Trace,
  TraceEvent,
} from './ir/semantics/index.js';
// ── Runtime execution surface (runner + registry + env) ──────────────────────
export {
  CONTRACT_REGISTRY,
  completionsEqual,
  deepEqual,
  emptyTrace,
  eventsEqual,
  ReferenceRunnerError,
  referenceRun,
  registerContract,
  tracesEqual,
} from './ir/semantics/index.js';
export type { ParseExpressionOptions } from './parser-expression.js';
// ── Lazy expression parsing — the runner parses string-valued IR expression
//    props at eval time. `parseExpression` is already typescript-free (it imports
//    only the dependency-free `closure-classifier`), which is what makes this
//    whole entry spine-clean. ──────────────────────────────────────────────────
export { parseExpression } from './parser-expression.js';
export type {
  AsyncRuntimeCapabilityHandler,
  AsyncRuntimeCapabilityProvider,
  InvokeRunnerCapabilityAsyncOptions,
  KernRunnerAsyncCapabilities,
  KernRunnerCapabilities,
  KernRunnerCapabilityContext,
  KernRunnerCapabilityNamespace,
  RuntimeCapabilityCall,
  RuntimeCapabilityHandler,
  RuntimeCapabilityProvider,
  RuntimeCapabilityScalar,
  RuntimeCapabilityValue,
} from './runner-capabilities.js';
export {
  assertRuntimeCapabilityValue,
  DEFAULT_ASYNC_CAPABILITY_TIMEOUT_MS,
  invokeRunnerCapability,
  invokeRunnerCapabilityAsync,
  isRuntimeCapabilityValue,
  KernCapabilityError,
} from './runner-capabilities.js';
export type { IRNode } from './types.js';
// ── Core IR value/node types embedders need to build and read traces. ────────
export type { ValueIR } from './value-ir.js';
export { makeEnv, referenceRunSequence, registerAllContracts };
