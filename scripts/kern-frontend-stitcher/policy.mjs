import { readFileSync } from 'node:fs';

const POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const TOP_LEVEL_KEYS = ['corpus', 'format', 'profileLimits', 'rawOpenerTypes', 'runtimeLimits'];
const PROFILE_KEYS = [
  'maxCodePoints',
  'maxDiagnostics',
  'maxEnvelopeRecords',
  'maxGroupRecords',
  'maxGroups',
  'maxOutputJsonBytes',
  'maxPhysicalRecordBytes',
  'maxPhysicalRecordCodePoints',
  'maxPhysicalRecords',
  'maxRawOpeners',
  'maxSourceBytes',
  'maxStitchDepth',
  'maxTokens',
];
const RUNTIME_KEYS = [
  'maxBytes',
  'maxCollectionLength',
  'maxDepth',
  'maxDiagnostics',
  'maxEvents', 'maxIterations',
  'maxStringBytes',
];
const RAW_TYPE = /^[a-z][a-z0-9-]*$/u;
const CORPUS_PATH = /^examples\/[A-Za-z0-9._/-]+\.kern$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function fail(detail) {
  throw new TypeError(`frontend stitcher policy rejection: ${detail}`);
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly ${expected.join(',')}`);
  }
}

function positiveIntegers(value, keys, label) {
  exactKeys(value, keys, label);
  for (const key of keys) {
    if (!Number.isSafeInteger(value[key]) || value[key] <= 0) fail(`${label}.${key} must be positive`);
  }
}

export function validateFrontendStitcherPolicy(policy) {
  exactKeys(policy, TOP_LEVEL_KEYS, 'policy');
  if (policy.format !== 'kern.frontend.stitch-shadow.1') fail('format is unsupported');
  positiveIntegers(policy.profileLimits, PROFILE_KEYS, 'profileLimits');
  positiveIntegers(policy.runtimeLimits, RUNTIME_KEYS, 'runtimeLimits');
  if (!Array.isArray(policy.corpus) || policy.corpus.length === 0) fail('corpus must be non-empty');
  for (const [index, entry] of policy.corpus.entries()) {
    exactKeys(entry, ['maxLines', 'path', 'sha256'], `corpus[${index}]`);
    if (
      typeof entry.path !== 'string' || !CORPUS_PATH.test(entry.path) ||
      entry.path.includes('..') || entry.path.includes('\\') || entry.path.includes('?') || entry.path.includes('#')
    ) {
      fail(`corpus[${index}].path must be a contained examples/*.kern path`);
    }
    if (!Number.isSafeInteger(entry.maxLines) || entry.maxLines <= 0) fail(`corpus[${index}].maxLines must be positive`);
    if (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) fail(`corpus[${index}].sha256 is invalid`);
  }
  if (
    !Array.isArray(policy.rawOpenerTypes) ||
    policy.rawOpenerTypes.length === 0 ||
    policy.rawOpenerTypes.some((type) => typeof type !== 'string' || !RAW_TYPE.test(type)) ||
    new Set(policy.rawOpenerTypes).size !== policy.rawOpenerTypes.length ||
    [...policy.rawOpenerTypes].sort().some((type, index) => type !== policy.rawOpenerTypes[index])
  ) {
    fail('rawOpenerTypes must be a unique sorted non-empty closed profile');
  }
  const limits = policy.profileLimits;
  if (limits.maxGroupRecords > limits.maxPhysicalRecords) fail('maxGroupRecords must fit maxPhysicalRecords');
  if (limits.maxGroups > limits.maxPhysicalRecords) fail('maxGroups must fit maxPhysicalRecords');
  if (limits.maxPhysicalRecordBytes > limits.maxSourceBytes) {
    fail('maxPhysicalRecordBytes must fit maxSourceBytes');
  }
  if (limits.maxOutputJsonBytes > policy.runtimeLimits.maxBytes) {
    fail('maxOutputJsonBytes must fit runtime maxBytes');
  }
  if (policy.runtimeLimits.maxStringBytes < limits.maxSourceBytes) {
    fail('runtime maxStringBytes must cover maxSourceBytes');
  }
  return policy;
}

export function loadFrontendStitcherPolicy() {
  return validateFrontendStitcherPolicy(JSON.parse(POLICY_SOURCE.toString('utf8')));
}

export function rawProfileArgument(policy) {
  return `|${policy.rawOpenerTypes.join('|')}|`;
}
