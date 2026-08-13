import { isWellFormedText, textCodePoints, textMalformedSurrogateFailMessage } from '../../codegen/text-contract.js';

interface TextCodePointCacheStore {
  remainingBytes: number;
  readonly values: Map<string, readonly string[]>;
}

const ENTRY_OVERHEAD_BYTES = 64;
const SCALAR_SLOT_BYTES = 8;
const SCALAR_VALUE_BYTES = 8;
const stores = new WeakMap<object, TextCodePointCacheStore>();

function retainedCost(value: string, points: readonly string[]): number {
  return ENTRY_OVERHEAD_BYTES + value.length * 2 + points.length * (SCALAR_SLOT_BYTES + SCALAR_VALUE_BYTES);
}

export function installInternalTextCodePointCache(owner: object, budget: number): void {
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    throw new TypeError('text code-point cache budget must be a positive safe integer');
  }
  if (stores.has(owner)) throw new TypeError('text code-point cache is already installed for this execution');
  stores.set(owner, { remainingBytes: budget, values: new Map() });
}

export function acquireInternalTextCodePoints(
  owner: object | undefined,
  value: string,
  label: string,
): readonly string[] {
  const store = owner === undefined ? undefined : stores.get(owner);
  const retained = store?.values.get(value);
  if (retained !== undefined) return retained;
  if (!isWellFormedText(value)) throw new Error(textMalformedSurrogateFailMessage(label));
  const points = Object.freeze(textCodePoints(value));
  if (store === undefined) return points;
  const cost = retainedCost(value, points);
  if (cost > store.remainingBytes) {
    throw new Error(`portable: ${label} text code-point cache budget exhausted`);
  }
  store.values.set(value, points);
  store.remainingBytes -= cost;
  return points;
}
