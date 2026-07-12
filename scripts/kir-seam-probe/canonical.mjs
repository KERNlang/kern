import { compareCodePoints, validateEnvelope } from './model.mjs';

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort(compareCodePoints)) output[key] = normalize(value[key]);
    return output;
  }
  return value;
}

export function encodeCanonical(envelope) {
  validateEnvelope(envelope);
  return `${JSON.stringify(normalize(envelope))}\n`;
}

export function decodeCanonical(bytes) {
  if (typeof bytes !== 'string') throw new TypeError('canonical input must be a string');
  if (!bytes.endsWith('\n') || bytes.endsWith('\n\n')) throw new TypeError('canonical input must have exactly one terminal newline');
  let parsed;
  try {
    parsed = JSON.parse(bytes.slice(0, -1));
  } catch (error) {
    throw new TypeError(`invalid canonical JSON: ${error.message}`);
  }
  validateEnvelope(parsed);
  if (encodeCanonical(parsed) !== bytes) throw new TypeError('input bytes are not canonical');
  return parsed;
}
