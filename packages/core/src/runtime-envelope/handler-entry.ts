import { installInternalRuntimeCapabilityInterceptor } from '../ir/semantics/internal-capability-interceptor.js';
import { isPortableBindingName, isPortableScalar } from '../ir/semantics/portable-scalar-domain.js';
import {
  defineBinding,
  defineFreshArrayBinding,
  defineIntBinding,
  defineRecordBinding,
  makeEnv,
  type SemanticEnv,
} from '../ir/semantics/semantic-env.js';
import type { IRNode } from '../types.js';
import { executeInternalRuntimeEnvelopeAsync, executeInternalRuntimeEnvelopeSync } from './execute.js';
import type { InternalRuntimeAsyncOptions } from './internal-engine.js';
import { internalRuntimeFailure, normalizeInternalRuntimeFailure } from './normalize.js';
import {
  type InternalRuntimeEnvelope,
  InternalRuntimeEnvelopeError,
  type InternalRuntimeEnvelopeOptions,
  type InternalRuntimeValue,
} from './types.js';
import {
  normalizeInternalRuntimeValue,
  normalizeInternalRuntimeValues,
  validateInternalRuntimeLimits,
} from './value.js';

export interface InternalRuntimeHandlerEntry {
  readonly body: readonly IRNode[];
  readonly parameters: readonly string[];
}

function recordArrayFieldsFromArgument(value: unknown): Set<string> {
  const fields = new Set<string>();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fields;
  for (const [key, fieldValue] of Object.entries(value)) {
    if (Array.isArray(fieldValue) && fieldValue.every((item) => isPortableScalar(item))) fields.add(key);
  }
  return fields;
}

function inspectArray<T>(value: readonly T[], label: string, maxLength: number): readonly T[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > maxLength) throw new Error(`${label} exceeds maxCollectionLength`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${label} contains symbol keys`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (keys.length !== value.length) throw new Error(`${label} must contain only dense indexes`);
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      throw new Error(`${label}[${index}] is not inspectable plain data`);
    }
    return descriptor.value;
  });
}

function decodeList(value: InternalRuntimeValue, path: string): unknown {
  if (value.tag === 'record' || value.tag === 'decimal') throw new Error(`${path} is not executable in M3.2`);
  return decode(value, path);
}

function decode(value: InternalRuntimeValue, path: string): unknown {
  if (value.tag === 'null') return null;
  if (value.tag === 'boolean' || value.tag === 'text') return value.value;
  if (value.tag === 'integer') return Number(value.value);
  if (value.tag === 'decimal') throw new Error(`${path} Decimal arguments are deferred`);
  if (value.tag === 'list') return value.value.map((item, index) => decodeList(item, `${path}[${index}]`));
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const entry of value.value) record[entry.key] = decodeList(entry.value, `${path}.${entry.key}`);
  return record;
}

interface ValidatedArguments {
  readonly names: readonly string[];
  readonly values: readonly {
    readonly decoded: unknown;
    readonly normalized: InternalRuntimeValue;
  }[];
}

function validatedArguments(
  entry: InternalRuntimeHandlerEntry,
  args: readonly unknown[],
  options: InternalRuntimeEnvelopeOptions | undefined,
): ValidatedArguments | InternalRuntimeEnvelope {
  if (options?.enabled !== true) {
    throw new InternalRuntimeEnvelopeError('disabled', 'internal runtime handler entry is default-off');
  }
  validateInternalRuntimeLimits(options.limits);
  try {
    const parameters = inspectArray(entry.parameters, 'parameters', options.limits.maxCollectionLength);
    const values = inspectArray(args, 'arguments', options.limits.maxCollectionLength);
    if (parameters.length !== values.length) {
      throw new Error('handler entry arity is invalid');
    }
    const names = parameters.map((name, index) => {
      normalizeInternalRuntimeValue(name, options.limits, `$.parameters[${index}]`);
      if (!isPortableBindingName(name)) throw new Error(`parameter ${index} is not a portable binding`);
      return name;
    });
    if (new Set(names).size !== names.length) throw new Error('handler entry parameters must be unique');
    const normalizedValues = normalizeInternalRuntimeValues(values, options.limits, '$.arguments').map(
      (normalized, index) => ({
        decoded: decode(normalized, `$.arguments[${index}]`),
        normalized,
      }),
    );
    // Native structured clone rejects Proxy containers. Reflection alone cannot
    // distinguish a Proxy that presents a false but invariant-compatible shape.
    structuredClone(entry.parameters);
    structuredClone(args);
    return { names, values: normalizedValues };
  } catch {
    return internalRuntimeFailure('invalid-handler-arguments');
  }
}

function handlerEnvironment(
  validated: ValidatedArguments,
  host: SemanticEnv,
  options: InternalRuntimeEnvelopeOptions | undefined,
): SemanticEnv {
  const env = makeEnv({
    bindings: new Map(),
    capabilities: host.capabilities,
    capabilityContext: host.capabilityContext,
    now: host.now,
    runnerCallCache: new Map(),
    runnerCallStack: [],
    seed: host.seed,
  });
  const interceptor = options?.capabilityInterceptor;
  if (interceptor) {
    installInternalRuntimeCapabilityInterceptor(env, interceptor);
  }
  for (const [index, name] of validated.names.entries()) {
    const argument = validated.values[index];
    if (!argument) throw new Error(`argument ${index} was not normalized`);
    if (argument.normalized.tag === 'integer') defineIntBinding(env, name, argument.decoded);
    else if (argument.normalized.tag === 'list')
      defineFreshArrayBinding(env, name, argument.decoded as readonly unknown[]);
    else if (argument.normalized.tag === 'record')
      defineRecordBinding(env, name, argument.decoded, recordArrayFieldsFromArgument(argument.decoded));
    else defineBinding(env, name, argument.decoded);
  }
  return env;
}

function preparedEnvironment(
  entry: InternalRuntimeHandlerEntry,
  args: readonly unknown[],
  host: SemanticEnv,
  options: InternalRuntimeEnvelopeOptions | undefined,
): SemanticEnv | InternalRuntimeEnvelope {
  const validated = validatedArguments(entry, args, options);
  if ('format' in validated) return validated;
  try {
    return handlerEnvironment(validated, host, options);
  } catch (error) {
    return normalizeInternalRuntimeFailure(error);
  }
}

export function executeInternalRuntimeHandlerSync(
  entry: InternalRuntimeHandlerEntry,
  args: readonly unknown[],
  host: SemanticEnv,
  options?: InternalRuntimeEnvelopeOptions,
): InternalRuntimeEnvelope {
  const env = preparedEnvironment(entry, args, host, options);
  return 'format' in env ? env : executeInternalRuntimeEnvelopeSync(entry.body, env, options);
}

export async function executeInternalRuntimeHandlerAsync(
  entry: InternalRuntimeHandlerEntry,
  args: readonly unknown[],
  host: SemanticEnv,
  options?: InternalRuntimeEnvelopeOptions,
  asyncOptions: InternalRuntimeAsyncOptions = {},
): Promise<InternalRuntimeEnvelope> {
  const env = preparedEnvironment(entry, args, host, options);
  return 'format' in env ? env : executeInternalRuntimeEnvelopeAsync(entry.body, env, options, asyncOptions);
}
