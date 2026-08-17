import type { KernRunnerCapabilities, KernRunnerCapabilityContext } from '../../runner-capabilities.js';
import type { IRNode } from '../../types.js';
import type { InternalReferenceTraceRetention } from './trace.js';

/** Runtime state shared by semantic evaluators without importing registry ownership. */
export interface SemanticEnv {
  /** Lexical storage; machine paths require constructor-owned composites. */
  bindings: Map<string, unknown>;
  intProvenance?: Set<string>;
  freshArrayBindings?: Set<string>;
  pushBuiltFreshArrayBindings?: Set<string>;
  capturedArrayBindings?: Set<string>;
  recordArrayFields?: Map<string, Set<string> | null>;
  runnerFunctions?: Map<string, RunnerFunctionBinding>;
  runnerClasses?: Map<string, RunnerClassBinding>;
  runnerCallStack?: string[];
  runnerCallCache?: Map<unknown, unknown>;
  runnerThis?: RunnerClassInstanceValue;
  runnerSuperClass?: string;
  runnerProtectedClassInstances?: WeakSet<RunnerClassInstanceValue>;
  capabilities?: KernRunnerCapabilities;
  capabilityContext?: KernRunnerCapabilityContext;
  intIndexCtx?: boolean;
  parent?: SemanticEnv;
  repeatableLoopBody?: boolean;
  seed: number;
  now: number;
}

export interface RunnerModuleScope {
  readonly functions: Map<string, RunnerFunctionBinding>;
  readonly classes: Map<string, RunnerClassBinding>;
}

export interface RunnerFunctionBinding {
  readonly name: string;
  readonly params: readonly string[];
  readonly returns?: unknown;
  readonly handler?: IRNode;
  readonly body: readonly IRNode[];
  readonly module?: RunnerModuleScope;
}

export interface RunnerClassFieldBinding {
  readonly name: string;
  readonly value?: unknown;
}

export interface RunnerClassMemberBinding {
  readonly name: string;
  readonly params: readonly string[];
  readonly handler?: IRNode;
  readonly body: readonly IRNode[];
  readonly ownerClass: string;
}

export interface RunnerClassBinding {
  readonly name: string;
  readonly extendsName?: string;
  readonly fields: readonly RunnerClassFieldBinding[];
  readonly constructor?: RunnerClassMemberBinding;
  readonly methods: ReadonlyMap<string, RunnerClassMemberBinding>;
  readonly getters: ReadonlyMap<string, RunnerClassMemberBinding>;
  readonly module?: RunnerModuleScope;
}

export interface RunnerClassInstanceValue {
  readonly __kernRunnerClassInstance: true;
  readonly className: string;
  readonly fields: Record<string, unknown>;
  readonly module?: RunnerModuleScope;
}

const ENVIRONMENT_FIELDS = [
  'bindings',
  'intProvenance',
  'freshArrayBindings',
  'pushBuiltFreshArrayBindings',
  'capturedArrayBindings',
  'recordArrayFields',
  'runnerFunctions',
  'runnerClasses',
  'runnerCallStack',
  'runnerCallCache',
  'runnerThis',
  'runnerSuperClass',
  'runnerProtectedClassInstances',
  'capabilities',
  'capabilityContext',
  'intIndexCtx',
  'parent',
  'repeatableLoopBody',
  'seed',
  'now',
] as const satisfies readonly (keyof SemanticEnv)[];

interface DataPropertyFact {
  readonly configurable: boolean;
  readonly enumerable: boolean;
  readonly value: unknown;
  readonly writable: boolean;
}

interface SemanticEnvironmentFact {
  readonly fields: readonly (readonly [keyof SemanticEnv, DataPropertyFact])[];
  readonly parent: SemanticEnv | undefined;
}

const environmentFacts = new WeakMap<SemanticEnv, SemanticEnvironmentFact>();

export interface InternalRunnerMutationAudit {
  poisoned: boolean;
  readonly receiver: RunnerClassInstanceValue;
}

interface InternalExecutionContext {
  readonly audits: InternalRunnerMutationAudit[];
  readonly interceptorKey: object;
  readonly schedulerKey: object;
  readonly traceRetention: InternalReferenceTraceRetention;
}

const executionContexts = new WeakMap<SemanticEnv, InternalExecutionContext>();
const MAX_INTERNAL_RUNNER_AUDIT_DEPTH = 512;

export function ensureInternalExecutionContext(env: SemanticEnv): void {
  if (executionContexts.has(env)) return;
  executionContexts.set(env, {
    audits: [],
    interceptorKey: {},
    schedulerKey: {},
    traceRetention: 'full',
  });
}

export function inheritInternalExecutionContext(source: SemanticEnv, target: SemanticEnv): void {
  const context = executionContexts.get(source);
  if (context) executionContexts.set(target, context);
}

export function deriveInternalExecutionContext(
  source: SemanticEnv,
  target: SemanticEnv,
  traceRetention: InternalReferenceTraceRetention,
): void {
  const sourceContext = executionContexts.get(source);
  executionContexts.set(target, {
    audits: [],
    interceptorKey: {},
    schedulerKey: sourceContext?.schedulerKey ?? {},
    traceRetention,
  });
}

export function internalExecutionSchedulerKey(env: SemanticEnv): object | undefined {
  return executionContexts.get(env)?.schedulerKey;
}

export function internalExecutionInterceptorKey(env: SemanticEnv): object | undefined {
  return executionContexts.get(env)?.interceptorKey;
}

export function internalExecutionTraceRetention(env: SemanticEnv): InternalReferenceTraceRetention | undefined {
  return executionContexts.get(env)?.traceRetention;
}

export function pushInternalRunnerMutationAudit(
  env: SemanticEnv,
  receiver: RunnerClassInstanceValue,
): InternalRunnerMutationAudit {
  const context = executionContexts.get(env);
  if (!context) return { poisoned: false, receiver };
  if (context.audits.length >= MAX_INTERNAL_RUNNER_AUDIT_DEPTH) {
    throw new Error(`runner-class: mutation audit depth exceeded (limit ${MAX_INTERNAL_RUNNER_AUDIT_DEPTH})`);
  }
  const audit = { poisoned: false, receiver };
  context.audits.push(audit);
  return audit;
}

export function popInternalRunnerMutationAudit(env: SemanticEnv, audit: InternalRunnerMutationAudit): void {
  const audits = executionContexts.get(env)?.audits;
  if (!audits) return;
  if (audits.at(-1) !== audit) throw new Error('runner-class: mutation audit stack corruption');
  audits.pop();
}

export function poisonInternalRunnerMutationAudits(env: SemanticEnv, receiver: RunnerClassInstanceValue): boolean {
  const audits = executionContexts.get(env)?.audits;
  if (!audits) return false;
  let matched = false;
  for (const audit of audits) {
    if (audit.receiver === receiver) {
      audit.poisoned = true;
      matched = true;
    }
  }
  return matched;
}

export function isInternalRunnerMutationAuditPoisoned(audit: InternalRunnerMutationAudit): boolean {
  return audit.poisoned;
}

function dataPropertyFact(env: SemanticEnv, key: keyof SemanticEnv): DataPropertyFact | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(env, key);
  if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined || !('value' in descriptor)) {
    return undefined;
  }
  return {
    configurable: descriptor.configurable ?? false,
    enumerable: descriptor.enumerable ?? false,
    value: descriptor.value,
    writable: descriptor.writable ?? false,
  };
}

function captureEnvironmentFact(env: SemanticEnv, parent: SemanticEnv | undefined): void {
  const fields: Array<readonly [keyof SemanticEnv, DataPropertyFact]> = [];
  for (const key of ENVIRONMENT_FIELDS) {
    const field = dataPropertyFact(env, key);
    if (!field) return;
    fields.push([key, field]);
  }
  environmentFacts.set(env, { fields, parent });
}

export function markRootSemanticEnvironment(env: SemanticEnv): void {
  captureEnvironmentFact(env, undefined);
}

export function markChildSemanticEnvironment(env: SemanticEnv, parent: SemanticEnv): void {
  if (!isExactSemanticEnvironment(parent)) return;
  captureEnvironmentFact(env, parent);
}

/** Exact private construction fact; reads descriptors without invoking accessors. */
export function isExactSemanticEnvironment(env: SemanticEnv): boolean {
  const fact = environmentFacts.get(env);
  if (!fact || Object.getPrototypeOf(env) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(env);
  if (
    keys.length !== fact.fields.length ||
    keys.some((key) => typeof key !== 'string' || !ENVIRONMENT_FIELDS.includes(key as keyof SemanticEnv))
  ) {
    return false;
  }
  for (let index = 0; index < fact.fields.length; index += 1) {
    const [key, expected] = fact.fields[index];
    const current = dataPropertyFact(env, key);
    if (
      !current ||
      current.configurable !== expected.configurable ||
      current.enumerable !== expected.enumerable ||
      current.writable !== expected.writable ||
      !Object.is(current.value, expected.value)
    ) {
      return false;
    }
  }
  return true;
}

/** Snapshot only recorded data values after exact shape and descriptor validation. */
export function snapshotExactSemanticEnvironment(env: SemanticEnv): SemanticEnv | undefined {
  if (!isExactSemanticEnvironment(env)) return undefined;
  const fact = environmentFacts.get(env);
  if (!fact) return undefined;
  const snapshot = Object.create(null) as Record<keyof SemanticEnv, unknown>;
  for (const [key, field] of fact.fields) snapshot[key] = field.value;
  return snapshot as unknown as SemanticEnv;
}

/** Undefined means either an authentic root or no fact; check exactness first. */
export function exactSemanticEnvironmentParent(env: SemanticEnv): SemanticEnv | undefined {
  return environmentFacts.get(env)?.parent;
}
