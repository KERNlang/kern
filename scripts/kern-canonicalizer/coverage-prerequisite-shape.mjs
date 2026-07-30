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
  return Reflect.ownKeys(value).length === value.length + 1 &&
    enumerableKeys.length === value.length &&
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

export function canonicalizerPrerequisiteFrontierDigest(summary) {
  const canonical = JSON.parse(JSON.stringify(summary));
  const baselineKeys = Reflect.ownKeys(canonical?.baseline ?? {}).toSorted();
  if (JSON.stringify(baselineKeys) !== JSON.stringify(BASELINE_KEYS)) {
    throw new TypeError('coverage prerequisite rejection: frontier digest requires an exact format-3 baseline');
  }
  delete canonical.baseline.coverageImplementationDigest;
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
