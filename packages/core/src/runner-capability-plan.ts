import { parseDocumentWithDiagnostics } from './parser.js';
import type { ParseOptions } from './parser-core.js';
import { parseExpression } from './parser-expression.js';
import type { IRNode, ParseDiagnostic } from './types.js';
import type { ValueIR } from './value-ir.js';

export type CapabilityStatus = 'shipped' | 'planned';
export type CapabilitySyncBoundary = 'sync' | 'async-planned';
export type CapabilityInputShape = 'portable-literal' | 'host-bound';

export type CapabilityId =
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
  readonly notes: string;
}

export interface CapabilityRequirement {
  readonly id: CapabilityId;
  readonly namespace: string;
  readonly operation: string;
  readonly bindingName?: string;
  readonly literalInput?: string;
  /** 1-based source line when available; -1 means the parser did not attach a location. */
  readonly sourceLine: number;
  readonly descriptor: CapabilityDescriptor;
}

export interface UnknownCapabilityRequirement {
  readonly id: string;
  readonly namespace: string;
  readonly operation: string;
  readonly bindingName?: string;
  readonly literalInput?: string;
  /** 1-based source line when available; -1 means the parser did not attach a location. */
  readonly sourceLine: number;
}

export interface MalformedCapabilityRequirement {
  readonly namespace?: string;
  readonly operation?: string;
  readonly bindingName?: string;
  readonly literalInput?: string;
  /** 1-based source line when available; -1 means the parser did not attach a location. */
  readonly sourceLine: number;
  readonly reason: string;
}

export interface UnsupportedAsyncCapabilityRequirement extends CapabilityRequirement {
  readonly reason: 'outside-main-handler' | 'unsupported-container';
  readonly containerType?: string;
}

export interface CapabilityAnalysisOptions {
  /** Optional parser capabilities. Match the parse options that execution will use. */
  readonly parseOptions?: ParseOptions;
  /**
   * Capability providers the host will inject for the current synchronous runner.
   * Kept as strings so untyped config/CLI typos can be reported through
   * unknownProvidedCapabilities. When omitted, the analyzer only classifies
   * requirements; when provided, shipped sync requirements not in this set are
   * reported as missing. Planned capabilities remain planned even if listed
   * here, because executeKernSource does not yet run async fs/net/LLM-style
   * providers.
   */
  readonly providedCapabilities?: readonly string[];
  /**
   * Async capability providers the host expects to wire in a future async runner
   * boundary. These do not make executeKernSource runnable today; they let
   * embedders distinguish "async provider missing" from "async boundary not
   * implemented yet" during preflight.
   */
  readonly providedAsyncCapabilities?: readonly string[];
}

export interface CapabilityAnalysis {
  readonly requirements: readonly CapabilityRequirement[];
  readonly unknownCapabilities: readonly UnknownCapabilityRequirement[];
  readonly malformedCapabilities: readonly MalformedCapabilityRequirement[];
  /** Requirements with non-shipped lifecycle status. Currently equal to asyncPlannedCapabilities. */
  readonly plannedCapabilities: readonly CapabilityRequirement[];
  /** Requirements that need the future async runner boundary, independent of lifecycle status. */
  readonly asyncPlannedCapabilities: readonly CapabilityRequirement[];
  /** Async-planned requirements reachable through the narrow executable async-preview lane. */
  readonly executableAsyncPlannedCapabilities: readonly CapabilityRequirement[];
  readonly missingProviders: readonly CapabilityRequirement[];
  readonly missingAsyncProviders: readonly CapabilityRequirement[];
  readonly unsupportedAsyncExecutions: readonly UnsupportedAsyncCapabilityRequirement[];
  /** Host-provided capability ids outside the descriptor table. */
  readonly unknownProvidedCapabilities: readonly string[];
  /** Host-provided async capability ids outside the async descriptor set. */
  readonly unknownProvidedAsyncCapabilities: readonly string[];
  /** True when source requests known async-planned capabilities. */
  readonly asyncBoundaryRequired: boolean;
  /** True when parser errors, or a missing parse root, make an empty requirement set untrustworthy. */
  readonly hasParseErrors: boolean;
  readonly parseDiagnostics: readonly ParseDiagnostic[];
}

export const CAPABILITY_DESCRIPTORS = Object.freeze({
  'crypto.randomBytes': capabilityDescriptor(
    'crypto.randomBytes',
    'shipped',
    'sync',
    'portable-literal',
    'Browser-safe random bytes through an explicit host crypto source.',
  ),
  'crypto.randomHex': capabilityDescriptor(
    'crypto.randomHex',
    'shipped',
    'sync',
    'portable-literal',
    'Browser-safe random hex through an explicit host crypto source.',
  ),
  'crypto.randomUUID': capabilityDescriptor(
    'crypto.randomUUID',
    'shipped',
    'sync',
    'portable-literal',
    'Browser-safe UUID v4 through an explicit host crypto source.',
  ),
  'fs.list': capabilityDescriptor(
    'fs.list',
    'planned',
    'async-planned',
    'host-bound',
    'Filesystem directory listing requires an explicit host provider; runnable only through the narrow async source preview lane.',
  ),
  'fs.readText': capabilityDescriptor(
    'fs.readText',
    'planned',
    'async-planned',
    'host-bound',
    'Filesystem reads require an explicit host provider; runnable only through the narrow async source preview lane.',
  ),
  'fs.writeText': capabilityDescriptor(
    'fs.writeText',
    'planned',
    'async-planned',
    'host-bound',
    'Filesystem writes require an explicit host provider; runnable only through the narrow async source preview lane.',
  ),
  'llm.complete': capabilityDescriptor(
    'llm.complete',
    'planned',
    'async-planned',
    'portable-literal',
    'LLM completion requires an explicit async host provider; runnable only through the narrow async source preview lane.',
  ),
  'net.fetch': capabilityDescriptor(
    'net.fetch',
    'planned',
    'async-planned',
    'portable-literal',
    'Network fetch requires an explicit async host provider; runnable only through the narrow async source preview lane.',
  ),
  'rag.answer': capabilityDescriptor(
    'rag.answer',
    'planned',
    'async-planned',
    'portable-literal',
    'RAG answer synthesis requires an explicit async host LLM provider; runnable only through the narrow async source preview lane over retrieved chunks.',
  ),
  'rag.checkAnswer': capabilityDescriptor(
    'rag.checkAnswer',
    'shipped',
    'sync',
    'portable-literal',
    'Local deterministic RAG answer grounding and citation check over chunks previously returned by rag.retrieve in the Node CLI path.',
  ),
  'rag.ingest': capabilityDescriptor(
    'rag.ingest',
    'planned',
    'async-planned',
    'host-bound',
    'Runtime RAG ingestion is planned; local retrieval is the shipped sync slice.',
  ),
  'rag.promptContext': capabilityDescriptor(
    'rag.promptContext',
    'shipped',
    'sync',
    'portable-literal',
    'Local prompt-context assembly over retrieved RAG chunks in the Node CLI path.',
  ),
  'rag.retrieve': capabilityDescriptor(
    'rag.retrieve',
    'shipped',
    'sync',
    'portable-literal',
    'Local runtime RAG retrieval over declared local sources in the Node CLI path.',
  ),
  'rag.retrieveAsync': capabilityDescriptor(
    'rag.retrieveAsync',
    'planned',
    'async-planned',
    'host-bound',
    'Async runtime RAG retrieval through an explicit host provider; the Node CLI preview wires declared local sources through retrieveRagDocumentAsync.',
  ),
  'storage.clear': capabilityDescriptor(
    'storage.clear',
    'shipped',
    'sync',
    'host-bound',
    'Volatile in-run storage clear.',
  ),
  'storage.delete': capabilityDescriptor(
    'storage.delete',
    'shipped',
    'sync',
    'host-bound',
    'Volatile in-run storage deletion.',
  ),
  'storage.get': capabilityDescriptor('storage.get', 'shipped', 'sync', 'host-bound', 'Volatile in-run storage read.'),
  'storage.has': capabilityDescriptor(
    'storage.has',
    'shipped',
    'sync',
    'host-bound',
    'Volatile in-run storage presence check.',
  ),
  'storage.keys': capabilityDescriptor(
    'storage.keys',
    'shipped',
    'sync',
    'host-bound',
    'Volatile in-run storage key listing.',
  ),
  'storage.set': capabilityDescriptor('storage.set', 'shipped', 'sync', 'host-bound', 'Volatile in-run storage write.'),
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
  const parseResult = parseDocumentWithDiagnostics(source, undefined, options.parseOptions);
  const { root, diagnostics } = parseResult;
  const hasParseErrors = root == null || diagnostics.some((diagnostic) => diagnostic.severity === 'error');
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

  for (const node of walkNodes(root ?? { type: 'document', children: [] })) {
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

  const asyncPlannedCapabilities = requirements.filter(
    (requirement) => requirement.descriptor.syncBoundary === 'async-planned',
  );
  const executableAsyncPlannedCapabilities = executableAsyncRequirements(
    root ?? { type: 'document', children: [] },
    asyncPlannedCapabilities,
  );
  return {
    requirements,
    unknownCapabilities,
    malformedCapabilities,
    plannedCapabilities: requirements.filter((requirement) => requirement.descriptor.status === 'planned'),
    asyncPlannedCapabilities,
    executableAsyncPlannedCapabilities,
    missingProviders: provided
      ? requirements.filter(
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
    unsupportedAsyncExecutions: unsupportedAsyncExecutions(
      root ?? { type: 'document', children: [] },
      asyncPlannedCapabilities,
    ),
    unknownProvidedCapabilities,
    unknownProvidedAsyncCapabilities,
    asyncBoundaryRequired: executableAsyncPlannedCapabilities.length > 0,
    hasParseErrors,
    parseDiagnostics: diagnostics,
  };
}

export const ASYNC_SOURCE_UNSUPPORTED_CONTAINER_TYPES: ReadonlySet<string> = new Set();

function unsupportedAsyncExecutions(
  root: IRNode,
  asyncRequirements: readonly CapabilityRequirement[],
): UnsupportedAsyncCapabilityRequirement[] {
  if (asyncRequirements.length === 0) return [];
  const requirementsByLineAndId = new Map<string, CapabilityRequirement[]>();
  for (const requirement of asyncRequirements) {
    const key = `${requirement.sourceLine}:${requirement.id}`;
    const existing = requirementsByLineAndId.get(key);
    if (existing) existing.push(requirement);
    else requirementsByLineAndId.set(key, [requirement]);
  }
  const executableHandlers = findExecutableKernHandlers(root);
  const out: UnsupportedAsyncCapabilityRequirement[] = [];
  collectUnsupportedAsyncExecutions(root, executableHandlers, false, undefined, requirementsByLineAndId, out);
  return out;
}

function executableAsyncRequirements(
  root: IRNode,
  asyncRequirements: readonly CapabilityRequirement[],
): CapabilityRequirement[] {
  if (asyncRequirements.length === 0) return [];
  const requirementsByLineAndId = new Map<string, CapabilityRequirement[]>();
  for (const requirement of asyncRequirements) {
    const key = `${requirement.sourceLine}:${requirement.id}`;
    const existing = requirementsByLineAndId.get(key);
    if (existing) existing.push(requirement);
    else requirementsByLineAndId.set(key, [requirement]);
  }
  const executableHandlers = findExecutableKernHandlers(root);
  const out: CapabilityRequirement[] = [];
  collectExecutableAsyncRequirements(root, executableHandlers, false, requirementsByLineAndId, out);
  return out;
}

function collectUnsupportedAsyncExecutions(
  node: IRNode,
  executableHandlers: ReadonlySet<IRNode>,
  insideExecutableHandler: boolean,
  unsupportedContainer: IRNode | undefined,
  requirementsByLineAndId: Map<string, CapabilityRequirement[]>,
  out: UnsupportedAsyncCapabilityRequirement[],
): void {
  const nextInsideExecutableHandler = insideExecutableHandler || executableHandlers.has(node);
  const nextUnsupportedContainer =
    nextInsideExecutableHandler && ASYNC_SOURCE_UNSUPPORTED_CONTAINER_TYPES.has(node.type)
      ? node
      : unsupportedContainer;
  if (node.type === 'capability') {
    const requirement = asyncRequirementForNode(node, requirementsByLineAndId);
    if (requirement) {
      if (!nextInsideExecutableHandler) {
        out.push({ ...requirement, reason: 'outside-main-handler' });
      } else if (nextUnsupportedContainer) {
        out.push({
          ...requirement,
          reason: 'unsupported-container',
          containerType: nextUnsupportedContainer.type,
        });
      }
    }
  }
  for (const child of node.children ?? []) {
    collectUnsupportedAsyncExecutions(
      child,
      executableHandlers,
      nextInsideExecutableHandler,
      nextUnsupportedContainer,
      requirementsByLineAndId,
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

function findExecutableKernHandlers(root: IRNode): ReadonlySet<IRNode> {
  const out = new Set<IRNode>();
  const helpers = new Map<string, IRNode>();
  let mainHandler: IRNode | undefined;

  for (const node of root.children ?? []) {
    if (node.type !== 'fn') continue;
    const name = typeof node.props?.name === 'string' ? node.props.name : '';
    const handler = previewHelperHandler(node);
    if (!handler) continue;
    if (name === 'main') mainHandler = handler;
    else if (isPreviewHelperFunction(node, name)) helpers.set(name, handler);
  }
  if (!mainHandler) return out;

  out.add(mainHandler);
  const queued = [...calledHelperNames(mainHandler.children ?? [], helpers)];
  const visited = new Set<string>();
  while (queued.length > 0) {
    const name = queued.pop();
    if (!name || visited.has(name)) continue;
    visited.add(name);
    const handler = helpers.get(name);
    if (!handler) continue;
    out.add(handler);
    for (const next of calledHelperNames(handler.children ?? [], helpers)) {
      if (!visited.has(next)) queued.push(next);
    }
  }
  return out;
}

function calledHelperNames(nodes: readonly IRNode[], helpers: ReadonlyMap<string, IRNode>): Set<string> {
  const out = new Set<string>();
  for (const node of walkNodes({ type: '__block', children: [...nodes] })) {
    for (const expr of supportedHelperCallExpressions(node)) {
      collectHelperCalls(expr.node, helpers, out, expr.mode);
    }
  }
  return out;
}

type HelperCallExpressionMode = 'scalar' | 'let' | 'capabilityInput';

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
      // Ignore malformed templates here; parser/runtime diagnostics own them.
    }
  }
  return out;
}

function collectHelperCalls(
  node: ValueIR,
  helpers: ReadonlyMap<string, IRNode>,
  out: Set<string>,
  mode: HelperCallExpressionMode,
): void {
  if (node.kind === 'call' && node.callee.kind === 'ident' && helpers.has(node.callee.name)) out.add(node.callee.name);
  for (const child of valueChildren(node, helpers, mode)) collectHelperCalls(child.node, helpers, out, child.mode);
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
    case 'index':
      return [];
    case 'call':
      if (node.callee.kind === 'ident' && (helpers.has(node.callee.name) || node.callee.name === 'String')) {
        return node.args.map((arg) => ({ node: arg, mode: 'scalar' }));
      }
      return [];
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
  notes: string,
): CapabilityDescriptor {
  const parts = id.split('.');
  if (parts.length !== 2) {
    throw new Error(`Capability descriptor id '${id}' must have exactly one namespace separator.`);
  }
  const [namespace, operation] = parts;
  return Object.freeze({ id, namespace, operation, status, syncBoundary, inputShape, notes });
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
  if (typeof value !== 'string') return { issue: `capability ${key} must be a string` };
  if (!isCapabilityToken(value)) return { issue: `capability ${key} '${value}' must match the runner token grammar` };
  return { value };
}

function isCapabilityToken(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}
