import { CanonicalValueDecodeError, type CanonicalValueLimits } from './types.js';

function fail(
  code: 'invalid-input' | 'limit-bytes' | 'limit-depth' | 'invalid-utf8' | 'invalid-json',
  message: string,
  offset: number | null = null,
): never {
  throw new CanonicalValueDecodeError(code, '$', message, offset);
}

export function decodeBoundedUtf8(input: Uint8Array, limits: CanonicalValueLimits): string {
  if (!(input instanceof Uint8Array)) fail('invalid-input', 'expected Uint8Array input');
  if (input.byteLength > limits.maxBytes)
    fail('limit-bytes', `input exceeds maxBytes ${limits.maxBytes}`, limits.maxBytes);
  if (input.byteLength === 0 || input[input.byteLength - 1] !== 0x0a) {
    fail('invalid-json', 'canonical input must end with exactly one LF', input.byteLength);
  }
  if (input.byteLength > 1 && input[input.byteLength - 2] === 0x0a) {
    fail('invalid-json', 'canonical input must end with exactly one LF', input.byteLength - 2);
  }
  if (input.byteLength >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    fail('invalid-utf8', 'UTF-8 BOM is forbidden', 0);
  }

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
  } catch {
    fail('invalid-utf8', 'input is not strict UTF-8');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let offset = 0; offset < input.byteLength - 1; offset += 1) {
    const byte = input[offset];
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) inString = true;
    else if (byte === 0x7b || byte === 0x5b) {
      depth += 1;
      if (depth > limits.maxDepth) {
        fail('limit-depth', `JSON lexical depth exceeds maxDepth ${limits.maxDepth}`, offset);
      }
    } else if (byte === 0x7d || byte === 0x5d) {
      depth -= 1;
      if (depth < 0) fail('invalid-json', 'unexpected closing JSON delimiter', offset);
    }
  }

  return decoded;
}
