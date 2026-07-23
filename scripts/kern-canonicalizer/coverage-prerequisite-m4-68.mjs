import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FORMAT = 'kern.kir-canonicalizer.prerequisite-summary.3';
const PUBLISHED_DIGEST = '0038f2a831533a8c6494a56a83cc4af96a50a2416d62de772707624cf634412c';
const SOURCE_COMMIT = 'c0a84888c53325a5c7dd6e19ba4f002b6b28d1a4';
const SUMMARY_URL = new URL('./coverage-prerequisite-m4-68.json', import.meta.url);

function fail(message) {
  throw new TypeError(`coverage M4.68 prerequisite rejection: ${message}`);
}

function assertPlainReceiptData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('receipt data must contain only finite numbers');
    return;
  }
  if (typeof value !== 'object') fail('receipt data must contain only JSON values');
  if (seen.has(value)) fail('receipt data must not contain cycles or shared references');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail('receipt arrays must use the plain prototype');
    }
    const ownKeys = Reflect.ownKeys(value);
    const enumerableKeys = Object.keys(value);
    if (
      ownKeys.some((key) => typeof key === 'symbol') ||
      ownKeys.length !== value.length + 1 ||
      enumerableKeys.length !== value.length
    ) {
      fail('receipt arrays must be dense and undecorated');
    }
    for (const [index, key] of enumerableKeys.entries()) {
      if (key !== String(index)) fail('receipt arrays must contain only canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('receipt arrays must contain plain data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      fail('receipt objects must use the plain prototype');
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') fail('receipt objects must not contain symbol properties');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('receipt objects must contain only plain enumerable data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
  }
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
  if (digest !== PUBLISHED_DIGEST) {
    fail('receipt must match the exact published M4.68 prerequisite');
  }
  return { digest, record: structuredClone(value), sourceCommit: SOURCE_COMMIT };
}

export function validatePublishedCanonicalizerPrerequisiteM468(value) {
  return publishedHandoff(value);
}

export function loadPublishedCanonicalizerPrerequisiteM468() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) fail('published receipt must exist');
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
