import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FORMAT = 'kern.kir-canonicalizer.residual-analysis.1';
const SOURCE_COMMIT = 'fdf55cfb52616ef9bdf006a42f6a58a56a10b7c1';
const PUBLISHED_DIGEST = '160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076';
const SUMMARY_URL = new URL('./coverage-residual-analysis.json', import.meta.url);

function fail(message) {
  throw new TypeError(`coverage residual analysis handoff rejection: ${message}`);
}

function assertInspectableData(value, label) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail(`${label} numbers must be safe integers`);
    return;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} must be a plain array`);
    const keys = Reflect.ownKeys(value);
    const expectedKeys = [...value.keys()].map(String).concat('length');
    if (keys.some((key, index) => key !== expectedKeys[index]) || keys.length !== expectedKeys.length) {
      fail(`${label} must be a dense undecorated array`);
    }
    value.forEach((entry, index) => assertInspectableData(entry, `${label}[${index}]`));
    return;
  }
  if (typeof value !== 'object') fail(`${label} contains unsupported data`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain record`);
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => typeof key !== 'string')) fail(`${label} contains symbol fields`);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || descriptor.get || descriptor.set) {
      fail(`${label}.${key} must be inspectable plain data`);
    }
    assertInspectableData(value[key], `${label}.${key}`);
  }
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function handoff(value) {
  assertInspectableData(value, 'analysis');
  if (value === null || Array.isArray(value) || value.format !== FORMAT) {
    fail(`format must be ${FORMAT}`);
  }
  const digest = createHash('sha256').update(canonicalBytes(value)).digest('hex');
  if (digest !== PUBLISHED_DIGEST) fail('analysis must match the exact published M4.31 receipt');
  return { digest, record: value, sourceCommit: SOURCE_COMMIT };
}

export function validateCanonicalizerResidualAnalysisHandoff(value) {
  return handoff(value);
}

export function loadCanonicalizerResidualAnalysisHandoff() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path);
  if (!stat.isFile() || realpathSync(path) !== path) {
    fail('checked-in receipt must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('checked-in receipt must be valid JSON');
  }
  const result = handoff(parsed);
  if (!source.equals(canonicalBytes(result.record))) {
    fail('checked-in receipt must use canonical JSON bytes');
  }
  return result;
}
