import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AMENDMENT_DIGEST_KEYS,
  AMENDMENT_DIRECTORY,
  CHAIN_ANCHOR_PATH,
  composeAmendmentChain,
  equalDigests,
  fail,
  loadAmendmentRecords,
  validateDigests,
} from './amendment-chain.mjs';

const FLAG = process.argv.indexOf('--root');
const ROOT = resolve(process.env.KERN_RUNTIME_CONTRACT_AMEND_ROOT
  ?? (FLAG >= 0 ? process.argv[FLAG + 1] : fileURLToPath(new URL('../../', import.meta.url))));
const LINEAGE = 'scripts/runtime-contract-v1/lineage.json';
const DIGEST_KEYS = Object.freeze(Object.keys(AMENDMENT_DIGEST_KEYS).sort());

const load = (path) => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
const digest = (path) => createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex');

function records() {
  if (!existsSync(resolve(ROOT, AMENDMENT_DIRECTORY))) return [];
  return loadAmendmentRecords({
    listFiles: () => readdirSync(resolve(ROOT, AMENDMENT_DIRECTORY)),
    readJson: load,
  });
}

function lineageDigests() {
  const lineage = load(LINEAGE);
  if (lineage.format !== 'kern.runtime.contract.lineage.v1' || lineage.versions?.length !== 1) {
    fail('lineage must contain exactly one version');
  }
  return Object.fromEntries(DIGEST_KEYS.map((key) => [key, lineage.versions[0][key]]));
}

function liveDigests() {
  return Object.fromEntries(DIGEST_KEYS.map((key) => [key, digest(AMENDMENT_DIGEST_KEYS[key])]));
}

export function verifyRuntimeContractAmendmentChain() {
  const entries = records();
  const chain = composeAmendmentChain({ anchor: load(CHAIN_ANCHOR_PATH), entries });
  const pinned = lineageDigests();
  const live = liveDigests();
  validateDigests(pinned, 'lineage pin');
  if (chain.pendingRepins.length === 0) {
    if (!equalDigests(chain.terminal, pinned)) fail('amendment chain does not reach the current pin');
    if (!equalDigests(live, pinned)) fail('an artifact drifted with no pending amendment');
  } else {
    if (!equalDigests(chain.terminal, pinned)) fail('pending amendment parents do not match the current pin');
    if (equalDigests(live, pinned)) fail('pending amendment names no artifact drift');
  }
  return { consumed: chain.consumed, pendingRepins: chain.pendingRepins, rowsChanged: chain.rowsChanged };
}

function substituted(text, file, find, replace) {
  if (text.split(find).length !== 2) fail(`${file} is not uniquely rewritable`);
  return text.replace(find, replace);
}

function writeAtomically(file, text) {
  const path = resolve(ROOT, file);
  const staging = `${path}.staged`;
  writeFileSync(staging, text);
  renameSync(staging, path);
}

function writePending() {
  const verified = verifyRuntimeContractAmendmentChain();
  if (verified.pendingRepins.length === 0) return 0;
  const [{ file, record }] = records().filter(({ record: candidate }) =>
    candidate.slice === verified.pendingRepins[0]);
  const actual = liveDigests();
  let lineage = readFileSync(resolve(ROOT, LINEAGE), 'utf8');
  for (const key of DIGEST_KEYS) {
    lineage = substituted(lineage, LINEAGE, `"${key}": "${record.parentDigests[key]}"`, `"${key}": "${actual[key]}"`);
  }
  const marker = '  },\n  "rowsChanged"';
  const inserted = `  },\n  "resultDigests": ${JSON.stringify(actual, null, 2).replaceAll('\n', '\n  ')},\n  "rowsChanged"`;
  const amended = substituted(readFileSync(resolve(ROOT, file), 'utf8'), file, marker, inserted);
  writeAtomically(LINEAGE, lineage);
  writeAtomically(file, amended);
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
