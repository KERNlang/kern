import {
  historicalTransitionStage,
  reconstructHistoricalTransitionChain,
} from './historical-transition-chain.mjs';

export const HISTORICAL_ROW_KEYS = Object.freeze([
  'path',
  'currentDigest',
  'expectedDigest',
  'currentBlob',
  'expectedBlob',
  'replacements',
  'claim',
]);

export function isExactPlainDataRecord(value, expectedKeys) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length) return false;
  const expected = new Set(expectedKeys);
  for (const key of keys) {
    if (typeof key !== 'string' || !expected.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value') ||
      Object.hasOwn(descriptor, 'get') ||
      Object.hasOwn(descriptor, 'set')
    ) {
      return false;
    }
  }
  return true;
}

export function hasExactHistoricalRowStructure(row) {
  return isExactPlainDataRecord(row, HISTORICAL_ROW_KEYS) &&
    Array.isArray(row.replacements) &&
    row.replacements.length === 1 &&
    isExactPlainDataRecord(row.replacements[0], ['current', 'historical']);
}

function privateRow(row) {
  const replacement = Object.freeze({
    current: row.replacements[0].current,
    historical: row.replacements[0].historical,
  });
  return Object.freeze({
    path: row.path,
    currentDigest: row.currentDigest,
    expectedDigest: row.expectedDigest,
    currentBlob: row.currentBlob,
    expectedBlob: row.expectedBlob,
    replacements: Object.freeze([replacement]),
    claim: row.claim,
  });
}

export function createHistoricalPredecessorClosure(reconstructions, milestone) {
  const privateRows = new Map();
  for (const row of reconstructions) privateRows.set(row.path, privateRow(row));
  return (path, currentSource) => {
    const reconstruction = privateRows.get(path);
    if (reconstruction === undefined) return Buffer.from(currentSource);
    return reconstructHistoricalTransitionChain({
      currentSource,
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: `${milestone} ${path}`,
      path,
      stages: [historicalTransitionStage(reconstruction)],
    });
  };
}
