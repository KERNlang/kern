import { readFileSync } from 'node:fs';

import { KERN_CHECKER_NATIVE_WORK_FORMULA } from '../../packages/cli/dist/kern-checker-contract.js';

const SOURCE = readFileSync(new URL('./policy.json', import.meta.url));

function fail(detail) {
  throw new TypeError(`KERN checker policy rejection: ${detail}`);
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    fail(`${label} must contain exactly ${sorted.join(',')}`);
  }
}

function positiveSafe(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive safe integer`);
}

function digestText(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) fail(`${label} must be a SHA-256 digest`);
}

export function validateKernCheckerPolicy(value) {
  exactKeys(value, ['format', 'nativeWork', 'profileLimits', 'runtimeLimits'], 'policy');
  if (value.format !== 'kern.checker.policy.1') fail('format is unsupported');
  exactKeys(value.nativeWork, ['corpus', 'formula', 'maximumEnvelope', 'maxNativeWork'], 'nativeWork');
  exactKeys(value.nativeWork.corpus, ['count', 'sha256'], 'nativeWork.corpus');
  exactKeys(value.nativeWork.maximumEnvelope, ['id', 'sha256', 'work'], 'nativeWork.maximumEnvelope');
  if (value.nativeWork.formula !== KERN_CHECKER_NATIVE_WORK_FORMULA) fail('nativeWork.formula is unsupported');
  positiveSafe(value.nativeWork.corpus.count, 'nativeWork.corpus.count');
  digestText(value.nativeWork.corpus.sha256, 'nativeWork.corpus.sha256');
  if (typeof value.nativeWork.maximumEnvelope.id !== 'string' || value.nativeWork.maximumEnvelope.id.length === 0) {
    fail('nativeWork.maximumEnvelope.id must be non-empty text');
  }
  digestText(value.nativeWork.maximumEnvelope.sha256, 'nativeWork.maximumEnvelope.sha256');
  positiveSafe(value.nativeWork.maximumEnvelope.work, 'nativeWork.maximumEnvelope.work');
  positiveSafe(value.nativeWork.maxNativeWork, 'nativeWork.maxNativeWork');
  if (value.nativeWork.maxNativeWork >= Number.MAX_SAFE_INTEGER) fail('maxNativeWork must leave a saturation sentinel');
  if (value.nativeWork.maxNativeWork !== Math.ceil((5 * value.nativeWork.maximumEnvelope.work) / 4)) {
    fail('maxNativeWork must equal the corpus maximum plus 25 percent');
  }
  exactKeys(
    value.profileLimits,
    ['maxDiagnostics', 'maxFactCells', 'maxInputBytes', 'maxPathBytes', 'maxResultBytes', 'maxRowsPerFamily'],
    'profileLimits',
  );
  for (const key of Object.keys(value.profileLimits)) positiveSafe(value.profileLimits[key], `profileLimits.${key}`);
  exactKeys(
    value.runtimeLimits,
    ['maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxStringBytes'],
    'runtimeLimits',
  );
  for (const [key, limit] of Object.entries(value.runtimeLimits)) {
    if (!Number.isSafeInteger(limit) || limit <= 0) fail(`runtimeLimits.${key} must be a positive safe integer`);
  }
  if (value.profileLimits.maxRowsPerFamily > value.runtimeLimits.maxCollectionLength) {
    fail('maxRowsPerFamily must fit maxCollectionLength');
  }
  if (value.profileLimits.maxResultBytes > value.runtimeLimits.maxBytes) {
    fail('maxResultBytes must fit runtime maxBytes');
  }
  if (value.profileLimits.maxInputBytes > value.runtimeLimits.maxBytes) {
    fail('maxInputBytes must fit runtime maxBytes');
  }
  if (value.profileLimits.maxPathBytes > value.runtimeLimits.maxStringBytes) {
    fail('maxPathBytes must fit runtime maxStringBytes');
  }
  return structuredClone(value);
}

export function kernCheckerPolicySource() {
  return Buffer.from(SOURCE);
}

export function loadKernCheckerPolicy() {
  return validateKernCheckerPolicy(JSON.parse(SOURCE.toString('utf8')));
}
