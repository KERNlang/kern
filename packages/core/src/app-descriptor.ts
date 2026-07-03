import { parseDocumentWithDiagnostics } from './parser.js';
import { resolveKernEntryHandler } from './runner.js';
import { analyzeKernSourceCapabilities, CAPABILITY_DESCRIPTORS, type CapabilityId } from './runner-capability-plan.js';
import { validateSchema } from './schema.js';
import type { IRNode } from './types.js';

export class KernAppDescriptorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernAppDescriptorError';
  }
}

export interface KernAppDescriptorSourceLoaderContext {
  readonly entry: KernAppEntryDescriptor;
}

export interface LoadKernAppDescriptorOptions {
  readonly appRoot?: string;
  /**
   * Optional host canonicalizer for realpath-style containment checks. Core
   * performs lexical path checks by default; Node hosts should provide this so
   * symlinks and junctions cannot escape appRoot before readSource runs.
   */
  readonly canonicalizePath?: (path: string) => string | Promise<string>;
  /**
   * Legacy parser-only opt-in for callers that do not read source content.
   * Hosts that provide readSource must also provide canonicalizePath.
   */
  readonly allowLexicalSourcePaths?: boolean;
  readonly readSource?: (
    sourcePath: string,
    context: KernAppDescriptorSourceLoaderContext,
  ) => string | undefined | Promise<string | undefined>;
}

/**
 * Policy-slot guard execution.
 *
 * A `policy` node MAY declare `slot=pre|post` to become an EXECUTABLE policy
 * that runs before (`pre`) or after (`post`) the route/view handler. In 5.2
 * slot policies must use one of the executable guard kinds
 * (`passthrough`, `auth`, `hmacSignature`, `rag-review`). Slot policies may
 * optionally reference their own `.kern` source (`source=` + `handler=`),
 * which is resolved inside the app root and validated fail-closed at load
 * time exactly like entry sources. Policies WITHOUT `slot=` remain the
 * declarative-only policies shipped in 5.0 (free-form `kind`, no execution).
 */
export type KernAppPolicySlot = 'pre' | 'post';
export const KERN_APP_POLICY_EXECUTABLE_KINDS = Object.freeze([
  'passthrough',
  'auth',
  'hmacSignature',
  'rag-review',
] as const);
export type KernAppExecutablePolicyKind = (typeof KERN_APP_POLICY_EXECUTABLE_KINDS)[number];
const KERN_APP_POLICY_EXECUTABLE_KIND_SET: ReadonlySet<string> = new Set(KERN_APP_POLICY_EXECUTABLE_KINDS);

export interface KernAppAuthPolicyPlan {
  readonly verifierRef: string;
  readonly credentialHeader: string;
}

export interface KernAppHmacSignaturePolicyPlan {
  readonly keyRef: string;
  readonly algorithm: string;
  readonly signatureHeader: string;
  readonly encoding: 'hex' | 'base64';
  readonly prefix?: string;
}

export interface KernAppRagReviewPolicyPlan {
  readonly queryField: string;
  readonly answerField: string;
  readonly citedChunkIdsField: string;
  readonly groundingSpansField: string;
  readonly minGroundingCoverage: number;
}

export type KernAppPolicySlotPlan =
  | { readonly kind: 'passthrough' }
  | ({ readonly kind: 'auth' } & KernAppAuthPolicyPlan)
  | ({ readonly kind: 'hmacSignature' } & KernAppHmacSignaturePolicyPlan)
  | ({ readonly kind: 'rag-review' } & KernAppRagReviewPolicyPlan);

export interface KernAppPolicySlotDescriptor {
  readonly node: IRNode;
  readonly name: string;
  readonly slot: KernAppPolicySlot;
  readonly kind: KernAppExecutablePolicyKind;
  /** Optional policy handler source, resolved inside the app root. */
  readonly sourcePath?: string;
  /** Handler name inside sourcePath; only meaningful when sourcePath is set. */
  readonly handler: string;
  readonly requires: readonly CapabilityId[];
  readonly plan: KernAppPolicySlotPlan;
  readonly label: string;
}

/** One executed policy hook record returned by {@link executeKernAppEntryPolicySlot}. */
export interface KernAppPolicyExecution {
  readonly name: string;
  readonly slot: KernAppPolicySlot;
  readonly kind: KernAppExecutablePolicyKind;
  readonly action: 'passthrough' | 'allow' | 'deny';
  readonly status?: number;
  readonly body?: unknown;
  readonly diagnostics?: readonly string[];
}

export interface KernAppRetrievedChunk {
  readonly id: string;
  readonly text: string;
  readonly score?: number;
  readonly source?: string;
  readonly citation?: { readonly uri?: string; readonly locator?: string };
  readonly metadata?: Record<string, unknown>;
}

export interface KernAppPolicyRequestFacts {
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly rawBody?: string | Uint8Array;
  readonly authVerifiers?: Readonly<
    Record<
      string,
      | ((credential: string, context: { readonly entry: KernAppEntryDescriptor }) => boolean | Promise<boolean>)
      | undefined
    >
  >;
  readonly hmacVerifiers?: Readonly<
    Record<
      string,
      | ((
          input: {
            readonly body: string | Uint8Array;
            readonly signature: string;
            readonly algorithm: string;
            readonly encoding: 'hex' | 'base64';
            readonly prefix?: string;
          },
          context: { readonly entry: KernAppEntryDescriptor },
        ) => boolean | Promise<boolean>)
      | undefined
    >
  >;
  readonly hmacKeys?: Readonly<Record<string, string | Uint8Array | undefined>>;
  readonly ragReview?: {
    readonly query?: string;
    readonly answer?: string;
    readonly citedChunkIds?: readonly string[];
    readonly groundingSpans?: readonly {
      readonly start: number;
      readonly end: number;
      readonly chunkIds: readonly string[];
    }[];
    readonly retrievedChunks?: readonly KernAppRetrievedChunk[];
    readonly retrievalError?: string;
  };
}

export interface KernAppEntryDescriptor {
  readonly node: IRNode;
  readonly kind: 'view' | 'route';
  readonly name: string;
  readonly path: string;
  readonly sourcePath: string;
  readonly handler: string;
  readonly policies: readonly IRNode[];
  readonly policyName?: string;
  /** Executable policies to run BEFORE the entry handler. */
  readonly prePolicies: readonly KernAppPolicySlotDescriptor[];
  /** Executable policies to run AFTER the entry handler. */
  readonly postPolicies: readonly KernAppPolicySlotDescriptor[];
  readonly appCapabilities: readonly CapabilityId[];
  readonly entryCapabilities: readonly CapabilityId[];
  readonly policyCapabilities: readonly CapabilityId[];
  readonly declaredCapabilities: readonly CapabilityId[];
  readonly requiredCapabilities: readonly CapabilityId[];
  readonly requiredSyncCapabilities: readonly CapabilityId[];
  readonly requiredAsyncCapabilities: readonly CapabilityId[];
  readonly label: string;
}

export interface KernAppRouteDescriptor extends KernAppEntryDescriptor {
  readonly kind: 'route';
  readonly method: string;
  readonly key: string;
  readonly response?: string;
}

export interface KernAppViewDescriptor extends KernAppEntryDescriptor {
  readonly kind: 'view';
}

export interface KernAppDescriptor {
  readonly app: IRNode;
  readonly policies: readonly IRNode[];
  readonly views: readonly KernAppViewDescriptor[];
  readonly routes: readonly KernAppRouteDescriptor[];
}

function requiredStringProp(node: IRNode, prop: string, label: string): string {
  const value = node.props?.[prop];
  if (typeof value !== 'string' || !value.trim()) {
    throw new KernAppDescriptorError(`${label} must declare ${prop}=`);
  }
  return value.trim();
}

function optionalStringProp(node: IRNode, prop: string): string | undefined {
  const value = node.props?.[prop];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumberProp(node: IRNode, prop: string, fallback: number): number {
  const value = node.props?.[prop];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function normalizeHeaderName(name: string, label: string): string {
  const trimmed = name.trim();
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(trimmed)) {
    throw new KernAppDescriptorError(`${label} declares invalid HTTP header '${name}'`);
  }
  return trimmed.toLowerCase();
}

function headerListProp(node: IRNode, prop: string, label: string): readonly string[] {
  const raw = optionalStringProp(node, prop);
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((item) => normalizeHeaderName(item, label))
    .filter(Boolean);
}

function capabilityList(raw: string | undefined, label: string): CapabilityId[] {
  if (raw === undefined) return [];
  const out: CapabilityId[] = [];
  for (const id of raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)) {
    if (!Object.hasOwn(CAPABILITY_DESCRIPTORS, id)) {
      throw new KernAppDescriptorError(`${label} declares unknown capability ${id}`);
    }
    out.push(id as CapabilityId);
  }
  return out;
}

function uniqueCapabilities(ids: readonly CapabilityId[]): CapabilityId[] {
  return [...new Set(ids)];
}

function policySlotPlan(policy: IRNode, kind: KernAppExecutablePolicyKind, label: string): KernAppPolicySlotPlan {
  if (kind === 'passthrough') return { kind };
  if (kind === 'auth') {
    return {
      kind,
      verifierRef: optionalStringProp(policy, 'verifierRef') ?? optionalStringProp(policy, 'ref') ?? 'default',
      credentialHeader: normalizeHeaderName(optionalStringProp(policy, 'credentialHeader') ?? 'authorization', label),
    };
  }
  if (kind === 'hmacSignature') {
    const encoding = optionalStringProp(policy, 'encoding') ?? 'hex';
    if (encoding !== 'hex' && encoding !== 'base64') {
      throw new KernAppDescriptorError(`${label} hmacSignature encoding must be hex or base64`);
    }
    return {
      kind,
      keyRef: optionalStringProp(policy, 'keyRef') ?? 'default',
      algorithm: optionalStringProp(policy, 'algorithm') ?? 'sha256',
      signatureHeader: normalizeHeaderName(optionalStringProp(policy, 'signatureHeader') ?? 'x-signature', label),
      encoding,
      ...(optionalStringProp(policy, 'prefix') ? { prefix: optionalStringProp(policy, 'prefix') } : {}),
    };
  }
  const minGroundingCoverage = optionalNumberProp(policy, 'minGroundingCoverage', 1);
  // A coverage threshold outside [0, 1] is either a malformed config (e.g. a
  // stray percentage like 80) or — critically — a NEGATIVE value, which
  // silently disables the check entirely (evaluatePolicyRagReview's
  // `coverage < minGroundingCoverage` is never true when the RHS is
  // negative). Fail the manifest load instead of shipping a guard that can
  // never deny on ungrounded coverage.
  if (!(minGroundingCoverage >= 0 && minGroundingCoverage <= 1)) {
    throw new KernAppDescriptorError(`${label} minGroundingCoverage must be between 0 and 1`);
  }
  return {
    kind,
    queryField: optionalStringProp(policy, 'queryField') ?? 'query',
    answerField: optionalStringProp(policy, 'answerField') ?? 'answer',
    citedChunkIdsField: optionalStringProp(policy, 'citedChunkIdsField') ?? 'citedChunkIds',
    groundingSpansField: optionalStringProp(policy, 'groundingSpansField') ?? 'groundingSpans',
    minGroundingCoverage,
  };
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function splitCapabilityBoundaries(ids: readonly CapabilityId[]): {
  sync: CapabilityId[];
  async: CapabilityId[];
} {
  const sync: CapabilityId[] = [];
  const async: CapabilityId[] = [];
  for (const id of ids) {
    const descriptor = CAPABILITY_DESCRIPTORS[id];
    if (descriptor.syncBoundary === 'async-planned') async.push(id);
    else sync.push(id);
  }
  return { sync, async };
}

function manifestEntryCapabilityRequirements(
  app: IRNode,
  node: IRNode,
  policies: readonly IRNode[],
  label: string,
): {
  appCapabilities: CapabilityId[];
  entryCapabilities: CapabilityId[];
  policyCapabilities: CapabilityId[];
  declaredCapabilities: CapabilityId[];
} {
  const appCapabilities = capabilityList(optionalStringProp(app, 'requires'), 'app');
  const entryCapabilities = capabilityList(optionalStringProp(node, 'requires'), label);
  const policyCapabilities = uniqueCapabilities(
    policies.flatMap((policy) =>
      capabilityList(optionalStringProp(policy, 'requires'), `policy ${optionalStringProp(policy, 'name')}`),
    ),
  );
  return {
    appCapabilities,
    entryCapabilities,
    policyCapabilities,
    declaredCapabilities: uniqueCapabilities([...appCapabilities, ...entryCapabilities, ...policyCapabilities]),
  };
}

function normalizeAppRoot(appRoot: string | undefined): string {
  const root = normalizePath(appRoot?.trim() ? appRoot : '.');
  if (root === '..' || root.startsWith('../')) {
    throw new KernAppDescriptorError('app root must not escape its containing directory');
  }
  return root === '' ? '.' : root;
}

function normalizePath(path: string): string {
  const normalizedSeparators = path.replace(/\\/g, '/');
  const driveMatch = /^([A-Za-z]:)(?:\/|$)/.exec(normalizedSeparators);
  const drivePrefix = driveMatch?.[1].toLowerCase();
  const absolute = normalizedSeparators.startsWith('/') || Boolean(drivePrefix);
  const parts: string[] = [];
  for (const part of normalizedSeparators.split('/')) {
    if (part === '' || part === '.') continue;
    if (drivePrefix && part.toLowerCase() === drivePrefix) {
      if (parts.length === 0) parts.push(drivePrefix);
      continue;
    }
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..' && parts[parts.length - 1] !== drivePrefix) {
        parts.pop();
      } else if (!absolute) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }
  const normalized = parts.join('/');
  if (drivePrefix) return parts.length === 1 ? `${normalized}/` : normalized;
  if (absolute) return `/${normalized}`;
  return normalized;
}

function isInsidePath(root: string, candidate: string): boolean {
  if (root === '.') return !candidate.startsWith('..');
  if (root === '/') return candidate.startsWith('/');
  const rootForCompare = root.match(/^[a-z]:\//i) ? root.toLowerCase() : root;
  const candidateForCompare = candidate.match(/^[a-z]:\//i) ? candidate.toLowerCase() : candidate;
  if (/^[a-z]:\/$/i.test(rootForCompare)) {
    return candidateForCompare === rootForCompare || candidateForCompare.startsWith(rootForCompare);
  }
  return candidateForCompare === rootForCompare || candidateForCompare.startsWith(`${rootForCompare}/`);
}

function resolveAppSource(source: string, label: string, appRoot: string): string {
  if (!source.startsWith('./')) {
    throw new KernAppDescriptorError(`${label} source must be relative to the app directory`);
  }
  const resolved = normalizePath(`${appRoot}/${source}`);
  if (!isInsidePath(appRoot, resolved)) {
    throw new KernAppDescriptorError(`${label} source must stay inside the app directory`);
  }
  return resolved;
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new KernAppDescriptorError(`app manifest declares duplicate ${label} ${value}`);
    seen.add(value);
  }
}

/**
 * Fail-closed parse of a policy node's OPTIONAL execution-slot declaration.
 * Returns undefined for declarative-only policies (no `slot=`). Throws for:
 * an unknown slot value, a slot policy whose kind is not executable,
 * `handler=` without `source=`, or a slot policy source that escapes the app
 * root.
 */
function policySlotDescriptor(policy: IRNode, appRoot: string): KernAppPolicySlotDescriptor | undefined {
  const name = requiredStringProp(policy, 'name', 'policy');
  const label = `policy ${name}`;
  const slot = optionalStringProp(policy, 'slot');
  const source = optionalStringProp(policy, 'source');
  const handler = optionalStringProp(policy, 'handler');
  if (slot === undefined) {
    if (source !== undefined || handler !== undefined) {
      throw new KernAppDescriptorError(
        `${label} declares source/handler without slot=; executable policies must declare slot=pre or slot=post`,
      );
    }
    return undefined;
  }
  if (slot !== 'pre' && slot !== 'post') {
    throw new KernAppDescriptorError(`${label} declares unknown slot '${slot}' (expected pre or post)`);
  }
  const kind = optionalStringProp(policy, 'kind');
  if (kind === undefined || !KERN_APP_POLICY_EXECUTABLE_KIND_SET.has(kind)) {
    throw new KernAppDescriptorError(
      `${label} slot=${slot} requires an executable kind${
        kind !== undefined ? `, got '${kind}'` : ''
      }; executable kinds: ${KERN_APP_POLICY_EXECUTABLE_KINDS.join(', ')}`,
    );
  }
  const executableKind = kind as KernAppExecutablePolicyKind;
  const plan = policySlotPlan(policy, executableKind, label);
  if (handler !== undefined && source === undefined) {
    throw new KernAppDescriptorError(`${label} declares handler= without source=`);
  }
  const failureStatusRaw = policy.props?.failureStatus;
  if (failureStatusRaw !== undefined) {
    const failureStatusNumber = typeof failureStatusRaw === 'number' ? failureStatusRaw : Number(failureStatusRaw);
    if (!Number.isInteger(failureStatusNumber) || failureStatusNumber < 100 || failureStatusNumber > 599) {
      throw new KernAppDescriptorError(`${label} failureStatus must be a valid HTTP status code`);
    }
  }
  return {
    node: policy,
    name,
    slot,
    kind: executableKind,
    ...(source !== undefined ? { sourcePath: resolveAppSource(source, label, appRoot) } : {}),
    handler: handler ?? 'main',
    requires: capabilityList(optionalStringProp(policy, 'requires'), label),
    plan,
    label,
  };
}

function normalizeManifestEntry(
  app: IRNode,
  node: IRNode,
  kind: 'view' | 'route',
  policies: readonly IRNode[],
  policySlotsByName: ReadonlyMap<string, KernAppPolicySlotDescriptor>,
  appRoot: string,
): KernAppEntryDescriptor {
  const explicitName = optionalStringProp(node, 'name');
  const path = requiredStringProp(node, 'path', explicitName ? `${kind} ${explicitName}` : kind);
  const name = explicitName ?? `${kind}:${path}`;
  const source = requiredStringProp(node, 'source', `${kind} ${name}`);
  const handler = optionalStringProp(node, 'handler') ?? 'main';
  const policyName = optionalStringProp(node, 'policy');
  const matchedPolicies = policyName ? policies.filter((policy) => policy.props?.name === policyName) : [];
  if (policyName && matchedPolicies.length !== 1) {
    throw new KernAppDescriptorError(`${kind} ${name} references unknown policy ${policyName}`);
  }
  const label = `${kind} ${name}`;
  const requirements = manifestEntryCapabilityRequirements(app, node, matchedPolicies, label);
  const { sync, async } = splitCapabilityBoundaries(requirements.declaredCapabilities);
  const matchedSlotPolicies = matchedPolicies
    .map((policy) => policySlotsByName.get(String(policy.props?.name ?? '')))
    .filter((slotPolicy): slotPolicy is KernAppPolicySlotDescriptor => slotPolicy !== undefined);
  return {
    node,
    kind,
    name,
    path,
    sourcePath: resolveAppSource(source, `${kind} ${name}`, appRoot),
    handler,
    policies: matchedPolicies,
    policyName,
    prePolicies: matchedSlotPolicies.filter((slotPolicy) => slotPolicy.slot === 'pre'),
    postPolicies: matchedSlotPolicies.filter((slotPolicy) => slotPolicy.slot === 'post'),
    appCapabilities: requirements.appCapabilities,
    entryCapabilities: requirements.entryCapabilities,
    policyCapabilities: requirements.policyCapabilities,
    declaredCapabilities: requirements.declaredCapabilities,
    requiredCapabilities: requirements.declaredCapabilities,
    requiredSyncCapabilities: sync,
    requiredAsyncCapabilities: async,
    label,
  };
}

async function assertEntrySourceContract(entry: KernAppEntryDescriptor, source: string): Promise<void> {
  const { root, diagnostics } = parseDocumentWithDiagnostics(source);
  const firstParseError = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (firstParseError || !root) {
    throw new KernAppDescriptorError(firstParseError?.message ?? `${entry.label} source has parse errors`);
  }
  try {
    resolveKernEntryHandler(root, entry);
  } catch (error) {
    throw new KernAppDescriptorError(error instanceof Error ? error.message : String(error));
  }
  const analysis = analyzeKernSourceCapabilities(source, {
    entryHandlerName: entry.handler,
    providedCapabilities: entry.requiredSyncCapabilities,
    providedAsyncCapabilities: entry.requiredAsyncCapabilities,
  });
  const firstError = analysis.parseDiagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (firstError || analysis.hasParseErrors) {
    throw new KernAppDescriptorError(firstError?.message ?? `${entry.label} source has parse errors`);
  }
  if (analysis.malformedCapabilities.length > 0 || analysis.unknownCapabilities.length > 0) {
    throw new KernAppDescriptorError(`${entry.label} source has malformed or unknown capability declarations`);
  }
  const executableRequirementIds = new Set(analysis.executableRequirements.map((requirement) => requirement.id));
  const undeclared = [...executableRequirementIds].filter((id) => !entry.declaredCapabilities.includes(id));
  if (undeclared.length > 0) {
    throw new KernAppDescriptorError(`${entry.label} uses undeclared capabilities: ${undeclared.join(', ')}`);
  }
  const unsupportedEntryAsyncExecutions = analysis.unsupportedAsyncExecutions.filter(
    (requirement) => requirement.reason !== 'outside-main',
  );
  if (unsupportedEntryAsyncExecutions.length > 0) {
    throw new KernAppDescriptorError(
      `${entry.label} bad async: ${uniqueCapabilities(
        unsupportedEntryAsyncExecutions.map((requirement) => requirement.id),
      ).join(', ')}`,
    );
  }
  if (entry.kind === 'view' && analysis.executableAsyncPlannedCapabilities.length > 0) {
    throw new KernAppDescriptorError(
      `${entry.label} uses async-only capabilities: ${uniqueCapabilities(
        analysis.executableAsyncPlannedCapabilities.map((requirement) => requirement.id),
      ).join(', ')}`,
    );
  }
  const unusedPolicyRequirements = uniqueCapabilities(
    entry.policyCapabilities.filter((id) => !executableRequirementIds.has(id)),
  );
  if (unusedPolicyRequirements.length > 0) {
    throw new KernAppDescriptorError(
      `${entry.label} does not enforce policy capabilities: ${unusedPolicyRequirements.join(', ')}`,
    );
  }
  const unusedEntryRequirements = uniqueCapabilities(
    entry.entryCapabilities
      .filter((id) => !entry.policyCapabilities.includes(id))
      .filter((id) => !executableRequirementIds.has(id)),
  );
  if (unusedEntryRequirements.length > 0) {
    throw new KernAppDescriptorError(
      `${entry.label} declares unused capabilities: ${unusedEntryRequirements.join(', ')}`,
    );
  }
}

async function canonicalizeEntries(
  entries: readonly KernAppEntryDescriptor[],
  appRoot: string,
  canonicalizePath: LoadKernAppDescriptorOptions['canonicalizePath'],
): Promise<readonly KernAppEntryDescriptor[]> {
  if (!canonicalizePath) return entries;
  const canonicalize = canonicalizePath;
  const canonicalAppRoot = normalizePath(await canonicalize(appRoot));
  async function canonicalizeSourcePath(rawSourcePath: string, label: string): Promise<string> {
    let sourcePath: string;
    try {
      sourcePath = normalizePath(await canonicalize(rawSourcePath));
    } catch {
      throw new KernAppDescriptorError(`${label} source does not exist`);
    }
    if (!isInsidePath(canonicalAppRoot, sourcePath)) {
      throw new KernAppDescriptorError(`${label} source must stay inside the app directory`);
    }
    return sourcePath;
  }
  return Promise.all(
    entries.map(async (entry) => {
      const sourcePath = await canonicalizeSourcePath(entry.sourcePath, entry.label);
      async function canonicalizeSlotPolicies(
        slotPolicies: readonly KernAppPolicySlotDescriptor[],
      ): Promise<readonly KernAppPolicySlotDescriptor[]> {
        return Promise.all(
          slotPolicies.map(async (slotPolicy) =>
            slotPolicy.sourcePath === undefined
              ? slotPolicy
              : { ...slotPolicy, sourcePath: await canonicalizeSourcePath(slotPolicy.sourcePath, slotPolicy.label) },
          ),
        );
      }
      return {
        ...entry,
        sourcePath,
        prePolicies: await canonicalizeSlotPolicies(entry.prePolicies),
        postPolicies: await canonicalizeSlotPolicies(entry.postPolicies),
      };
    }),
  );
}

/**
 * Fail-closed validation of an executable slot policy's optional handler
 * source: it must exist, parse, and contain the referenced handler. 5.2
 * intentionally validates SHAPE only (parse + handler resolution) — guard
 * semantics, capability analysis, and execution of the policy body arrive
 * with the real guard kinds in 5.3.
 */
async function validatePolicySlotSources(
  entries: readonly KernAppEntryDescriptor[],
  readSource: LoadKernAppDescriptorOptions['readSource'],
  entryByLabel: ReadonlyMap<string, KernAppEntryDescriptor>,
): Promise<void> {
  if (!readSource) return;
  const validated = new Set<string>();
  for (const entry of entries) {
    for (const slotPolicy of [...entry.prePolicies, ...entry.postPolicies]) {
      if (slotPolicy.sourcePath === undefined) continue;
      const key = `${slotPolicy.sourcePath}:${slotPolicy.handler}`;
      if (validated.has(key)) continue;
      validated.add(key);
      let source: string | undefined;
      try {
        source = await readSource(slotPolicy.sourcePath, { entry: entryByLabel.get(entry.label) ?? entry });
      } catch {
        throw new KernAppDescriptorError(`${slotPolicy.label} source does not exist`);
      }
      if (source === undefined) throw new KernAppDescriptorError(`${slotPolicy.label} source does not exist`);
      const { root, diagnostics } = parseDocumentWithDiagnostics(source);
      const firstParseError = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
      if (firstParseError || !root) {
        throw new KernAppDescriptorError(firstParseError?.message ?? `${slotPolicy.label} source has parse errors`);
      }
      try {
        resolveKernEntryHandler(root, { handler: slotPolicy.handler, label: slotPolicy.label });
      } catch (error) {
        throw new KernAppDescriptorError(error instanceof Error ? error.message : String(error));
      }
      const analysis = analyzeKernSourceCapabilities(source, {
        entryHandlerName: slotPolicy.handler,
        providedCapabilities: slotPolicy.requires,
      });
      // Fail-closed on parse/capability-shape problems in the guard source
      // itself — mirrors assertEntrySourceContract's entry-source gate.
      // Without this, a policy handler with a malformed or unknown capability
      // declaration (or unparseable source) silently passed validation here
      // while the same defect fails a route/view entry's load.
      const firstAnalysisError = analysis.parseDiagnostics.find((diagnostic) => diagnostic.severity === 'error');
      if (firstAnalysisError || analysis.hasParseErrors) {
        throw new KernAppDescriptorError(firstAnalysisError?.message ?? `${slotPolicy.label} source has parse errors`);
      }
      if (analysis.malformedCapabilities.length > 0 || analysis.unknownCapabilities.length > 0) {
        throw new KernAppDescriptorError(`${slotPolicy.label} source has malformed or unknown capability declarations`);
      }
      // The header allowlist is derived from the NORMALIZED plan (which already
      // folds in the kind-specific default — 'authorization' for auth,
      // 'x-signature' for hmacSignature) rather than only an explicit node prop.
      // A guard that reads the default header via app-http.header(...) with no
      // credentialHeader=/signatureHeader= override previously failed load-time
      // validation as an "undeclared" header even though it is exactly the
      // header the plan will check at runtime.
      const allowedHeaders = new Set(headerListProp(slotPolicy.node, 'headers', slotPolicy.label));
      if (slotPolicy.plan.kind === 'auth') {
        allowedHeaders.add(slotPolicy.plan.credentialHeader);
      }
      if (slotPolicy.plan.kind === 'hmacSignature') {
        allowedHeaders.add(slotPolicy.plan.signatureHeader);
      }
      const sourceLines = source.split(/\r?\n/);
      for (const requirement of [...analysis.requirements, ...analysis.executableRequirements]) {
        if (requirement.id !== 'app-http.header') continue;
        const headerName =
          headerNameFromCapabilityInput(requirement.literalInput) ??
          headerNameFromCapabilityLine(sourceLines[requirement.sourceLine - 1]);
        if (!headerName || !allowedHeaders.has(normalizeHeaderName(headerName, slotPolicy.label))) {
          throw new KernAppDescriptorError(
            `${slotPolicy.label} reads undeclared HTTP header${headerName ? ` '${headerName}'` : ''}`,
          );
        }
      }
      const forbidden = analysis.executableRequirements.find(
        (requirement) => requirement.id === 'crypto.hmacVerify' || requirement.id === 'app-auth.verifyCredential',
      );
      if (forbidden) {
        throw new KernAppDescriptorError(
          `${slotPolicy.label} must not call ${forbidden.id} from guard source; host adapters own secret verification`,
        );
      }
    }
  }
}

function headerNameFromCapabilityInput(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const named = /\bname\s*:\s*["']([^"']+)["']/.exec(input);
  if (named) return named[1];
  const direct = /^\s*["']([^"']+)["']\s*$/.exec(input);
  return direct?.[1];
}

function headerNameFromCapabilityLine(line: string | undefined): string | undefined {
  if (!line) return undefined;
  return /\binput\s*=\s*"[^"]*\bname\s*:\s*\\?["']([^\\"']+)\\?["']/.exec(line)?.[1];
}

async function validateEntrySources(
  entries: readonly KernAppEntryDescriptor[],
  readSource: LoadKernAppDescriptorOptions['readSource'],
): Promise<void> {
  if (!readSource) return;
  for (const entry of entries) {
    let source: string | undefined;
    try {
      source = await readSource(entry.sourcePath, { entry });
    } catch {
      throw new KernAppDescriptorError(`${entry.label} source does not exist`);
    }
    if (source === undefined) throw new KernAppDescriptorError(`${entry.label} source does not exist`);
    await assertEntrySourceContract(entry, source);
  }
  await validatePolicySlotSources(entries, readSource, new Map(entries.map((entry) => [entry.label, entry])));
}

export async function loadKernAppDescriptor(
  manifestSource: string,
  options: LoadKernAppDescriptorOptions = {},
): Promise<KernAppDescriptor> {
  const appRoot = normalizeAppRoot(options.appRoot);
  if (options.readSource && !options.canonicalizePath) {
    throw new KernAppDescriptorError('readSource requires canonicalizePath');
  }
  const { root, diagnostics } = parseDocumentWithDiagnostics(manifestSource);
  if (!root) throw new KernAppDescriptorError('app manifest did not parse to a document root');
  const firstError = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (firstError) throw new KernAppDescriptorError(firstError.message);
  const firstSchemaViolation = validateSchema(root)[0];
  if (firstSchemaViolation) throw new KernAppDescriptorError(firstSchemaViolation.message);

  const apps = (root.children ?? []).filter((node) => node.type === 'app');
  if (apps.length !== 1) {
    throw new KernAppDescriptorError(`app manifest must declare exactly one app, found ${apps.length}`);
  }
  const app = apps[0];
  requiredStringProp(app, 'name', 'app');
  const policies = (app.children ?? []).filter((node) => node.type === 'policy');
  assertUnique(
    policies.map((policy) => requiredStringProp(policy, 'name', 'policy')),
    'policy',
  );
  // Validate every policy's slot declaration up front — a malformed slot
  // policy fails the whole manifest load even if no route references it yet.
  const policySlotsByName = new Map<string, KernAppPolicySlotDescriptor>();
  for (const policy of policies) {
    const slotDescriptor = policySlotDescriptor(policy, appRoot);
    if (slotDescriptor) policySlotsByName.set(slotDescriptor.name, slotDescriptor);
  }

  const views = (app.children ?? [])
    .filter((node) => node.type === 'view')
    .map(
      (node) =>
        normalizeManifestEntry(app, node, 'view', policies, policySlotsByName, appRoot) as KernAppViewDescriptor,
    );
  const routes = (app.children ?? [])
    .filter((node) => node.type === 'route')
    .map((node): KernAppRouteDescriptor => {
      const entry = normalizeManifestEntry(app, node, 'route', policies, policySlotsByName, appRoot);
      const method = optionalStringProp(node, 'method') ?? 'get';
      return {
        ...entry,
        kind: 'route',
        method,
        key: routeKey(method, entry.path),
        response: optionalStringProp(node, 'response'),
      };
    });
  assertUnique(
    views.map((view) => view.path),
    'view path',
  );
  assertUnique(
    routes.map((route) => route.key),
    'route',
  );
  const canonicalEntries = await canonicalizeEntries([...views, ...routes], appRoot, options.canonicalizePath);
  const canonicalViews = canonicalEntries.filter((entry): entry is KernAppViewDescriptor => entry.kind === 'view');
  const canonicalRoutes = canonicalEntries.filter((entry): entry is KernAppRouteDescriptor => entry.kind === 'route');
  await validateEntrySources(canonicalEntries, options.readSource);
  return Object.freeze({ app, policies, views: canonicalViews, routes: canonicalRoutes });
}

export function findMissingKernAppEntryCapability(
  entry: KernAppEntryDescriptor,
  providedCapabilities: readonly string[],
  providedAsyncCapabilities: readonly string[],
): CapabilityId | undefined {
  const providedSync = new Set(providedCapabilities);
  const providedAsync = new Set(providedAsyncCapabilities);
  return (
    entry.requiredSyncCapabilities.find((capability) => !providedSync.has(capability)) ??
    entry.requiredAsyncCapabilities.find((capability) => !providedAsync.has(capability))
  );
}

/**
 * Policy-slot execution hook. Hosts call this around entry execution: `pre`
 * before running the entry handler, `post` after a successful run.
 * Fail-closed: an unknown slot value or policy execution failure returns or
 * throws explicitly instead of being silently skipped.
 */
export async function executeKernAppEntryPolicySlot(
  entry: KernAppEntryDescriptor,
  slot: KernAppPolicySlot,
  facts: KernAppPolicyRequestFacts = {},
): Promise<readonly KernAppPolicyExecution[]> {
  const slotPolicies = slot === 'pre' ? entry.prePolicies : slot === 'post' ? entry.postPolicies : undefined;
  if (slotPolicies === undefined) {
    throw new KernAppDescriptorError(`unknown policy slot '${String(slot)}' (expected pre or post)`);
  }
  const executions: KernAppPolicyExecution[] = [];
  for (const slotPolicy of slotPolicies) {
    const result = await executePolicySlotPlan(entry, slotPolicy, facts);
    executions.push(result);
    if (result.action === 'deny') break;
  }
  return executions;
}

function denied(
  slotPolicy: KernAppPolicySlotDescriptor,
  slot: KernAppPolicySlot,
  diagnostics: readonly string[] = [],
): KernAppPolicyExecution {
  return {
    name: slotPolicy.name,
    slot,
    kind: slotPolicy.kind,
    action: 'deny',
    status: policyFailureStatus(slotPolicy),
    body: { error: 'policy_denied', policy: slotPolicy.name, kind: slotPolicy.kind },
    diagnostics,
  };
}

/**
 * A policy MAY declare `failureStatus=<code>` (schema-documented, e.g.
 * `failureStatus=422`) to override the default 401 deny status. Read
 * defensively off `node.props` rather than a dedicated descriptor field so
 * this works uniformly across the real `KernAppPolicySlotDescriptor` built by
 * `policySlotDescriptor` (validated at manifest-load time) AND the literal
 * descriptor objects the Express/FastAPI emitters bake directly into
 * generated route code (same `node.props` shape, no load-time validation
 * pass) — the runtime honors whatever value is present and falls back to 401
 * on anything malformed instead of throwing.
 */
function policyFailureStatus(slotPolicy: KernAppPolicySlotDescriptor): number {
  const raw = slotPolicy.node?.props?.failureStatus;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : 401;
}

async function executePolicySlotPlan(
  entry: KernAppEntryDescriptor,
  slotPolicy: KernAppPolicySlotDescriptor,
  facts: KernAppPolicyRequestFacts,
): Promise<KernAppPolicyExecution> {
  const slot = slotPolicy.slot;
  try {
    if (slotPolicy.plan.kind === 'passthrough') {
      return { name: slotPolicy.name, slot, kind: slotPolicy.kind, action: 'passthrough' };
    }
    if (slotPolicy.plan.kind === 'auth') {
      const credential = headerValue(facts.headers, slotPolicy.plan.credentialHeader);
      const verifier = facts.authVerifiers?.[slotPolicy.plan.verifierRef];
      if (!credential || typeof verifier !== 'function')
        return denied(slotPolicy, slot, ['auth credential absent or verifier missing']);
      const ok = await verifier(credential, { entry });
      return ok
        ? { name: slotPolicy.name, slot, kind: slotPolicy.kind, action: 'allow' }
        : denied(slotPolicy, slot, ['auth verifier denied']);
    }
    if (slotPolicy.plan.kind === 'hmacSignature') {
      const signature = headerValue(facts.headers, slotPolicy.plan.signatureHeader);
      const verifier = facts.hmacVerifiers?.[slotPolicy.plan.keyRef];
      if (!signature || typeof verifier !== 'function' || facts.rawBody === undefined) {
        return denied(slotPolicy, slot, ['hmac signature, verifier, or raw body missing']);
      }
      const ok = await verifier(
        {
          signature,
          body: facts.rawBody,
          algorithm: slotPolicy.plan.algorithm,
          encoding: slotPolicy.plan.encoding,
          prefix: slotPolicy.plan.prefix,
        },
        { entry },
      );
      return ok
        ? { name: slotPolicy.name, slot, kind: slotPolicy.kind, action: 'allow' }
        : denied(slotPolicy, slot, ['hmac signature mismatch']);
    }
    return executeRagReview(slotPolicy, facts);
  } catch (error) {
    return denied(slotPolicy, slot, [error instanceof Error ? error.message : String(error)]);
  }
}

function headerValue(headers: KernAppPolicyRequestFacts['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

function executeRagReview(
  slotPolicy: KernAppPolicySlotDescriptor,
  facts: KernAppPolicyRequestFacts,
): KernAppPolicyExecution {
  const rag = facts.ragReview;
  if (!rag || rag.retrievalError || !Array.isArray(rag.retrievedChunks) || rag.retrievedChunks.length === 0) {
    return denied(slotPolicy, slotPolicy.slot, ['rag retrieval missing, empty, or failed']);
  }
  const answer = typeof rag.answer === 'string' ? rag.answer : '';
  const citedChunkIds = Array.isArray(rag.citedChunkIds) ? rag.citedChunkIds : [];
  const retrievedIds = new Set(rag.retrievedChunks.map((chunk) => chunk.id));
  const fabricated = citedChunkIds.filter((id) => !retrievedIds.has(id));
  const spans =
    rag.groundingSpans && rag.groundingSpans.length > 0
      ? rag.groundingSpans
      : citedChunkIds.length > 0
        ? [{ start: 0, end: answer.length, chunkIds: citedChunkIds, required: true }]
        : [];
  const result = evaluatePolicyRagReview({
    answer,
    retrievedChunks: rag.retrievedChunks,
    groundingSpans: spans,
    minGroundingCoverage: slotPolicy.plan.kind === 'rag-review' ? slotPolicy.plan.minGroundingCoverage : 1,
  });
  if (fabricated.length > 0 || result.diagnostics.length > 0) {
    return denied(slotPolicy, slotPolicy.slot, [
      ...fabricated.map((id) => `citation '${id}' was not retrieved for this request`),
      ...result.diagnostics,
    ]);
  }
  return { name: slotPolicy.name, slot: slotPolicy.slot, kind: slotPolicy.kind, action: 'allow' };
}

function evaluatePolicyRagReview(input: {
  readonly answer: string;
  readonly retrievedChunks: readonly KernAppRetrievedChunk[];
  readonly groundingSpans: readonly {
    readonly start: number;
    readonly end: number;
    readonly chunkIds: readonly string[];
  }[];
  readonly minGroundingCoverage: number;
}): { readonly diagnostics: readonly string[] } {
  const diagnostics: string[] = [];
  if (input.answer.trim().length === 0) diagnostics.push('rag answer must be non-empty');
  if (input.groundingSpans.length === 0) diagnostics.push('rag answer must cite retrieved chunks');

  const chunkById = new Map(input.retrievedChunks.map((chunk) => [chunk.id, chunk]));
  const grounded = new Array(input.answer.length).fill(false) as boolean[];
  for (const [spanIndex, span] of input.groundingSpans.entries()) {
    if (
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start < 0 ||
      span.end <= span.start ||
      span.end > input.answer.length
    ) {
      diagnostics.push(`rag grounding span ${spanIndex} is invalid`);
      continue;
    }
    const citedChunks = span.chunkIds.map((chunkId) => chunkById.get(chunkId)).filter(isDefined);
    if (citedChunks.length === 0) {
      diagnostics.push(`rag grounding span ${spanIndex} has no retrieved citation`);
      continue;
    }
    const spanText = normalizeRagSupportText(input.answer.slice(span.start, span.end));
    const supported =
      spanText.length > 0 && citedChunks.some((chunk) => normalizeRagSupportText(chunk.text).includes(spanText));
    if (!supported) {
      diagnostics.push(`rag grounding span ${spanIndex} is not supported by cited chunks`);
      continue;
    }
    for (let index = span.start; index < span.end; index += 1) grounded[index] = true;
  }

  const answerChars = countNonWhitespace(input.answer);
  const groundedChars = countGroundedNonWhitespace(input.answer, grounded);
  const coverage = answerChars === 0 ? 0 : groundedChars / answerChars;
  if (coverage < input.minGroundingCoverage) {
    diagnostics.push(
      `rag grounding coverage ${coverage.toFixed(3)} is below required threshold ${input.minGroundingCoverage.toFixed(3)}`,
    );
  }
  return { diagnostics };
}

function normalizeRagSupportText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function countNonWhitespace(text: string): number {
  let count = 0;
  for (const char of text) {
    if (!/\s/u.test(char)) count += 1;
  }
  return count;
}

function countGroundedNonWhitespace(text: string, grounded: readonly boolean[]): number {
  let count = 0;
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    const charLength = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    if (isGroundedCodePoint(grounded, index, charLength) && !/\s/u.test(text.slice(index, index + charLength))) {
      count += 1;
    }
    index += charLength;
  }
  return count;
}

function isGroundedCodePoint(grounded: readonly boolean[], start: number, length: number): boolean {
  for (let index = start; index < start + length; index += 1) {
    if (!grounded[index]) return false;
  }
  return true;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
