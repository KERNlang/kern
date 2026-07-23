import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FORMAT = 'kern.kir-canonicalizer.node-row-headroom.3';
// Independent tests and the coverage checker repeat these anchors so changing
// this loader alone cannot rewrite the published milestone.
const PUBLISHED_DIGEST = '61e2c3b388160035d5764efcc2037c408eca8fc30f12010430168dd2b3bf9bca';
const SOURCE_COMMIT = '40b6961bbd41f3b60e346ef3246d6587c0c3a1f4';
const SUMMARY_URL = new URL('./node-row-headroom-m4-67.json', import.meta.url);

function fail(message) {
  throw new TypeError(`coverage M4.67 node-row headroom rejection: ${message}`);
}

function assertPlainReceiptData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('headroom data must contain only finite numbers');
    return;
  }
  if (typeof value !== 'object') fail('headroom data must contain only JSON values');
  if (seen.has(value)) fail('headroom data must not contain cycles or shared references');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail('headroom arrays must use the plain prototype');
    }
    const ownKeys = Reflect.ownKeys(value);
    const enumerableKeys = Object.keys(value);
    if (
      ownKeys.some((key) => typeof key === 'symbol') ||
      ownKeys.length !== value.length + 1 ||
      enumerableKeys.length !== value.length
    ) {
      fail('headroom arrays must be dense and undecorated');
    }
    for (const [index, key] of enumerableKeys.entries()) {
      if (key !== String(index)) fail('headroom arrays must contain only canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('headroom arrays must contain plain data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      fail('headroom objects must use the plain prototype');
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') fail('headroom objects must not contain symbol properties');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('headroom objects must contain only plain enumerable data properties');
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
  if (digest !== PUBLISHED_DIGEST) fail('receipt must match the exact published M4.67 evidence');
  return { digest, record: structuredClone(value), sourceCommit: SOURCE_COMMIT };
}

export function validatePublishedCanonicalizerNodeRowHeadroomM467(value) {
  return publishedHandoff(value);
}

export function loadPublishedCanonicalizerNodeRowHeadroomM467() {
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
