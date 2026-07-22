import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FORMAT = 'kern.kir-canonicalizer.residual-analysis.3';
const PUBLISHED_DIGEST = '823e464ea6b6cc78a6959c0bced2b6d5f63b5722e0e15bda4a2dd08abf8200d8';
const SOURCE_COMMIT = 'df27456aeda2880eb6bb76e5ed1b8fe314023a39';
const SUMMARY_URL = new URL('./coverage-residual-analysis-m4-43.json', import.meta.url);

function fail(message) {
  throw new TypeError(`coverage M4.43 residual analysis rejection: ${message}`);
}

function assertPlainReceiptData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('analysis data must contain only finite numbers');
    return;
  }
  if (typeof value !== 'object') fail('analysis data must contain only JSON values');
  if (seen.has(value)) fail('analysis data must not contain cycles');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('analysis arrays must use the plain prototype');
    const ownKeys = Reflect.ownKeys(value);
    const enumerableKeys = Object.keys(value);
    if (ownKeys.some((key) => typeof key === 'symbol') ||
        ownKeys.length !== value.length + 1 || enumerableKeys.length !== value.length) {
      fail('analysis arrays must be dense and undecorated');
    }
    for (const [index, key] of enumerableKeys.entries()) {
      if (key !== String(index)) fail('analysis arrays must contain only canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('analysis arrays must contain plain data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) fail('analysis objects must use the plain prototype');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') fail('analysis objects must not contain symbol properties');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('analysis objects must contain only plain enumerable data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
  }
  seen.delete(value);
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function publishedHandoff(value) {
  assertPlainReceiptData(value);
  if (value === null || Array.isArray(value) || value.format !== FORMAT) {
    fail(`published format must be ${FORMAT}`);
  }
  const digest = createHash('sha256').update(canonicalBytes(value)).digest('hex');
  if (digest !== PUBLISHED_DIGEST) fail('receipt must match the exact published M4.43 analysis');
  return { digest, record: structuredClone(value), sourceCommit: SOURCE_COMMIT };
}

export function validatePublishedCanonicalizerResidualAnalysisM443(value) {
  return publishedHandoff(value);
}

export function loadPublishedCanonicalizerResidualAnalysisM443() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path);
  if (!stat.isFile() || realpathSync(path) !== path) {
    fail('published receipt must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('published receipt must be valid JSON');
  }
  const result = publishedHandoff(parsed);
  if (!source.equals(canonicalBytes(result.record))) {
    fail('published receipt must use canonical JSON bytes');
  }
  return result;
}
