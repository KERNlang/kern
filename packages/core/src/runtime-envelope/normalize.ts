import { InternalEffectMachineError } from '../ir/semantics/internal-effect-machine.js';
import { isExternallyObservableTraceEvent, type Trace, type TraceEvent } from '../ir/semantics/trace.js';
import { KernCapabilityError } from '../runner-capabilities.js';
import { InternalRuntimeSchedulerError } from './internal-scheduler.js';
import {
  INTERNAL_RUNTIME_ENVELOPE_FORMAT,
  type InternalRuntimeDiagnosticCode,
  type InternalRuntimeEnvelope,
  InternalRuntimeEnvelopeError,
  type InternalRuntimeEnvelopeLimits,
  type InternalRuntimeEvent,
} from './types.js';
import { normalizeInternalRuntimeSlot, validateInternalRuntimeLimits } from './value.js';

const textEncoder = new TextEncoder();

function compareCodePoints(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex) ?? 0;
    const rightPoint = right.codePointAt(rightIndex) ?? 0;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return left.length - right.length;
}

function canonicalJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value !== 'object') {
    throw new InternalRuntimeEnvelopeError('invalid-value', 'envelope contains a non-JSON value');
  }
  if (seen.has(value)) {
    throw new InternalRuntimeEnvelopeError('invalid-value', 'envelope contains a cycle or shared reference');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).filter((key) => key !== 'length');
    if (Object.getOwnPropertySymbols(value).length > 0 || keys.length !== value.length) {
      throw new InternalRuntimeEnvelopeError('invalid-value', 'envelope contains a non-dense array');
    }
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
        throw new InternalRuntimeEnvelopeError('invalid-value', 'envelope contains an array accessor');
      }
      return canonicalJson(descriptor.value, seen);
    });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InternalRuntimeEnvelopeError('invalid-value', 'envelope contains a non-plain object');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new InternalRuntimeEnvelopeError('invalid-value', 'envelope contains symbol keys');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(descriptors).sort(compareCodePoints)) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      throw new InternalRuntimeEnvelopeError('invalid-value', 'envelope contains hidden data or an accessor');
    }
    output[key] = canonicalJson(descriptor.value, seen);
  }
  return output;
}

export function internalRuntimeFailure(code: InternalRuntimeDiagnosticCode): InternalRuntimeEnvelope {
  return {
    completion: { kind: 'error' },
    diagnostics: [{ category: 'runtime', code, phase: 'execution' }],
    events: [],
    format: INTERNAL_RUNTIME_ENVELOPE_FORMAT,
    outcome: 'failure',
    result: { presence: 'absent' },
  };
}

export function internalRuntimeLinkFailure(code: InternalRuntimeDiagnosticCode): InternalRuntimeEnvelope {
  const envelope = internalRuntimeFailure(code);
  return { ...envelope, diagnostics: envelope.diagnostics.map((diagnostic) => ({ ...diagnostic, phase: 'link' })) };
}

function event(input: TraceEvent, limits: InternalRuntimeEnvelopeLimits, index: number): InternalRuntimeEvent | null {
  if (!isExternallyObservableTraceEvent(input)) return null;
  if (input.op === 'stdout' || input.op === 'stderr') {
    const slot = normalizeInternalRuntimeSlot(input.text, limits, `$.events[${index}].text`);
    if (slot.presence !== 'value' || slot.value.tag !== 'text') throw new Error('text event normalization failed');
    return { op: input.op, text: slot.value.value };
  }
  if (input.op === 'capability') {
    const namespace = normalizeInternalRuntimeSlot(input.namespace, limits, `$.events[${index}].namespace`);
    const operation = normalizeInternalRuntimeSlot(input.operation, limits, `$.events[${index}].operation`);
    if (
      namespace.presence !== 'value' ||
      namespace.value.tag !== 'text' ||
      operation.presence !== 'value' ||
      operation.value.tag !== 'text'
    ) {
      throw new Error('capability identity normalization failed');
    }
    return {
      input: normalizeInternalRuntimeSlot(input.input, limits, `$.events[${index}].input`),
      namespace: namespace.value.value,
      op: 'capability',
      operation: operation.value.value,
      result: normalizeInternalRuntimeSlot(input.result, limits, `$.events[${index}].result`),
    };
  }
  return null;
}

export function normalizeInternalRuntimeTrace(
  trace: Trace,
  limits: InternalRuntimeEnvelopeLimits,
): InternalRuntimeEnvelope {
  validateInternalRuntimeLimits(limits);
  if (trace.completion.kind === 'throw') return internalRuntimeFailure('uncaught-throw');
  if (trace.completion.kind === 'break' || trace.completion.kind === 'continue')
    return internalRuntimeFailure('escaped-control');
  try {
    const events = trace.events
      .map((item, index) => event(item, limits, index))
      .filter((item): item is InternalRuntimeEvent => item !== null);
    if (events.length > limits.maxEvents) throw new InternalRuntimeEnvelopeError('limit-exceeded', 'maxEvents');
    const result = normalizeInternalRuntimeSlot(trace.completion.value, limits, '$.result');
    return {
      completion: { kind: trace.completion.kind },
      diagnostics: [],
      events,
      format: INTERNAL_RUNTIME_ENVELOPE_FORMAT,
      outcome: 'success',
      result,
    };
  } catch {
    return internalRuntimeFailure('non-portable-value');
  }
}

export function normalizeInternalRuntimeFailure(error: unknown): InternalRuntimeEnvelope {
  if (error instanceof InternalRuntimeSchedulerError) return internalRuntimeFailure(error.code);
  if (error instanceof KernCapabilityError) return internalRuntimeFailure('capability-error');
  if (error instanceof InternalEffectMachineError) return internalRuntimeFailure('unsupported-runtime-input');
  if (error instanceof InternalRuntimeEnvelopeError) {
    return internalRuntimeFailure(error.code === 'limit-exceeded' ? 'non-portable-value' : 'internal-runner-error');
  }
  return internalRuntimeFailure('internal-runner-error');
}

export function encodeInternalRuntimeEnvelope(
  envelope: InternalRuntimeEnvelope,
  limits: InternalRuntimeEnvelopeLimits,
): Uint8Array {
  validateInternalRuntimeLimits(limits);
  if (envelope.diagnostics.length > limits.maxDiagnostics || envelope.events.length > limits.maxEvents) {
    return encodeInternalRuntimeEnvelope(internalRuntimeFailure('encoded-limit'), limits);
  }
  const bytes = textEncoder.encode(`${JSON.stringify(canonicalJson(envelope))}\n`);
  if (bytes.length > limits.maxBytes) {
    const failed = textEncoder.encode(`${JSON.stringify(canonicalJson(internalRuntimeFailure('encoded-limit')))}\n`);
    if (failed.length > limits.maxBytes) {
      throw new InternalRuntimeEnvelopeError('limit-exceeded', 'maxBytes cannot contain a failure envelope');
    }
    return failed;
  }
  return bytes;
}
