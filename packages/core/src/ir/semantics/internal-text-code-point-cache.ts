import { textMalformedSurrogateFailMessage } from '../../codegen/text-contract.js';

interface TextScalarScan {
  readonly astralCount: number;
  readonly scalarLength: number;
  readonly utf8Bytes: number;
}

interface TextScalarIndex extends TextScalarScan {
  readonly astralScalarPositions?: Uint32Array;
  readonly retainedBytes: number;
}

interface TextCodePointCacheStore {
  readonly capacityBytes: number;
  readonly maxStringBytes: number;
  usedBytes: number;
  readonly values: Map<string, TextScalarIndex>;
}

const ENTRY_OVERHEAD_BYTES = 64;
const UTF16_UNIT_BYTES = 2;
const ASTRAL_POSITION_BYTES = Uint32Array.BYTES_PER_ELEMENT;
const MAX_UINT32 = 0xffff_ffff;
const stores = new WeakMap<object, TextCodePointCacheStore>();

function cacheCapacity(maxStringBytes: number): number {
  const fixedBytes = ENTRY_OVERHEAD_BYTES * 2;
  const maximum = Number.MAX_SAFE_INTEGER - fixedBytes;
  return maxStringBytes > maximum / 4 ? Number.MAX_SAFE_INTEGER : fixedBytes + maxStringBytes * 4;
}

function scanText(value: string, label: string): TextScalarScan {
  let astralCount = 0;
  let scalarLength = 0;
  let utf8Bytes = 0;
  for (let unitIndex = 0; unitIndex < value.length; unitIndex += 1) {
    const unit = value.charCodeAt(unitIndex);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(unitIndex + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(textMalformedSurrogateFailMessage(label));
      }
      astralCount += 1;
      scalarLength += 1;
      utf8Bytes += 4;
      unitIndex += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error(textMalformedSurrogateFailMessage(label));
    } else {
      scalarLength += 1;
      utf8Bytes += unit <= 0x7f ? 1 : unit <= 0x7ff ? 2 : 3;
    }
  }
  return { astralCount, scalarLength, utf8Bytes };
}

function retainedCost(value: string, astralCount: number): number {
  return ENTRY_OVERHEAD_BYTES + value.length * UTF16_UNIT_BYTES + astralCount * ASTRAL_POSITION_BYTES;
}

function evictUntilAvailable(store: TextCodePointCacheStore, requiredBytes: number): void {
  while (store.usedBytes + requiredBytes > store.capacityBytes) {
    const oldest = store.values.entries().next().value as [string, TextScalarIndex] | undefined;
    if (oldest === undefined) return;
    store.values.delete(oldest[0]);
    store.usedBytes -= oldest[1].retainedBytes;
  }
}

function materializeAstralPositions(value: string, count: number): Uint32Array | undefined {
  let positions: Uint32Array;
  try {
    positions = new Uint32Array(count);
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
  let positionIndex = 0;
  let scalarIndex = 0;
  for (let unitIndex = 0; unitIndex < value.length; unitIndex += 1) {
    const unit = value.charCodeAt(unitIndex);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      positions[positionIndex] = scalarIndex;
      positionIndex += 1;
      unitIndex += 1;
    }
    scalarIndex += 1;
  }
  return positions;
}

function acquireTextScalarIndex(owner: object | undefined, value: string, label: string): TextScalarIndex {
  const store = owner === undefined ? undefined : stores.get(owner);
  const retained = store?.values.get(value);
  if (retained !== undefined) {
    store?.values.delete(value);
    store?.values.set(value, retained);
    return retained;
  }

  const scan = scanText(value, label);
  const cost = retainedCost(value, scan.astralCount);
  if (
    store === undefined ||
    scan.utf8Bytes > store.maxStringBytes ||
    scan.scalarLength > MAX_UINT32 ||
    cost > store.capacityBytes
  ) {
    return { ...scan, retainedBytes: 0 };
  }

  evictUntilAvailable(store, cost);
  if (store.usedBytes + cost > store.capacityBytes) return { ...scan, retainedBytes: 0 };
  const astralScalarPositions = materializeAstralPositions(value, scan.astralCount);
  if (astralScalarPositions === undefined) return { ...scan, retainedBytes: 0 };
  const indexed: TextScalarIndex = {
    ...scan,
    astralScalarPositions,
    retainedBytes: cost,
  };
  store.values.set(value, indexed);
  store.usedBytes += cost;
  return indexed;
}

function lowerBound(values: Uint32Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if ((values[middle] ?? 0) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function scalarBoundaryToUnit(value: string, scalarIndex: number, index: TextScalarIndex): number {
  const positions = index.astralScalarPositions;
  if (positions !== undefined) return scalarIndex + lowerBound(positions, scalarIndex);
  let unitIndex = 0;
  let currentScalar = 0;
  while (currentScalar < scalarIndex) {
    const unit = value.charCodeAt(unitIndex);
    unitIndex += unit >= 0xd800 && unit <= 0xdbff ? 2 : 1;
    currentScalar += 1;
  }
  return unitIndex;
}

function unitBoundaryToScalar(value: string, unitIndex: number, index: TextScalarIndex): number {
  const positions = index.astralScalarPositions;
  if (positions !== undefined) {
    let low = 0;
    let high = positions.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      const astralUnitIndex = (positions[middle] ?? 0) + middle;
      if (astralUnitIndex < unitIndex) low = middle + 1;
      else high = middle;
    }
    return unitIndex - low;
  }
  let scalarIndex = 0;
  for (let currentUnit = 0; currentUnit < unitIndex; scalarIndex += 1) {
    const unit = value.charCodeAt(currentUnit);
    currentUnit += unit >= 0xd800 && unit <= 0xdbff ? 2 : 1;
  }
  return scalarIndex;
}

export function installInternalTextCodePointCache(owner: object, maxStringBytes: number): void {
  if (!Number.isSafeInteger(maxStringBytes) || maxStringBytes <= 0) {
    throw new TypeError('text code-point cache maxStringBytes must be a positive safe integer');
  }
  if (stores.has(owner)) throw new TypeError('text code-point cache is already installed for this execution');
  stores.set(owner, {
    capacityBytes: cacheCapacity(maxStringBytes),
    maxStringBytes,
    usedBytes: 0,
    values: new Map(),
  });
}

export function internalTextScalarLength(owner: object | undefined, value: string, label: string): number {
  return acquireTextScalarIndex(owner, value, label).scalarLength;
}

/** Exact RFC 3629 byte length from the same validated scan/cache used by the
 * scalar-indexed Text operations. Malformed UTF-16 fails before a value is
 * returned, and repeated effect-machine reads reuse the retained scan. */
export function internalTextUtf8Length(owner: object | undefined, value: string, label: string): number {
  return acquireTextScalarIndex(owner, value, label).utf8Bytes;
}

export function internalTextScalarAt(
  owner: object | undefined,
  value: string,
  scalarIndex: number,
  label: string,
): string {
  const index = acquireTextScalarIndex(owner, value, label);
  const unitIndex = scalarBoundaryToUnit(value, scalarIndex, index);
  const unit = value.charCodeAt(unitIndex);
  return value.slice(unitIndex, unitIndex + (unit >= 0xd800 && unit <= 0xdbff ? 2 : 1));
}

export function internalTextScalarSlice(
  owner: object | undefined,
  value: string,
  start: number,
  end: number,
  label: string,
): string {
  const index = acquireTextScalarIndex(owner, value, label);
  return value.slice(scalarBoundaryToUnit(value, start, index), scalarBoundaryToUnit(value, end, index));
}

export function internalTextScalarIndexOf(
  owner: object | undefined,
  value: string,
  needleValue: unknown,
  label: string,
): number {
  const index = acquireTextScalarIndex(owner, value, label);
  if (typeof needleValue !== 'string') throw new Error(`portable: ${label} requires a string`);
  const needle = needleValue;
  scanText(needle, label);
  const unitIndex = value.indexOf(needle);
  return unitIndex < 0 ? -1 : unitBoundaryToScalar(value, unitIndex, index);
}

export function internalTextStartsWith(value: string, prefixValue: unknown, label: string): boolean {
  scanText(value, label);
  if (typeof prefixValue !== 'string') throw new Error(`portable: ${label} requires a string`);
  const prefix = prefixValue;
  scanText(prefix, label);
  return value.startsWith(prefix);
}
