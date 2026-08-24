import { createHash } from 'node:crypto';

import type { NormalizedProjectionRequest } from './contracts.js';

const encoder = new TextEncoder();

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function lengthPrefix(length: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(length));
  return bytes;
}

function updateFramed(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = encoder.encode(value);
  hash.update(lengthPrefix(bytes.byteLength));
  hash.update(bytes);
}

export function projectionRequestDigest(request: NormalizedProjectionRequest): string {
  const hash = createHash('sha256');
  hash.update('kern.frontend.packaged-projection-request.1\0');
  hash.update(lengthPrefix(request.modules.length));
  for (const module of request.modules) {
    updateFramed(hash, module.moduleId);
    updateFramed(hash, module.source);
  }
  const budgets = Object.entries(request.budgets ?? {}).sort(([left], [right]) => (left < right ? -1 : 1));
  hash.update(lengthPrefix(budgets.length));
  for (const [key, value] of budgets) {
    updateFramed(hash, key);
    updateFramed(hash, String(value));
  }
  return hash.digest('hex');
}

export function receiptSeal(fields: Readonly<Record<string, unknown>>, privateSeal: string): string {
  return sha256(`${JSON.stringify(fields)}\n${privateSeal}\n`);
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
