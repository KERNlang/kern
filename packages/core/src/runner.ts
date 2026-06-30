import { asyncReferenceRunSequence } from './ir/semantics/async-reference-runner.js';
import {
  CONTRACT_REGISTRY,
  makeEnv,
  ReferenceRunnerError,
  type RunnerFunctionBinding,
  referenceRunSequence,
  registerAllContracts,
  type SemanticEnv,
} from './ir/semantics/index.js';
import { isPortableBindingName } from './ir/semantics/portable-scalar.js';
import { resetAllContractRegistration } from './ir/semantics/register-all.js';
import { parseDocumentWithDiagnostics } from './parser.js';
import type { ParseOptions } from './parser-core.js';
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
}

const REQUIRED_RUNNER_CONTRACTS = [
  'assign',
  'branch',
  'capability',
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

/** Strict native-runner entry resolution: exactly one top-level `fn main` with one KERN handler. */
export function resolveKernMainHandler(root: IRNode): IRNode {
  const topLevel = topLevelNodes(root);
  const mains = topLevel.filter((node) => node.type === 'fn' && node.props?.name === 'main');

  if (mains.length === 0) throw new KernRunnerError('expected exactly one top-level fn name=main');
  if (mains.length > 1) throw new KernRunnerError('found multiple top-level fn name=main');

  const main = mains[0];
  if (main.props?.returns !== 'void') throw new KernRunnerError('main must declare returns=void');
  if (typeof main.props?.params === 'string' && main.props.params.trim() !== '') {
    throw new KernRunnerError('main parameters are unsupported in native runner preview');
  }
  if ((main.children ?? []).some((node) => node.type === 'param')) {
    throw new KernRunnerError('main parameters are unsupported in native runner preview');
  }
  if (isTrueProp(main.props?.async)) throw new KernRunnerError('main async is unsupported in native runner preview');
  if (isTrueProp(main.props?.stream)) {
    throw new KernRunnerError('main stream=true is unsupported in native runner preview');
  }

  return resolveSingleKernHandler(main, 'main');
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

function runnerFunctionBinding(fn: IRNode): RunnerFunctionBinding | undefined {
  const name = fn.props?.name;
  if (!isPortableBindingName(name)) return undefined;
  if (isTrueProp(fn.props?.async) || isTrueProp(fn.props?.stream)) return undefined;
  if (fn.props?.returns === undefined || fn.props.returns === '' || fn.props.returns === 'void') return undefined;
  const handler = singleKernHandler(fn);
  if (!handler) return undefined;
  try {
    const params = runnerParamNames(fn, name);
    return { name, params, returns: fn.props.returns, body: handler.children ?? [] };
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

function asyncCapabilityLabelsOutsideMain(root: IRNode, mainHandler: IRNode): string[] {
  const out: string[] = [];
  const stack: Array<{ node: IRNode; insideMain: boolean }> = [{ node: root, insideMain: root === mainHandler }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) continue;
    const { node, insideMain } = frame;
    const label = insideMain ? undefined : asyncCapabilityNodeLabel(node);
    if (label) out.push(label);
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      stack.push({ node: child, insideMain: insideMain || child === mainHandler });
    }
  }
  return out;
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
  const { root, diagnostics } = parseDocumentWithDiagnostics(source, undefined, options.parseOptions);
  const firstError = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (firstError) throw new KernRunnerError(firstError.message);

  const handler = resolveKernMainHandler(root);
  const runnerFunctions = collectRunnerFunctions(root);
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
    env.runnerCallStack = [];
    env.runnerCallCache = new Map();
    trace = referenceRunSequence(handler.children ?? [], env);
  } catch (err) {
    if (err instanceof ReferenceRunnerError) {
      throw new KernRunnerError(`kern run: cannot execute - non-portable operation (${err.message})`);
    }
    throw new KernRunnerError(`kern run: ${err instanceof Error ? err.message : String(err)}`);
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
  let analysis: ReturnType<typeof analyzeKernSourceCapabilities>;
  try {
    analysis = analyzeKernSourceCapabilities(source, {
      parseOptions: options.parseOptions,
      providedCapabilities: options.providedCapabilities,
      providedAsyncCapabilities: options.providedAsyncCapabilities,
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
  if (analysis.asyncBoundaryRequired) {
    if (!options.providedAsyncCapabilities) {
      throw new KernRunnerError(
        `kern run async preflight: missing async providers: ${requirementList(analysis.asyncPlannedCapabilities)}`,
      );
    }
    if (!options.asyncCapabilities) {
      throw new KernRunnerError(
        `kern run async preflight: missing async capability handlers: ${requirementList(
          analysis.asyncPlannedCapabilities,
        )}`,
      );
    }
    const missingHandlers = missingAsyncCapabilityHandlers(
      analysis.asyncPlannedCapabilities,
      options.asyncCapabilities,
    );
    if (missingHandlers.length > 0) {
      throw new KernRunnerError(
        `kern run async preflight: missing async capability handlers: ${requirementList(missingHandlers)}`,
      );
    }

    const { root, diagnostics } = parseDocumentWithDiagnostics(source, undefined, options.parseOptions);
    const firstAsyncParseError = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (firstAsyncParseError) throw new KernRunnerError(firstAsyncParseError.message);
    const handler = resolveKernMainHandler(root);
    const outsideMain = asyncCapabilityLabelsOutsideMain(root, handler);
    if (outsideMain.length > 0) {
      throw new KernRunnerError(
        `kern run async: async source execution outside main handler is unsupported in this preview: ${outsideMain.join(
          ', ',
        )}`,
      );
    }
    const unsupportedContainer = unsupportedAsyncContainerBeforeBranchSelection(handler);
    if (unsupportedContainer) {
      throw new KernRunnerError(
        `kern run async: async source execution for node type "${unsupportedContainer.type}" is unsupported in this preview`,
      );
    }
    const runnerFunctions = collectRunnerFunctions(root);
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
      env.runnerCallStack = [];
      env.runnerCallCache = new Map();
      trace = await asyncReferenceRunSequence(handler.children ?? [], env, {
        asyncCapabilities: options.asyncCapabilities,
      });
    } catch (err) {
      if (err instanceof ReferenceRunnerError) {
        throw new KernRunnerError(`kern run async: cannot execute - non-portable operation (${err.message})`);
      }
      throw new KernRunnerError(`kern run async: ${err instanceof Error ? err.message : String(err)}`);
    }
    return stdoutFromTrace(trace);
  }

  // Async host adapters are intentionally not forwarded to the sync executor.
  return executeKernSource(source, {
    parseOptions: options.parseOptions,
    env: options.env,
    capabilities: options.capabilities,
    capabilityContext: options.capabilityContext,
  });
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
  invokeRunnerCapability,
  invokeRunnerCapabilityAsync,
  isRuntimeCapabilityValue,
  KernCapabilityError,
} from './runner-capabilities.js';
export type { IRNode } from './types.js';
// ── Core IR value/node types embedders need to build and read traces. ────────
export type { ValueIR } from './value-ir.js';
export { makeEnv, referenceRunSequence, registerAllContracts };
