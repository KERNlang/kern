import {
  assertRuntimeCapabilityValue,
  type RuntimeCapabilityProvider,
  type RuntimeCapabilityValue,
} from './runner-capabilities.js';

export interface MemoryStorageCapabilityOptions {
  readonly initial?: Readonly<Record<string, RuntimeCapabilityValue>>;
}

/**
 * Browser-safe, synchronous storage capability for runner previews.
 * It is intentionally volatile: embedders that need persistence should provide
 * their own `storage` provider behind the same capability ABI.
 */
export function createMemoryStorageCapability(options: MemoryStorageCapabilityOptions = {}): RuntimeCapabilityProvider {
  const store = new Map<string, RuntimeCapabilityValue>();
  for (const [key, value] of Object.entries(options.initial ?? {})) {
    store.set(storageKey(key), assertRuntimeCapabilityValue(value, `storage initial value '${key}'`));
  }

  return {
    get(call) {
      const key = storageKeyFromInput(call.input);
      return store.has(key) ? store.get(key) : null;
    },
    set(call) {
      const input = storageRecordInput(call.input, 'storage.set');
      const key = storageKey(input.key);
      if (!Object.hasOwn(input, 'value')) {
        throw new Error('storage.set input requires value.');
      }
      store.set(key, assertRuntimeCapabilityValue(input.value, 'storage.set value'));
      return true;
    },
    has(call) {
      return store.has(storageKeyFromInput(call.input));
    },
    delete(call) {
      return store.delete(storageKeyFromInput(call.input));
    },
    clear() {
      store.clear();
      return true;
    },
    keys() {
      return [...store.keys()].sort();
    },
  };
}

function storageKeyFromInput(input: RuntimeCapabilityValue | undefined): string {
  if (typeof input === 'string') return storageKey(input);
  const record = storageRecordInput(input, 'storage key');
  return storageKey(record.key);
}

function storageRecordInput(
  input: RuntimeCapabilityValue | undefined,
  label: string,
): Readonly<Record<string, RuntimeCapabilityValue>> & { readonly key: string } {
  if (!isStorageRecord(input)) {
    throw new Error(`${label} input must be a record with a non-empty string key.`);
  }
  return input;
}

function isStorageRecord(
  input: RuntimeCapabilityValue | undefined,
): input is Readonly<Record<string, RuntimeCapabilityValue>> & { readonly key: string } {
  if (input === undefined || input === null || typeof input !== 'object' || Array.isArray(input)) return false;
  const key = (input as Readonly<Record<string, RuntimeCapabilityValue>>).key;
  return typeof key === 'string' && key.trim() !== '';
}

function storageKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed === '') throw new Error('storage key must be a non-empty string.');
  return trimmed;
}
