import type { KernKirEnvelope, KernKirSlot, KernKirValue } from '@kernlang/core/runtime/kir';
import { KIR_SHADOW_CHILD_MAX_BYTES, KIR_SHADOW_LIMITS } from './limits.js';
import type { NormalizedEnvelope } from './types.js';
import { KirShadowUnavailableError } from './types.js';

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new KirShadowUnavailableError('child-response-malformed');
  const output = value as Record<string, unknown>;
  const actual = Object.keys(output).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new KirShadowUnavailableError('child-response-malformed');
  }
  return output;
}

function value(input: unknown, depth = 0): KernKirValue {
  if (depth > KIR_SHADOW_LIMITS.maxDepth) throw new KirShadowUnavailableError('child-response-malformed');
  const base = input as Record<string, unknown>;
  if (!base || typeof base !== 'object' || typeof base.tag !== 'string')
    throw new KirShadowUnavailableError('child-response-malformed');
  if (base.tag === 'null') return record(input, ['tag']) as unknown as KernKirValue;
  if (base.tag === 'boolean') {
    const inspected = record(input, ['tag', 'value']);
    if (typeof inspected.value !== 'boolean') throw new KirShadowUnavailableError('child-response-malformed');
    return inspected as unknown as KernKirValue;
  }
  if (base.tag === 'text' || base.tag === 'integer' || base.tag === 'decimal') {
    const inspected = record(input, ['tag', 'value']);
    if (typeof inspected.value !== 'string') throw new KirShadowUnavailableError('child-response-malformed');
    return inspected as unknown as KernKirValue;
  }
  if (base.tag === 'list') {
    const inspected = record(input, ['tag', 'value']);
    if (!Array.isArray(inspected.value) || inspected.value.length > KIR_SHADOW_LIMITS.maxCollectionLength)
      throw new KirShadowUnavailableError('child-response-malformed');
    return { tag: 'list', value: inspected.value.map((item) => value(item, depth + 1)) };
  }
  if (base.tag === 'record') {
    const inspected = record(input, ['tag', 'value']);
    if (!Array.isArray(inspected.value) || inspected.value.length > KIR_SHADOW_LIMITS.maxCollectionLength)
      throw new KirShadowUnavailableError('child-response-malformed');
    return {
      tag: 'record',
      value: inspected.value.map((item) => {
        const entry = record(item, ['key', 'value']);
        if (typeof entry.key !== 'string') throw new KirShadowUnavailableError('child-response-malformed');
        return { key: entry.key, value: value(entry.value, depth + 1) };
      }),
    };
  }
  throw new KirShadowUnavailableError('child-response-malformed');
}

function slot(input: unknown): KernKirSlot {
  const base = input as Record<string, unknown>;
  if (base?.presence === 'absent') return record(input, ['presence']) as unknown as KernKirSlot;
  const inspected = record(input, ['presence', 'value']);
  if (inspected.presence !== 'value') throw new KirShadowUnavailableError('child-response-malformed');
  return { presence: 'value', value: value(inspected.value) };
}

export function normalizeEnvelope(input: unknown): NormalizedEnvelope {
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw new KirShadowUnavailableError('child-response-malformed');
  }
  if (Buffer.byteLength(encoded) > KIR_SHADOW_CHILD_MAX_BYTES)
    throw new KirShadowUnavailableError('child-response-too-large');
  const envelope = record(input, ['completion', 'diagnostics', 'events', 'format', 'outcome', 'requestId', 'result']);
  const completion = record(envelope.completion, ['kind']);
  if (completion.kind !== 'return' && completion.kind !== 'error')
    throw new KirShadowUnavailableError('child-response-malformed');
  if (envelope.format !== 'kern.runtime.kir.v1' || (envelope.outcome !== 'success' && envelope.outcome !== 'failure')) {
    throw new KirShadowUnavailableError('child-response-malformed');
  }
  if (envelope.requestId !== null && typeof envelope.requestId !== 'string')
    throw new KirShadowUnavailableError('child-response-malformed');
  if (
    !Array.isArray(envelope.diagnostics) ||
    envelope.diagnostics.length > KIR_SHADOW_LIMITS.maxDiagnostics ||
    !Array.isArray(envelope.events) ||
    envelope.events.length > KIR_SHADOW_LIMITS.maxEvents
  ) {
    throw new KirShadowUnavailableError('child-response-malformed');
  }
  const diagnostics = envelope.diagnostics.map((item) => {
    const diagnostic = record(item, ['category', 'code', 'phase']);
    if (
      diagnostic.category !== 'runtime' ||
      typeof diagnostic.code !== 'string' ||
      (diagnostic.phase !== 'link' && diagnostic.phase !== 'execution')
    ) {
      throw new KirShadowUnavailableError('child-response-malformed');
    }
    return diagnostic as unknown as KernKirEnvelope['diagnostics'][number];
  });
  const events = envelope.events.map((item) => {
    const candidate = item as Record<string, unknown>;
    if (candidate?.op === 'stdout') {
      const event = record(item, ['op', 'text']);
      if (typeof event.text !== 'string') throw new KirShadowUnavailableError('child-response-malformed');
      return event as unknown as KernKirEnvelope['events'][number];
    }
    const event = record(item, ['input', 'namespace', 'op', 'operation', 'result']);
    if (event.op !== 'capability' || typeof event.namespace !== 'string' || typeof event.operation !== 'string') {
      throw new KirShadowUnavailableError('child-response-malformed');
    }
    return { ...event, input: slot(event.input), result: slot(event.result) } as KernKirEnvelope['events'][number];
  });
  return {
    completion: { kind: completion.kind },
    diagnostics,
    events,
    format: 'kern.runtime.kir.v1',
    outcome: envelope.outcome,
    result: slot(envelope.result),
  } as NormalizedEnvelope;
}
