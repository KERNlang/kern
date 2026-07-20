import { validateKirReaderCandidate } from './reader.js';
import type { KirCandidateEnvelope } from './types.js';
import { compareCodePoints } from './validation.js';

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort(compareCodePoints)) {
      output[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  return value;
}

export function encodeKirReaderCandidate(value: unknown): string {
  const envelope = validateKirReaderCandidate(value);
  return `${JSON.stringify(normalize(envelope))}\n`;
}

export function decodeKirReaderCandidate(bytes: string): KirCandidateEnvelope {
  if (typeof bytes !== 'string') throw new TypeError('canonical input must be a string');
  if (!bytes.endsWith('\n') || bytes.endsWith('\n\n')) {
    throw new TypeError('canonical input must have exactly one terminal newline');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.slice(0, -1));
  } catch (error) {
    throw new TypeError(`invalid canonical JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const envelope = validateKirReaderCandidate(parsed);
  if (encodeKirReaderCandidate(envelope) !== bytes) throw new TypeError('input bytes are not canonical');
  return envelope;
}
