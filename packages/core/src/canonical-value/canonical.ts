import {
  CANONICAL_VALUE_FORMAT,
  type CanonicalValue,
  CanonicalValueDecodeError,
  type CanonicalValueEnvelope,
  type CanonicalValueLimits,
} from './types.js';
import { decodeBoundedUtf8 } from './utf8.js';
import { compareCodePoints, validateCanonicalValueEnvelope, validateCanonicalValueLimits } from './validate.js';

const encoder = new TextEncoder();

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort(compareCodePoints)) {
      output[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  return value;
}

function canonicalBytes(envelope: CanonicalValueEnvelope): Uint8Array {
  return encoder.encode(`${JSON.stringify(normalize(envelope))}\n`);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

export function encodeCanonicalValue(value: CanonicalValue, limitsInput: CanonicalValueLimits): Uint8Array {
  try {
    const limits = validateCanonicalValueLimits(limitsInput);
    const envelope = validateCanonicalValueEnvelope({ format: CANONICAL_VALUE_FORMAT, value }, limits);
    const bytes = canonicalBytes(envelope);
    decodeBoundedUtf8(bytes, limits);
    return bytes;
  } catch (error) {
    if (error instanceof CanonicalValueDecodeError) throw error;
    if (error instanceof RangeError) {
      throw new CanonicalValueDecodeError('limit-depth', '$.value', 'value exceeds the host-safe structural depth');
    }
    throw new CanonicalValueDecodeError('invalid-shape', '$.value', 'value is not inspectable plain data');
  }
}

export function decodeCanonicalValue(input: Uint8Array, limitsInput: CanonicalValueLimits): CanonicalValue {
  if (!(input instanceof Uint8Array)) {
    throw new CanonicalValueDecodeError('invalid-input', '$', 'expected Uint8Array input');
  }
  const limits = validateCanonicalValueLimits(limitsInput);
  const text = decodeBoundedUtf8(input, limits);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(0, -1));
  } catch {
    throw new CanonicalValueDecodeError('invalid-json', '$', 'invalid canonical JSON');
  }
  try {
    const envelope = validateCanonicalValueEnvelope(parsed, limits);
    if (!sameBytes(canonicalBytes(envelope), input)) {
      throw new CanonicalValueDecodeError('noncanonical', '$', 'input bytes are not canonical');
    }
    return envelope.value;
  } catch (error) {
    if (error instanceof CanonicalValueDecodeError) throw error;
    if (error instanceof RangeError) {
      throw new CanonicalValueDecodeError('limit-depth', '$.value', 'value exceeds the host-safe structural depth');
    }
    throw new CanonicalValueDecodeError('invalid-shape', '$.value', 'value is not inspectable plain data');
  }
}
