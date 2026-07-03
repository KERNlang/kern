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
 * Policy-slot skeleton (KERN 5.2 scaffolding for 5.3 guard execution).
 *
 * A `policy` node MAY declare `slot=pre|post` to become an EXECUTABLE policy
 * that runs before (`pre`) or after (`post`) the route/view handler. In 5.2
 * only the no-op `kind=passthrough` is allowed for slot policies — the slot
 * SHAPE and plumbing exist so 5.3 can add real guard kinds (auth,
 * hmacSignature, rag-review) without redesigning routing. Slot policies may
 * optionally reference their own `.kern` source (`source=` + `handler=`),
 * which is resolved inside the app root and validated fail-closed at load
 * time exactly like entry sources. Policies WITHOUT `slot=` remain the
 * declarative-only policies shipped in 5.0 (free-form `kind`, no execution).
 */
export type KernAppPolicySlot = 'pre' | 'post';
export const KERN_APP_POLICY_EXECUTABLE_KINDS = Object.freeze(['passthrough'] as const);
export type KernAppExecutablePolicyKind = (typeof KERN_APP_POLICY_EXECUTABLE_KINDS)[number];

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
  readonly label: string;
}

/** One executed policy hook record returned by {@link executeKernAppEntryPolicySlot}. */
export interface KernAppPolicyExecution {
  readonly name: string;
  readonly slot: KernAppPolicySlot;
  readonly kind: KernAppExecutablePolicyKind;
  /** 5.2 skeleton: the only implemented action is the no-op passthrough. */
  readonly action: 'passthrough';
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
  /** Executable policies to run BEFORE the entry handler (5.2: passthrough only). */
  readonly prePolicies: readonly KernAppPolicySlotDescriptor[];
  /** Executable policies to run AFTER the entry handler (5.2: passthrough only). */
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
 * an unknown slot value, a slot policy whose kind is not an executable kind
 * (only `passthrough` in 5.2), `handler=` without `source=`, or a slot
 * policy source that escapes the app root.
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
  if (kind === undefined || !(KERN_APP_POLICY_EXECUTABLE_KINDS as readonly string[]).includes(kind)) {
    throw new KernAppDescriptorError(
      `${label} slot=${slot} requires an executable kind (${KERN_APP_POLICY_EXECUTABLE_KINDS.join(', ')} only in KERN 5.2)${
        kind !== undefined ? `, got '${kind}'` : ''
      }`,
    );
  }
  if (handler !== undefined && source === undefined) {
    throw new KernAppDescriptorError(`${label} declares handler= without source=`);
  }
  return {
    node: policy,
    name,
    slot,
    kind: kind as KernAppExecutablePolicyKind,
    ...(source !== undefined ? { sourcePath: resolveAppSource(source, label, appRoot) } : {}),
    handler: handler ?? 'main',
    requires: capabilityList(optionalStringProp(policy, 'requires'), label),
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
    }
  }
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
 * Policy-slot execution hook (KERN 5.2 skeleton). Hosts call this around
 * entry execution: `pre` before running the entry handler, `post` after a
 * successful run. In 5.2 the only executable policy kind is the no-op
 * `passthrough`, so this returns the executed hook records without side
 * effects — the point is that the HOOK exists with a stable shape so 5.3
 * guard kinds (auth, hmacSignature, rag-review) slot in without a routing
 * redesign. Fail-closed: an unknown slot value or a policy whose kind has no
 * executable implementation throws {@link KernAppDescriptorError} instead of
 * being silently skipped.
 */
export async function executeKernAppEntryPolicySlot(
  entry: KernAppEntryDescriptor,
  slot: KernAppPolicySlot,
): Promise<readonly KernAppPolicyExecution[]> {
  const slotPolicies = slot === 'pre' ? entry.prePolicies : slot === 'post' ? entry.postPolicies : undefined;
  if (slotPolicies === undefined) {
    throw new KernAppDescriptorError(`unknown policy slot '${String(slot)}' (expected pre or post)`);
  }
  const executions: KernAppPolicyExecution[] = [];
  for (const slotPolicy of slotPolicies) {
    if (slotPolicy.kind !== 'passthrough') {
      throw new KernAppDescriptorError(
        `${slotPolicy.label} kind '${slotPolicy.kind}' has no executable implementation in KERN 5.2`,
      );
    }
    executions.push({ name: slotPolicy.name, slot, kind: slotPolicy.kind, action: 'passthrough' });
  }
  return executions;
}
