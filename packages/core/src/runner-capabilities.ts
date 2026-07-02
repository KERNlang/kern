export type KernRunnerCapabilityNamespace = 'fs' | 'net' | 'rag' | 'llm' | 'crypto' | 'storage' | (string & {});

export type RuntimeCapabilityScalar = string | number | boolean | null;
export type RuntimeCapabilityValue =
  | RuntimeCapabilityScalar
  | readonly RuntimeCapabilityValue[]
  | { readonly [key: string]: RuntimeCapabilityValue };

export interface RuntimeCapabilityCall {
  readonly namespace: KernRunnerCapabilityNamespace;
  readonly operation: string;
  readonly input?: RuntimeCapabilityValue;
}

export interface KernRunnerCapabilityContext {
  readonly runId?: string;
  readonly sourceName?: string;
}

export type RuntimeCapabilityHandler = (
  call: RuntimeCapabilityCall,
  context: KernRunnerCapabilityContext,
) => RuntimeCapabilityValue | undefined;
export type AsyncRuntimeCapabilityResult =
  | RuntimeCapabilityValue
  | undefined
  | PromiseLike<RuntimeCapabilityValue | undefined>;
export type AsyncRuntimeCapabilityHandler = (
  call: RuntimeCapabilityCall,
  context: KernRunnerCapabilityContext,
) => AsyncRuntimeCapabilityResult;

export type RuntimeCapabilityProvider =
  | RuntimeCapabilityHandler
  | Readonly<Record<string, RuntimeCapabilityHandler | undefined>>;
export type AsyncRuntimeCapabilityProvider =
  | AsyncRuntimeCapabilityHandler
  | Readonly<Record<string, AsyncRuntimeCapabilityHandler | undefined>>;

export type KernRunnerCapabilities = Readonly<Record<string, RuntimeCapabilityProvider | undefined>>;
export type KernRunnerAsyncCapabilities = Readonly<Record<string, AsyncRuntimeCapabilityProvider | undefined>>;

export class KernCapabilityError extends Error {
  readonly namespace: KernRunnerCapabilityNamespace;
  readonly operation?: string;

  constructor(namespace: KernRunnerCapabilityNamespace, operation?: string, message?: string) {
    super(
      message ?? `runner capability '${namespace}${operation ? `.${operation}` : ''}' was requested but not provided`,
    );
    this.name = 'KernCapabilityError';
    this.namespace = namespace;
    this.operation = operation;
  }
}

const MAX_CAPABILITY_VALUE_DEPTH = 64;
const MAX_CAPABILITY_ARRAY_LENGTH = 10_000;
const MAX_CAPABILITY_OBJECT_KEYS = 1_000;
const MAX_CAPABILITY_STRING_LENGTH = 1_000_000;
const FORBIDDEN_RECORD_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

/**
 * Dispatches a host-injected synchronous capability. The call input is copied
 * through the portable-value validator before the host handler receives it.
 */
export function invokeRunnerCapability(
  capabilities: KernRunnerCapabilities | undefined,
  call: RuntimeCapabilityCall,
  context: KernRunnerCapabilityContext = {},
): RuntimeCapabilityValue | undefined {
  if (!isCapabilityToken(call.namespace) || !isCapabilityToken(call.operation)) {
    throw new KernCapabilityError(call.namespace, call.operation, 'runner capability call is malformed');
  }
  const normalizedCall = normalizeRuntimeCapabilityCall(call, 'runner capability');
  const provider =
    capabilities && Object.hasOwn(capabilities, call.namespace) ? capabilities[call.namespace] : undefined;
  const handler =
    typeof provider === 'function'
      ? provider
      : provider && typeof provider === 'object' && Object.hasOwn(provider, call.operation)
        ? provider[call.operation]
        : undefined;
  if (typeof handler !== 'function') throw new KernCapabilityError(call.namespace, call.operation);

  let result: ReturnType<RuntimeCapabilityHandler>;
  try {
    result = handler(normalizedCall, context);
  } catch (error) {
    if (error instanceof KernCapabilityError) throw error;
    throw new KernCapabilityError(
      call.namespace,
      call.operation,
      `runner capability '${call.namespace}.${call.operation}' threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (isPromiseLike(result)) {
    throw new KernCapabilityError(
      call.namespace,
      call.operation,
      `runner capability '${call.namespace}.${call.operation}' returned a Promise; async capabilities are not supported by executeKernSource yet`,
    );
  }
  if (result === undefined) return undefined;
  try {
    return toRuntimeCapabilityValue(result);
  } catch {
    throw new KernCapabilityError(
      call.namespace,
      call.operation,
      `runner capability '${call.namespace}.${call.operation}' returned a non-portable value`,
    );
  }
}

/**
 * Default per-call timeout for {@link invokeRunnerCapabilityAsync}, in
 * milliseconds. A host-injected async capability provider that has not
 * settled within this window fails closed rather than hanging the run
 * indefinitely. Host-configurable via {@link InvokeRunnerCapabilityAsyncOptions.timeoutMs}
 * (threaded through `ExecuteKernSourceAsyncOptions.capabilityTimeoutMs` and the
 * CLI `--capability-timeout-ms` flag); pass `0` or a non-finite value to
 * disable the guard entirely (not recommended outside deterministic tests that
 * apply their own bound).
 */
export const DEFAULT_ASYNC_CAPABILITY_TIMEOUT_MS = 30_000;

export interface InvokeRunnerCapabilityAsyncOptions {
  /** Per-call timeout override, in milliseconds. Defaults to {@link DEFAULT_ASYNC_CAPABILITY_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

class AsyncCapabilityTimeoutError extends Error {}

/**
 * Races `work` against a timer. The ABI has no generic way to cancel an
 * arbitrary host handler, so a timeout only stops WAITING — the underlying
 * call may still resolve or reject later. That late settlement is swallowed
 * here (via a handled no-op `.catch`) so it can never surface as an
 * unhandled rejection; the caller has already failed closed on the timeout.
 */
async function withCapabilityTimeout<T>(work: () => Promise<T>, timeoutMs: number | undefined): Promise<T> {
  const ms = timeoutMs ?? DEFAULT_ASYNC_CAPABILITY_TIMEOUT_MS;
  if (!Number.isFinite(ms) || ms <= 0) return work();
  const workPromise = (async () => work())();
  workPromise.catch(() => {
    // Handled: a late rejection after timeout must not become an unhandled
    // rejection. The race below already resolves/rejects for the caller.
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AsyncCapabilityTimeoutError(`timed out after ${ms}ms`));
    }, ms);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([workPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dispatches a host-injected async capability and validates its portable value.
 * Descriptor-level policy is intentionally handled by analyzeKernSourceCapabilities
 * so this small browser-safe ABI can stay independent of the preflight table.
 */
export async function invokeRunnerCapabilityAsync(
  capabilities: KernRunnerAsyncCapabilities | undefined,
  call: RuntimeCapabilityCall,
  context: KernRunnerCapabilityContext = {},
  options: InvokeRunnerCapabilityAsyncOptions = {},
): Promise<RuntimeCapabilityValue | undefined> {
  if (!isCapabilityToken(call.namespace) || !isCapabilityToken(call.operation)) {
    throw new KernCapabilityError(call.namespace, call.operation, 'runner async capability call is malformed');
  }
  const normalizedCall = normalizeRuntimeCapabilityCall(call, 'runner async capability');
  const provider =
    capabilities && Object.hasOwn(capabilities, call.namespace) ? capabilities[call.namespace] : undefined;
  const handler =
    typeof provider === 'function'
      ? provider
      : provider && typeof provider === 'object' && Object.hasOwn(provider, call.operation)
        ? provider[call.operation]
        : undefined;
  if (typeof handler !== 'function') throw new KernCapabilityError(call.namespace, call.operation);

  let result: RuntimeCapabilityValue | undefined;
  try {
    result = await withCapabilityTimeout(async () => handler(normalizedCall, context), options.timeoutMs);
  } catch (error) {
    if (error instanceof KernCapabilityError) throw error;
    if (error instanceof AsyncCapabilityTimeoutError) {
      throw new KernCapabilityError(
        call.namespace,
        call.operation,
        `runner async capability '${call.namespace}.${call.operation}' ${error.message}`,
      );
    }
    throw new KernCapabilityError(
      call.namespace,
      call.operation,
      `runner async capability '${call.namespace}.${call.operation}' threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result === undefined) return undefined;
  try {
    return toRuntimeCapabilityValue(result);
  } catch {
    throw new KernCapabilityError(
      call.namespace,
      call.operation,
      `runner async capability '${call.namespace}.${call.operation}' returned a non-portable value`,
    );
  }
}

function normalizeRuntimeCapabilityCall(call: RuntimeCapabilityCall, label: string): RuntimeCapabilityCall {
  if (call.input === undefined) return call;
  try {
    return { ...call, input: toRuntimeCapabilityValue(call.input) };
  } catch {
    throw new KernCapabilityError(
      call.namespace,
      call.operation,
      `${label} '${call.namespace}.${call.operation}' received a non-portable input`,
    );
  }
}

export function assertRuntimeCapabilityValue(value: unknown, label: string): RuntimeCapabilityValue {
  try {
    return toRuntimeCapabilityValue(value);
  } catch {
    throw new KernCapabilityError('runtime', undefined, `${label} must be a portable capability value`);
  }
}

export function isRuntimeCapabilityValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): value is RuntimeCapabilityValue {
  try {
    toRuntimeCapabilityValue(value, seen, depth);
    return true;
  } catch {
    return false;
  }
}

function toRuntimeCapabilityValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): RuntimeCapabilityValue {
  if (depth > MAX_CAPABILITY_VALUE_DEPTH) throw new Error('capability value is too deeply nested');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_CAPABILITY_STRING_LENGTH) throw new Error('capability value string too large');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('capability value number must be finite');
    return value;
  }
  if (typeof value !== 'object') throw new Error('capability value must be portable data');
  if (seen.has(value)) throw new Error('capability value must not contain cycles');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_CAPABILITY_ARRAY_LENGTH) throw new Error('capability value array too large');
      const out: RuntimeCapabilityValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new Error('capability value arrays must not be sparse');
        out.push(toRuntimeCapabilityValue(value[index], seen, depth + 1));
      }
      return Object.freeze(out);
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error('capability value records must be plain objects');
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error('capability value records must not use symbol keys');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length !== Reflect.ownKeys(descriptors).length) {
      throw new Error('capability value records must use enumerable string keys only');
    }
    if (keys.length > MAX_CAPABILITY_OBJECT_KEYS) throw new Error('capability value object too large');
    const out: Record<string, RuntimeCapabilityValue> = Object.create(null);
    for (const key of keys) {
      if (!isPortableRecordKey(key)) throw new Error(`capability value record key '${key}' is not portable`);
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || descriptor.get || descriptor.set || !('value' in descriptor)) {
        throw new Error('capability value records must be plain data properties');
      }
      out[key] = toRuntimeCapabilityValue(descriptor.value, seen, depth + 1);
    }
    return Object.freeze(out);
  } finally {
    seen.delete(value);
  }
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

function isCapabilityToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}

function isPortableRecordKey(key: string): boolean {
  return !FORBIDDEN_RECORD_KEYS.has(key);
}
