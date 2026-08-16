import { createHash } from 'node:crypto';

import {
  SCALAR_HELPER_HISTORY_INVENTORY,
  SCALAR_HELPER_HISTORY_ROWS,
} from './scalar-helper-history-transition-data.mjs';
import { historicalTransitionStage, reconstructHistoricalTransitionChain } from './historical-transition-chain.mjs';

const CLAIM = 'kern.runtime.scalar-helper-history.r0';
const PREDECESSOR_COMMIT = '7efa4c3a7fe134e3f269a161c92d94a86ad7e064';
const SUCCESSOR_COMMIT = '8a453a4447572194a314df57e717396169b9accf';
const INVENTORY_DIGEST = '34aa878fbfb82d4235547aed9abec7cd1d6c848f68d990ad9cba915d1def5d67';
const MANIFEST_DIGEST = '12f4726267c78c4cc4b9d1087b1e3a2a5d7cb2f94d7b6ec624cc51af34315069';
const ROWS_DIGEST = 'a55c7182f7e8a96520d18d439da731bc422180c5c2fd22e2ecbb2cf6fc9e1556';
const PREDECESSOR_ENDPOINT = '5ab8b0146f70b354f6e92cb386238ac602a0ce80534e945f9e239623eaa448bf';
const SUCCESSOR_ENDPOINT = 'd908fefc278843bcc99ad6935bee9704f23696944d2375845f036ec1d232a097';

function pathDigest(paths) {
  const hash = createHash('sha256');
  for (const path of paths) hash.update(`${path.length}:${path}`);
  return hash.digest('hex');
}

function framedDigest(parts) {
  const hash = createHash('sha256');
  for (const part of parts) {
    const bytes = Buffer.from(part);
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function rowsDigest(rows) {
  const parts = [];
  for (const row of rows) {
    parts.push(row.path, row.currentDigest, row.expectedDigest, row.currentBlob, row.expectedBlob);
    for (const replacement of row.replacements ?? []) {
      parts.push(replacement.current, replacement.historical);
    }
  }
  return framedDigest(parts);
}

export const SCALAR_HELPER_HISTORY_HISTORICAL_TRANSITION = Object.freeze({
  claim: CLAIM,
  predecessorCommit: PREDECESSOR_COMMIT,
  successorCommit: SUCCESSOR_COMMIT,
  compiledInventory: Object.freeze({ count: 317, digest: INVENTORY_DIGEST }),
  compiledManifest: Object.freeze({ count: 8, digest: MANIFEST_DIGEST }),
  compiledEndpoints: Object.freeze({
    predecessor: PREDECESSOR_ENDPOINT,
    successor: SUCCESSOR_ENDPOINT,
  }),
  rowsDigest: ROWS_DIGEST,
});

export const POST_SCALAR_HELPER_HISTORY_COMPILED_RECONSTRUCTIONS = Object.freeze(
  SCALAR_HELPER_HISTORY_ROWS.map((row) => Object.freeze({ ...row, claim: CLAIM })),
);

export function validateScalarHelperHistoryHistoricalTransition({
  transition = SCALAR_HELPER_HISTORY_HISTORICAL_TRANSITION,
  inventory = SCALAR_HELPER_HISTORY_INVENTORY,
  reconstructions = POST_SCALAR_HELPER_HISTORY_COMPILED_RECONSTRUCTIONS,
} = {}) {
  const paths = reconstructions?.map((row) => row.path);
  const exactRows = Array.isArray(reconstructions) && reconstructions.every((row) =>
    row?.claim === CLAIM &&
    Object.keys(row).join(',') === 'path,currentDigest,expectedDigest,currentBlob,expectedBlob,replacements,claim' &&
    /^[0-9a-f]{64}$/u.test(row.currentDigest) &&
    /^[0-9a-f]{64}$/u.test(row.expectedDigest) &&
    /^[0-9a-f]{40}$/u.test(row.currentBlob) &&
    /^[0-9a-f]{40}$/u.test(row.expectedBlob) &&
    Array.isArray(row.replacements) && row.replacements.length === 1 &&
    Object.keys(row.replacements[0]).join(',') === 'current,historical'
  );
  if (
    transition?.claim !== CLAIM ||
    transition.predecessorCommit !== PREDECESSOR_COMMIT ||
    transition.successorCommit !== SUCCESSOR_COMMIT ||
    JSON.stringify(transition.compiledInventory) !== `{"count":317,"digest":"${INVENTORY_DIGEST}"}` ||
    JSON.stringify(transition.compiledManifest) !== `{"count":8,"digest":"${MANIFEST_DIGEST}"}` ||
    JSON.stringify(transition.compiledEndpoints) !== `{"predecessor":"${PREDECESSOR_ENDPOINT}","successor":"${SUCCESSOR_ENDPOINT}"}` ||
    transition.rowsDigest !== ROWS_DIGEST ||
    !Array.isArray(inventory) || inventory.length !== 317 || pathDigest(inventory) !== INVENTORY_DIGEST ||
    !exactRows || paths.length !== 8 || pathDigest(paths) !== MANIFEST_DIGEST ||
    rowsDigest(reconstructions) !== ROWS_DIGEST
  ) {
    throw new TypeError('scalar helper history transition immutable identity changed');
  }
  return true;
}

export function validateScalarHelperHistoryCompiledInventory(paths) {
  validateScalarHelperHistoryHistoricalTransition();
  if (
    !Array.isArray(paths) ||
    JSON.stringify(paths) !== JSON.stringify(SCALAR_HELPER_HISTORY_INVENTORY)
  ) {
    throw new TypeError('scalar helper history transition requires the exact stable compiled inventory');
  }
  return paths;
}

export function atScalarHelperHistoryCompiledPredecessor(path, currentSource) {
  validateScalarHelperHistoryHistoricalTransition();
  const reconstruction = POST_SCALAR_HELPER_HISTORY_COMPILED_RECONSTRUCTIONS.find((row) => row.path === path);
  if (reconstruction === undefined) return Buffer.from(currentSource);
  return reconstructHistoricalTransitionChain({
    currentSource,
    expectedTerminalDigest: reconstruction.expectedDigest,
    milestone: `scalar helper history predecessor compiled ${path}`,
    path,
    stages: [historicalTransitionStage(reconstruction)],
  });
}
