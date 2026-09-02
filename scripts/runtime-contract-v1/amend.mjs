import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FLAG = process.argv.indexOf('--root');
const ROOT = resolve(process.env.KERN_RUNTIME_CONTRACT_AMEND_ROOT
  ?? (FLAG >= 0 ? process.argv[FLAG + 1] : fileURLToPath(new URL('../../', import.meta.url))));
const HERE = 'scripts/runtime-contract-v1';
const LINEAGE = `${HERE}/lineage.json`;
const AMENDMENTS = `${HERE}/amendments`;
const ANCHOR = `${AMENDMENTS}/chain-anchor.json`;
const DIGEST_KEYS = Object.freeze({
  constitutionSha256: 'constitution.json',
  declarationSchemaSha256: 'public-declaration-schema.json',
  goldensSha256: 'goldens.json',
  proofInventorySha256: 'proof-inventory.json',
});
const SHA256 = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(`runtime contract amendment: ${message}`);
}

const load = (path) => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
const digest = (path) => createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex');
const equalDigests = (left, right) => Object.keys(DIGEST_KEYS).every((key) => left[key] === right[key]);

function validateDigests(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  if (Object.keys(value).sort().join(',') !== Object.keys(DIGEST_KEYS).sort().join(',')) {
    fail(`${label} must carry exactly the pinned artifact digests`);
  }
  for (const [key, item] of Object.entries(value)) {
    if (!SHA256.test(item)) fail(`${label}.${key} is not a SHA-256 digest`);
  }
}

function validateRecord(record, seen, file) {
  if (record.format !== 'kern.runtime.contract.amendment.v1') fail(`${file} has the wrong format`);
  if (typeof record.slice !== 'string' || record.slice.length === 0) fail(`${file} carries no slice`);
  if (seen.has(record.slice)) fail(`duplicate amendment slice ${record.slice}`);
  seen.add(record.slice);
  if (record.disposition !== 'additive') fail(`${record.slice} is not an additive amendment`);
  if (!Array.isArray(record.rowsChanged) || record.rowsChanged.length === 0 ||
      record.rowsChanged.some((row) => typeof row !== 'string' || row.length === 0) ||
      new Set(record.rowsChanged).size !== record.rowsChanged.length) {
    fail(`${record.slice} has invalid changed rows`);
  }
  validateDigests(record.parentDigests, `${record.slice}.parentDigests`);
  if (record.resultDigests !== undefined) validateDigests(record.resultDigests, `${record.slice}.resultDigests`);
}

function records() {
  if (!existsSync(resolve(ROOT, AMENDMENTS))) return [];
  const seen = new Set();
  return readdirSync(resolve(ROOT, AMENDMENTS)).filter((name) =>
    name.endsWith('.json') && name !== 'chain-anchor.json').sort().map((name) => {
    const file = `${AMENDMENTS}/${name}`;
    const record = load(file);
    validateRecord(record, seen, file);
    return { file, record };
  });
}

function lineageDigests() {
  const lineage = load(LINEAGE);
  if (lineage.format !== 'kern.runtime.contract.lineage.v1' || lineage.versions?.length !== 1) {
    fail('lineage must contain exactly one version');
  }
  return Object.fromEntries(Object.keys(DIGEST_KEYS).map((key) => [key, lineage.versions[0][key]]));
}

function liveDigests() {
  return Object.fromEntries(Object.entries(DIGEST_KEYS).map(([key, name]) => [key, digest(`${HERE}/${name}`)]));
}

export function verifyRuntimeContractAmendmentChain() {
  const entries = records();
  const anchor = load(ANCHOR);
  validateDigests(anchor, 'chain anchor');
  const results = entries.filter(({ record }) => record.resultDigests !== undefined);
  const roots = entries.filter(({ record }) => !results.some(({ record: other }) =>
    equalDigests(other.resultDigests, record.parentDigests)));
  if (entries.length > 0 && roots.length !== 1) fail('amendment chain must have exactly one genesis edge');
  const consumed = [];
  const pendingRepins = [];
  const visited = new Set();
  let current = roots[0];
  if (current && !equalDigests(current.record.parentDigests, anchor)) fail('amendment chain is not genesis-anchored');
  while (current) {
    if (visited.has(current.file)) fail('amendment chain cycles');
    visited.add(current.file);
    const { record } = current;
    if (record.resultDigests === undefined) {
      pendingRepins.push(record.slice);
      break;
    }
    consumed.push(record.slice);
    const next = entries.filter(({ record: candidate }) => equalDigests(candidate.parentDigests, record.resultDigests));
    if (next.length > 1) fail(`amendment chain forks after ${record.slice}`);
    current = next[0];
  }
  if (visited.size !== entries.length) fail('amendment chain carries an orphaned edge');
  const pinned = lineageDigests();
  const live = liveDigests();
  if (pendingRepins.length === 0) {
    const terminal = current?.record.resultDigests ?? (consumed.length === 0 ? anchor :
      entries.find(({ record }) => record.slice === consumed.at(-1)).record.resultDigests);
    if (!equalDigests(terminal, pinned)) fail('amendment chain does not reach the current pin');
    if (!equalDigests(live, pinned)) fail('an artifact drifted with no pending amendment');
  } else {
    const pending = current.record;
    if (!equalDigests(pending.parentDigests, pinned)) fail('pending amendment parents do not match the current pin');
    if (equalDigests(live, pinned)) fail('pending amendment names no artifact drift');
  }
  return { consumed, pendingRepins };
}

function substitute(file, find, replace) {
  const path = resolve(ROOT, file);
  const text = readFileSync(path, 'utf8');
  if (text.split(find).length !== 2) fail(`${file} is not uniquely rewritable`);
  writeFileSync(path, text.replace(find, replace));
}

function writePending() {
  const verified = verifyRuntimeContractAmendmentChain();
  if (verified.pendingRepins.length === 0) return 0;
  const [{ file, record }] = records().filter(({ record: candidate }) =>
    candidate.slice === verified.pendingRepins[0]);
  const actual = liveDigests();
  for (const key of Object.keys(DIGEST_KEYS)) {
    substitute(LINEAGE, `"${key}": "${record.parentDigests[key]}"`, `"${key}": "${actual[key]}"`);
  }
  const marker = '  },\n  "rowsChanged"';
  const inserted = `  },\n  "resultDigests": ${JSON.stringify(actual, null, 2).replaceAll('\n', '\n  ')},\n  "rowsChanged"`;
  substitute(file, marker, inserted);
  return 1;
}

function main() {
  if (process.argv.includes('--write')) {
    const count = writePending();
    verifyRuntimeContractAmendmentChain();
    console.log(`runtime contract amendment: re-pinned ${count} amendment(s).`);
  } else {
    const { pendingRepins } = verifyRuntimeContractAmendmentChain();
    console.log(`runtime contract amendment: chain verified, ${pendingRepins.length} pending re-pin(s).`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
