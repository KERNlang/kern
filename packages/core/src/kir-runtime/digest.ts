import { createHash } from 'node:crypto';

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function quote(value: string): string {
  let output = '"';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const code = value.charCodeAt(index);
    if (character === '"' || character === '\\') output += `\\${character}`;
    else if (character === '\b') output += '\\b';
    else if (character === '\f') output += '\\f';
    else if (character === '\n') output += '\\n';
    else if (character === '\r') output += '\\r';
    else if (character === '\t') output += '\\t';
    else if (code < 0x20) output += `\\u${code.toString(16).padStart(4, '0')}`;
    else output += character;
  }
  return `${output}"`;
}

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError('canonical JSON requires a non-negative integer');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value === undefined || typeof value !== 'object') throw new TypeError('unsupported canonical JSON value');
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${quote(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
