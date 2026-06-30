import type { RuntimeCapabilityProvider, RuntimeCapabilityValue } from './runner-capabilities.js';

export interface WebCryptoCapabilitySource {
  readonly randomUUID?: () => string;
  readonly getRandomValues?: (array: Uint8Array) => Uint8Array;
}

export interface WebCryptoCapabilityOptions {
  readonly crypto: WebCryptoCapabilitySource;
}

const MAX_RANDOM_BYTES = 10_000;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Browser-safe synchronous crypto capability for runner previews.
 * It uses an explicitly constructed provider, never implicit runner globals, and
 * returns only portable KERN runtime values.
 */
export function createWebCryptoCapability(options: WebCryptoCapabilityOptions): RuntimeCapabilityProvider {
  if (!isCryptoCapabilityOptions(options)) {
    throw new Error('crypto capability requires an explicit crypto source.');
  }
  const source = options.crypto;
  return {
    randomUUID() {
      if (typeof source.randomUUID !== 'function') {
        throw new Error('crypto.randomUUID is not available in this host.');
      }
      const id = source.randomUUID.call(source);
      if (typeof id !== 'string' || !UUID_V4_PATTERN.test(id)) {
        throw new Error('crypto.randomUUID must return a UUID v4 string.');
      }
      return id;
    },
    randomBytes(call) {
      return randomBytes(source, randomLength(call.input));
    },
    randomHex(call) {
      return bytesToHex(randomBytes(source, randomLength(call.input)));
    },
  };
}

function isCryptoCapabilityOptions(value: unknown): value is WebCryptoCapabilityOptions {
  if (value === null || typeof value !== 'object') return false;
  const crypto = (value as { readonly crypto?: unknown }).crypto;
  return crypto !== null && typeof crypto === 'object';
}

function randomBytes(source: WebCryptoCapabilitySource, length: number): number[] {
  if (typeof source.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is not available in this host.');
  }
  const bytes = source.getRandomValues(new Uint8Array(length));
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    throw new Error('crypto.getRandomValues returned an invalid byte array.');
  }
  for (const byte of bytes) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error('crypto.getRandomValues returned an invalid byte value.');
    }
  }
  return [...bytes];
}

function randomLength(input: RuntimeCapabilityValue | undefined): number {
  const value = typeof input === 'number' ? input : randomLengthFromRecord(input);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_RANDOM_BYTES) {
    throw new Error(`crypto random byte length must be an integer between 0 and ${MAX_RANDOM_BYTES}.`);
  }
  return value;
}

function randomLengthFromRecord(input: RuntimeCapabilityValue | undefined): number {
  if (input === undefined || input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('crypto random byte input must be a length number or a record with length.');
  }
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error('crypto random byte input must be a plain record with length.');
  }
  const length = (input as Readonly<Record<string, RuntimeCapabilityValue>>).length;
  if (typeof length !== 'number') {
    throw new Error('crypto random byte input length must be a number.');
  }
  return length;
}

function bytesToHex(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
