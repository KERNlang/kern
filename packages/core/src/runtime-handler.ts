import { makeEnv } from './ir/semantics/semantic-env.js';
import {
  executeInternalRuntimeHandlerAsync,
  executeInternalRuntimeHandlerSync,
} from './runtime-envelope/handler-entry.js';
import { inspectInternalRuntimeSchedulerControl } from './runtime-envelope/internal-scheduler.js';
import { internalRuntimeFailure, internalRuntimeLinkFailure } from './runtime-envelope/normalize.js';
import {
  type InternalRuntimeHandlerSignature,
  resolveInternalRuntimeSourceHandler,
} from './runtime-envelope/source-handler.js';
import type {
  InternalRuntimeEnvelope,
  InternalRuntimeEnvelopeLimits,
  InternalRuntimeValue,
} from './runtime-envelope/types.js';
import { normalizeInternalRuntimeValues, validateInternalRuntimeLimits } from './runtime-envelope/value.js';

export const KERN_RUNTIME_HANDLER_ABI = 'kern.runtime.handler.v1' as const;

export type KernRuntimeHandlerCapabilityValue =
  | null
  | boolean
  | number
  | string
  | readonly KernRuntimeHandlerCapabilityValue[]
  | { readonly [key: string]: KernRuntimeHandlerCapabilityValue };

export interface KernRuntimeHandlerCapabilityCall {
  readonly input?: KernRuntimeHandlerCapabilityValue;
  readonly namespace: string;
  readonly operation: string;
}

export interface KernRuntimeHandlerCapabilityContext {
  readonly runId?: string;
  readonly sourceName?: string;
}

export type KernRuntimeHandlerCapability = (
  call: KernRuntimeHandlerCapabilityCall,
  context: KernRuntimeHandlerCapabilityContext,
) => KernRuntimeHandlerCapabilityValue | undefined;

export type KernRuntimeHandlerAsyncCapability = (
  call: KernRuntimeHandlerCapabilityCall,
  context: KernRuntimeHandlerCapabilityContext,
) => KernRuntimeHandlerCapabilityValue | undefined | PromiseLike<KernRuntimeHandlerCapabilityValue | undefined>;

export type KernRuntimeHandlerCapabilities = Readonly<
  Record<string, Readonly<Record<string, KernRuntimeHandlerCapability | undefined>> | undefined>
>;

export type KernRuntimeHandlerAsyncCapabilities = Readonly<
  Record<string, Readonly<Record<string, KernRuntimeHandlerAsyncCapability | undefined>> | undefined>
>;

export interface KernRuntimeHandlerLimits {
  readonly maxBytes: number;
  readonly maxCollectionLength: number;
  readonly maxDepth: number;
  readonly maxDiagnostics: number;
  readonly maxEvents: number;
  readonly maxStringBytes: number;
}

export interface KernRuntimeHandlerIdentity {
  readonly handlerName: string;
  readonly sourcePath: string;
}

export interface KernRuntimeHandlerRequest {
  readonly abi: typeof KERN_RUNTIME_HANDLER_ABI;
  readonly arguments: readonly unknown[];
  readonly identity: KernRuntimeHandlerIdentity;
  readonly source: string;
}

export type KernRuntimeHandlerValue =
  | { readonly tag: 'null' }
  | { readonly tag: 'boolean'; readonly value: boolean }
  | { readonly tag: 'text'; readonly value: string }
  | { readonly tag: 'integer'; readonly value: string }
  | { readonly tag: 'decimal'; readonly value: string }
  | { readonly tag: 'list'; readonly value: readonly KernRuntimeHandlerValue[] }
  | {
      readonly tag: 'record';
      readonly value: readonly { readonly key: string; readonly value: KernRuntimeHandlerValue }[];
    };

export type KernRuntimeHandlerSlot =
  | { readonly presence: 'absent' }
  | { readonly presence: 'value'; readonly value: KernRuntimeHandlerValue };

export type KernRuntimeHandlerEvent =
  | { readonly op: 'stdout'; readonly text: string }
  | { readonly op: 'stderr'; readonly text: string }
  | {
      readonly input: KernRuntimeHandlerSlot;
      readonly namespace: string;
      readonly op: 'capability';
      readonly operation: string;
      readonly result: KernRuntimeHandlerSlot;
    };

export type KernRuntimeHandlerDiagnosticCode =
  | 'capability-error'
  | 'encoded-limit'
  | 'escaped-control'
  | 'execution-cancelled'
  | 'execution-timeout'
  | 'handler-entry-ambiguous'
  | 'handler-entry-not-found'
  | 'handler-entry-unsupported'
  | 'handler-link-error'
  | 'invalid-handler-arguments'
  | 'invalid-handler-result'
  | 'internal-runner-error'
  | 'non-portable-value'
  | 'uncaught-throw'
  | 'unsupported-runtime-input';

export interface KernRuntimeHandlerDiagnostic {
  readonly category: 'runtime';
  readonly code: KernRuntimeHandlerDiagnosticCode;
  readonly phase: 'execution' | 'link';
}

export interface KernRuntimeHandlerEnvelope {
  readonly completion: { readonly kind: 'normal' | 'return' | 'error' };
  readonly diagnostics: readonly KernRuntimeHandlerDiagnostic[];
  readonly events: readonly KernRuntimeHandlerEvent[];
  readonly format: typeof KERN_RUNTIME_HANDLER_ABI;
  readonly outcome: 'success' | 'failure';
  readonly result: KernRuntimeHandlerSlot;
}

export interface KernRuntimeHandlerOptions {
  readonly capabilities?: KernRuntimeHandlerCapabilities;
  readonly capabilityContext?: KernRuntimeHandlerCapabilityContext;
  readonly enabled: true;
  readonly limits: KernRuntimeHandlerLimits;
  readonly scheduler?: {
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  };
}

export interface KernRuntimeHandlerAsyncOptions extends KernRuntimeHandlerOptions {
  readonly asyncCapabilities?: KernRuntimeHandlerAsyncCapabilities;
  readonly capabilityTimeoutMs: number;
}

export class KernRuntimeHandlerError extends TypeError {
  readonly code: 'disabled' | 'invalid-abi' | 'invalid-limits' | 'invalid-options' | 'invalid-request';

  constructor(code: KernRuntimeHandlerError['code'], message: string) {
    super(message);
    this.name = 'KernRuntimeHandlerError';
    this.code = code;
  }
}

type AdmittedType =
  | { readonly kind: 'boolean' | 'integer' | 'text' }
  | { readonly element: 'boolean' | 'integer' | 'text'; readonly kind: 'list' }
  | { readonly kind: 'void' };

const SYNC_OPTION_KEYS = ['capabilities', 'capabilityContext', 'enabled', 'limits', 'scheduler'] as const;
const ASYNC_OPTION_KEYS = [...SYNC_OPTION_KEYS, 'asyncCapabilities', 'capabilityTimeoutMs'] as const;
const LIMIT_KEYS = [
  'maxBytes',
  'maxCollectionLength',
  'maxDepth',
  'maxDiagnostics',
  'maxEvents',
  'maxStringBytes',
] as const;

function inspectedRecord(
  value: unknown,
  label: string,
  allowedKeys: readonly string[] | null,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new KernRuntimeHandlerError('invalid-options', `${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new KernRuntimeHandlerError('invalid-options', `${label} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new KernRuntimeHandlerError('invalid-options', `${label} contains symbol keys`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (allowedKeys !== null && keys.some((key) => !allowedKeys.includes(key))) {
    throw new KernRuntimeHandlerError('invalid-options', `${label} contains unknown fields`);
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || !('value' in descriptor)) {
      throw new KernRuntimeHandlerError('invalid-options', `${label} is not inspectable plain data`);
    }
  }
  return value as Record<string, unknown>;
}

function acceptedOperationMaps<T>(value: unknown, label: string): T | undefined {
  if (value === undefined) return undefined;
  const namespaces = inspectedRecord(value, label, null);
  const accepted: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [namespace, provider] of Object.entries(namespaces)) {
    if (provider === undefined) {
      accepted[namespace] = undefined;
      continue;
    }
    const operations = inspectedRecord(provider, `${label}.${namespace}`, null);
    if (Object.values(operations).some((operation) => operation !== undefined && typeof operation !== 'function')) {
      throw new KernRuntimeHandlerError('invalid-options', `${label}.${namespace} values must be functions`);
    }
    accepted[namespace] = Object.freeze({ ...operations });
  }
  return Object.freeze(accepted) as T;
}

function inspectedRequest(request: KernRuntimeHandlerRequest): KernRuntimeHandlerRequest {
  let value: Record<string, unknown>;
  let identity: Record<string, unknown>;
  try {
    value = inspectedRecord(request, 'request', ['abi', 'arguments', 'identity', 'source']);
    identity = inspectedRecord(value.identity, 'request.identity', ['handlerName', 'sourcePath']);
  } catch (error) {
    if (error instanceof KernRuntimeHandlerError) {
      throw new KernRuntimeHandlerError('invalid-request', error.message);
    }
    throw error;
  }
  if (!['abi', 'arguments', 'identity', 'source'].every((key) => Object.hasOwn(value, key))) {
    throw new KernRuntimeHandlerError('invalid-request', 'request fields are incomplete');
  }
  if (value.abi !== KERN_RUNTIME_HANDLER_ABI) {
    throw new KernRuntimeHandlerError('invalid-abi', 'runtime handler ABI is unsupported');
  }
  if (!Array.isArray(value.arguments) || typeof value.source !== 'string') {
    throw new KernRuntimeHandlerError('invalid-request', 'request arguments and source have invalid types');
  }
  if (
    !['handlerName', 'sourcePath'].every((key) => Object.hasOwn(identity, key)) ||
    typeof identity.handlerName !== 'string' ||
    typeof identity.sourcePath !== 'string'
  ) {
    throw new KernRuntimeHandlerError('invalid-request', 'request identity is invalid');
  }
  return value as unknown as KernRuntimeHandlerRequest;
}

function acceptedOptions(options: KernRuntimeHandlerOptions, async: false): KernRuntimeHandlerOptions;
function acceptedOptions(options: KernRuntimeHandlerAsyncOptions, async: true): KernRuntimeHandlerAsyncOptions;
function acceptedOptions(
  options: KernRuntimeHandlerOptions | KernRuntimeHandlerAsyncOptions,
  async: boolean,
): KernRuntimeHandlerOptions | KernRuntimeHandlerAsyncOptions {
  const value = inspectedRecord(options, 'options', async ? ASYNC_OPTION_KEYS : SYNC_OPTION_KEYS);
  if (value.enabled !== true) throw new KernRuntimeHandlerError('disabled', 'runtime handler is default-off');
  let limits: Record<string, unknown>;
  try {
    limits = inspectedRecord(value.limits, 'limits', LIMIT_KEYS);
    validateInternalRuntimeLimits(limits as unknown as InternalRuntimeEnvelopeLimits);
  } catch {
    throw new KernRuntimeHandlerError('invalid-limits', 'runtime handler limits are invalid');
  }
  if (async && (!Number.isSafeInteger(value.capabilityTimeoutMs) || (value.capabilityTimeoutMs as number) <= 0)) {
    throw new KernRuntimeHandlerError('invalid-options', 'capabilityTimeoutMs must be a positive safe integer');
  }
  const capabilityContext =
    value.capabilityContext === undefined
      ? undefined
      : inspectedRecord(value.capabilityContext, 'capabilityContext', ['runId', 'sourceName']);
  if (capabilityContext !== undefined) {
    const context = capabilityContext;
    if (Object.values(context).some((item) => typeof item !== 'string')) {
      throw new KernRuntimeHandlerError('invalid-options', 'capabilityContext values must be strings');
    }
  }
  let scheduler: ReturnType<typeof inspectInternalRuntimeSchedulerControl> | undefined;
  if (value.scheduler !== undefined) {
    try {
      scheduler = inspectInternalRuntimeSchedulerControl(
        value.scheduler as NonNullable<KernRuntimeHandlerOptions['scheduler']>,
      );
    } catch {
      throw new KernRuntimeHandlerError('invalid-options', 'runtime handler scheduler is invalid');
    }
  }
  const capabilities = acceptedOperationMaps<KernRuntimeHandlerCapabilities>(value.capabilities, 'capabilities');
  const asyncCapabilities = async
    ? acceptedOperationMaps<KernRuntimeHandlerAsyncCapabilities>(value.asyncCapabilities, 'asyncCapabilities')
    : undefined;
  const acceptedLimits: KernRuntimeHandlerLimits = Object.freeze({
    maxBytes: limits.maxBytes as number,
    maxCollectionLength: limits.maxCollectionLength as number,
    maxDepth: limits.maxDepth as number,
    maxDiagnostics: limits.maxDiagnostics as number,
    maxEvents: limits.maxEvents as number,
    maxStringBytes: limits.maxStringBytes as number,
  });
  const acceptedContext: KernRuntimeHandlerCapabilityContext | undefined =
    capabilityContext === undefined
      ? undefined
      : Object.freeze({
          ...(capabilityContext.runId === undefined ? {} : { runId: capabilityContext.runId as string }),
          ...(capabilityContext.sourceName === undefined ? {} : { sourceName: capabilityContext.sourceName as string }),
        });
  const accepted: KernRuntimeHandlerOptions = {
    capabilities,
    capabilityContext: acceptedContext,
    enabled: true,
    limits: acceptedLimits,
    scheduler: scheduler === undefined ? undefined : Object.freeze(scheduler),
  };
  if (!async) return accepted;
  return {
    ...accepted,
    asyncCapabilities,
    capabilityTimeoutMs: value.capabilityTimeoutMs as number,
  };
}

function admittedAnnotation(annotation: string | undefined, returns: boolean): AdmittedType | null {
  if (annotation === undefined) return null;
  const value = annotation.trim();
  if (returns && value === 'void') return { kind: 'void' };
  const scalar = value.endsWith('[]') ? value.slice(0, -2) : value;
  const kind = scalar === 'string' ? 'text' : scalar === 'number' ? 'integer' : scalar === 'boolean' ? 'boolean' : null;
  if (kind === null) return null;
  return value.endsWith('[]') ? { element: kind, kind: 'list' } : { kind };
}

function admittedSignature(signature: InternalRuntimeHandlerSignature): readonly AdmittedType[] | null {
  const parameters = signature.parameters.map(({ annotation }) => admittedAnnotation(annotation, false));
  const returns = admittedAnnotation(signature.returns, true);
  if (parameters.some((type) => type === null) || returns === null) return null;
  return [...(parameters as AdmittedType[]), returns];
}

function matchesType(value: InternalRuntimeValue, type: AdmittedType): boolean {
  if (type.kind === 'void') return false;
  if (type.kind !== 'list') return value.tag === type.kind;
  return value.tag === 'list' && value.value.every((item) => item.tag === type.element);
}

function inspectedArgumentValues(args: readonly unknown[]): readonly unknown[] {
  if (Object.getOwnPropertySymbols(args).length > 0) throw new TypeError('arguments contain symbol keys');
  const descriptors = Object.getOwnPropertyDescriptors(args);
  const keys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (keys.length !== args.length) throw new TypeError('arguments must contain only dense indexes');
  return Array.from({ length: args.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`argument ${index} is not inspectable plain data`);
    }
    return descriptor.value;
  });
}

function validateArguments(
  args: readonly unknown[],
  signature: readonly AdmittedType[],
  limits: InternalRuntimeEnvelopeLimits,
): boolean {
  try {
    const parameterTypes = signature.slice(0, -1);
    const values = normalizeInternalRuntimeValues(inspectedArgumentValues(args), limits, '$.arguments');
    return (
      values.length === parameterTypes.length &&
      values.every((value, index) => matchesType(value, parameterTypes[index]!))
    );
  } catch {
    return false;
  }
}

function validateResult(envelope: InternalRuntimeEnvelope, returns: AdmittedType): InternalRuntimeEnvelope {
  if (envelope.outcome === 'failure') return envelope;
  if (returns.kind === 'void') {
    return envelope.result.presence === 'absent' ? envelope : internalRuntimeFailure('invalid-handler-result');
  }
  return envelope.result.presence === 'value' && matchesType(envelope.result.value, returns)
    ? envelope
    : internalRuntimeFailure('invalid-handler-result');
}

function publicEnvelope(envelope: InternalRuntimeEnvelope): KernRuntimeHandlerEnvelope {
  return {
    completion: envelope.completion,
    diagnostics: envelope.diagnostics,
    events: envelope.events,
    format: KERN_RUNTIME_HANDLER_ABI,
    outcome: envelope.outcome,
    result: envelope.result,
  };
}

function linkedRequest(
  request: KernRuntimeHandlerRequest,
  options: KernRuntimeHandlerOptions,
):
  | {
      readonly entry: Exclude<ReturnType<typeof resolveInternalRuntimeSourceHandler>, InternalRuntimeEnvelope>;
      readonly signature: readonly AdmittedType[];
    }
  | InternalRuntimeEnvelope {
  const linked = resolveInternalRuntimeSourceHandler(request.source, request.identity, {
    enabled: true,
    limits: options.limits,
    scheduler: options.scheduler,
  });
  if ('format' in linked) return linked;
  const signature = admittedSignature(linked.signature);
  if (signature === null) return internalRuntimeLinkFailure('handler-entry-unsupported');
  if (!validateArguments(request.arguments, signature, options.limits)) {
    return internalRuntimeFailure('invalid-handler-arguments');
  }
  return { entry: linked, signature };
}

export function executeKernRuntimeHandlerSync(
  request: KernRuntimeHandlerRequest,
  options: KernRuntimeHandlerOptions,
): KernRuntimeHandlerEnvelope {
  const acceptedRequest = inspectedRequest(request);
  const accepted = acceptedOptions(options, false);
  const linked = linkedRequest(acceptedRequest, accepted);
  if ('format' in linked) return publicEnvelope(linked);
  const host = makeEnv({ capabilities: accepted.capabilities, capabilityContext: accepted.capabilityContext });
  const envelope = executeInternalRuntimeHandlerSync(linked.entry, acceptedRequest.arguments, host, {
    enabled: true,
    limits: accepted.limits,
    scheduler: accepted.scheduler,
  });
  return publicEnvelope(validateResult(envelope, linked.signature.at(-1)!));
}

export async function executeKernRuntimeHandlerAsync(
  request: KernRuntimeHandlerRequest,
  options: KernRuntimeHandlerAsyncOptions,
): Promise<KernRuntimeHandlerEnvelope> {
  const acceptedRequest = inspectedRequest(request);
  const accepted = acceptedOptions(options, true);
  const linked = linkedRequest(acceptedRequest, accepted);
  if ('format' in linked) return publicEnvelope(linked);
  const host = makeEnv({ capabilities: accepted.capabilities, capabilityContext: accepted.capabilityContext });
  const envelope = await executeInternalRuntimeHandlerAsync(
    linked.entry,
    acceptedRequest.arguments,
    host,
    { enabled: true, limits: accepted.limits, scheduler: accepted.scheduler },
    { asyncCapabilities: accepted.asyncCapabilities, capabilityTimeoutMs: accepted.capabilityTimeoutMs },
  );
  return publicEnvelope(validateResult(envelope, linked.signature.at(-1)!));
}
