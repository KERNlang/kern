import {
  assertRuntimeCapabilityValue,
  type InvokeRunnerCapabilityAsyncOptions,
  invokeRunnerCapability,
  invokeRunnerCapabilityAsync,
  KernCapabilityError,
  type KernRunnerAsyncCapabilities,
  type RuntimeCapabilityCall,
  type RuntimeCapabilityValue,
} from '../../runner-capabilities.js';
import type { SemanticEnv } from './index.js';

export const INTERNAL_RUNTIME_CAPABILITY_REQUEST_FORMAT = 'kern.capability.request.internal.r0' as const;

export interface InternalRuntimeCapabilityRequest {
  readonly format: typeof INTERNAL_RUNTIME_CAPABILITY_REQUEST_FORMAT;
  readonly input: RuntimeCapabilityValue | undefined;
  readonly mode: 'async' | 'sync';
  readonly namespace: string;
  readonly operation: string;
  readonly sequence: number;
}

export type InternalRuntimeCapabilityDecision =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'reject' }
  | { readonly kind: 'return'; readonly result?: RuntimeCapabilityValue };

export type InternalRuntimeCapabilityInterceptor = (request: InternalRuntimeCapabilityRequest) => unknown;

interface InterceptorState {
  readonly interceptor: InternalRuntimeCapabilityInterceptor;
  nextSequence: number;
}

const states = new WeakMap<object, InterceptorState>();

function stateKey(env: SemanticEnv): object {
  return env.runnerCallCache ?? env;
}

function fail(request: InternalRuntimeCapabilityRequest, message: string): never {
  throw new KernCapabilityError(request.namespace, request.operation, `internal capability interceptor ${message}`);
}

function stateFor(env: SemanticEnv): InterceptorState | undefined {
  for (let current: SemanticEnv | undefined = env; current; current = current.parent) {
    const state = states.get(stateKey(current));
    if (state) return state;
  }
  return undefined;
}

function nextRequest(
  state: InterceptorState,
  call: RuntimeCapabilityCall,
  mode: InternalRuntimeCapabilityRequest['mode'],
): InternalRuntimeCapabilityRequest {
  const request = Object.freeze({
    format: INTERNAL_RUNTIME_CAPABILITY_REQUEST_FORMAT,
    input: call.input,
    mode,
    namespace: call.namespace,
    operation: call.operation,
    sequence: state.nextSequence,
  });
  state.nextSequence += 1;
  return request;
}

function inspectDecision(value: unknown, request: InternalRuntimeCapabilityRequest): InternalRuntimeCapabilityDecision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(request, 'decision is not an object');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(request, 'decision is not plain data');
  if (Object.getOwnPropertySymbols(value).length > 0) fail(request, 'decision contains symbol keys');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || !('value' in descriptor)) {
      fail(request, 'decision is not inspectable plain data');
    }
  }
  const kind = descriptors.kind?.value;
  if (kind === 'proceed' || kind === 'reject') {
    if (keys.length !== 1 || keys[0] !== 'kind') fail(request, `${kind} decision contains unknown fields`);
    return { kind };
  }
  if (kind !== 'return') fail(request, 'decision kind is unknown');
  if (keys.some((key) => key !== 'kind' && key !== 'result') || keys.length > 2) {
    fail(request, 'return decision contains unknown fields');
  }
  if (!Object.hasOwn(descriptors, 'result')) return { kind: 'return' };
  return {
    kind: 'return',
    result: assertRuntimeCapabilityValue(descriptors.result?.value, 'internal capability interceptor result'),
  };
}

function isPromiseLike(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function syncDecision(
  state: InterceptorState,
  request: InternalRuntimeCapabilityRequest,
): InternalRuntimeCapabilityDecision {
  try {
    const value = state.interceptor(request);
    if (isPromiseLike(value)) {
      void Promise.resolve(value).catch(() => {});
      fail(request, 'returned a Promise in sync mode');
    }
    return inspectDecision(value, request);
  } catch (error) {
    if (error instanceof KernCapabilityError) throw error;
    fail(request, 'failed');
  }
}

async function asyncDecision(
  state: InterceptorState,
  request: InternalRuntimeCapabilityRequest,
): Promise<InternalRuntimeCapabilityDecision> {
  try {
    return inspectDecision(await state.interceptor(request), request);
  } catch (error) {
    if (error instanceof KernCapabilityError) throw error;
    fail(request, 'failed');
  }
}

function syntheticResult(decision: InternalRuntimeCapabilityDecision): RuntimeCapabilityValue | undefined {
  return decision.kind === 'return' ? decision.result : undefined;
}

export function installInternalRuntimeCapabilityInterceptor(
  env: SemanticEnv,
  interceptor: InternalRuntimeCapabilityInterceptor,
): void {
  if (typeof interceptor !== 'function') throw new TypeError('internal capability interceptor must be a function');
  const key = stateKey(env);
  if (states.has(key)) throw new TypeError('internal capability interceptor is already installed');
  states.set(key, { interceptor, nextSequence: 0 });
}

export function invokeInternalRuntimeCapabilitySync(
  env: SemanticEnv,
  call: RuntimeCapabilityCall,
  mode: InternalRuntimeCapabilityRequest['mode'] = 'sync',
): RuntimeCapabilityValue | undefined {
  const state = stateFor(env);
  if (!state) return invokeRunnerCapability(env.capabilities, call, env.capabilityContext);
  const request = nextRequest(state, call, mode);
  const decision = syncDecision(state, request);
  if (decision.kind === 'reject') fail(request, 'rejected the request');
  if (decision.kind === 'return') return syntheticResult(decision);
  return invokeRunnerCapability(env.capabilities, call, env.capabilityContext);
}

export async function invokeInternalRuntimeSyncCapabilityAsync(
  env: SemanticEnv,
  call: RuntimeCapabilityCall,
): Promise<RuntimeCapabilityValue | undefined> {
  const state = stateFor(env);
  if (!state) return invokeRunnerCapability(env.capabilities, call, env.capabilityContext);
  const request = nextRequest(state, call, 'async');
  const decision = await asyncDecision(state, request);
  if (decision.kind === 'reject') fail(request, 'rejected the request');
  if (decision.kind === 'return') return syntheticResult(decision);
  return invokeRunnerCapability(env.capabilities, call, env.capabilityContext);
}

export async function invokeInternalRuntimeCapabilityAsync(
  env: SemanticEnv,
  capabilities: KernRunnerAsyncCapabilities | undefined,
  call: RuntimeCapabilityCall,
  options: InvokeRunnerCapabilityAsyncOptions,
): Promise<RuntimeCapabilityValue | undefined> {
  const state = stateFor(env);
  if (!state) return invokeRunnerCapabilityAsync(capabilities, call, env.capabilityContext, options);
  const request = nextRequest(state, call, 'async');
  const decision = await asyncDecision(state, request);
  if (decision.kind === 'reject') fail(request, 'rejected the request');
  if (decision.kind === 'return') return syntheticResult(decision);
  return invokeRunnerCapabilityAsync(capabilities, call, env.capabilityContext, options);
}
