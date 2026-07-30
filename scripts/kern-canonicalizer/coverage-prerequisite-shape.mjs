import { createHash } from 'node:crypto';

const BASELINE_KEYS = [
  'baseCompleteFunctions', 'baseId', 'canonicalizerDigest', 'canonicalizerPolicyDigest',
  'compiledCoreDigest', 'corpusDigest', 'coverageImplementationDigest', 'coveragePolicyDigest',
  'familyRegistryDigest', 'functionCount', 'functionFactsDigest', 'legacyParameterBlockers',
  'profileDigest', 'toolCount',
];

export function isExactPlainArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const enumerableKeys = Object.keys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors.length;
  return Reflect.ownKeys(value).length === value.length + 1 &&
    enumerableKeys.length === value.length &&
    lengthDescriptor !== undefined &&
    Object.hasOwn(lengthDescriptor, 'value') &&
    lengthDescriptor.value === value.length &&
    !lengthDescriptor.enumerable &&
    !lengthDescriptor.configurable &&
    lengthDescriptor.writable &&
    enumerableKeys.every((key, index) => {
      const descriptor = descriptors[key];
      return key === String(index) &&
        descriptor !== undefined &&
        Object.hasOwn(descriptor, 'value') &&
        descriptor.enumerable &&
        descriptor.configurable &&
        descriptor.writable;
    });
}

export function isExactPlainRecord(value, keys) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const expectedKeys = [...keys].toSorted();
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.some((key) => typeof key !== 'string') ||
    actualKeys.length !== expectedKeys.length ||
    actualKeys.toSorted().some((key, index) => key !== expectedKeys[index])
  ) {
    return false;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return actualKeys.every((key) => {
    const descriptor = descriptors[key];
    return Object.hasOwn(descriptor, 'value') &&
      descriptor.enumerable &&
      descriptor.configurable &&
      descriptor.writable;
  });
}

export function isExactPlainData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return isExactPlainArray(value) &&
      value.every((entry) => isExactPlainData(entry, seen));
  }
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === 'string') &&
    isExactPlainRecord(value, keys) &&
    keys.every((key) => isExactPlainData(value[key], seen));
}

export function assertExactPlainData(value, label) {
  if (!isExactPlainData(value)) {
    throw new TypeError(`${label} must contain only exact plain JSON data`);
  }
}

export function canonicalizerPrerequisiteFrontierDigest(summary) {
  const canonical = JSON.parse(JSON.stringify(summary));
  const baselineKeys = Reflect.ownKeys(canonical?.baseline ?? {}).toSorted();
  if (JSON.stringify(baselineKeys) !== JSON.stringify(BASELINE_KEYS)) {
    throw new TypeError('coverage prerequisite rejection: frontier digest requires an exact format-3 baseline');
  }
  delete canonical.baseline.coverageImplementationDigest;
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
