import { createHash } from 'node:crypto';

import { HOST_COMPANION_HISTORY_4_6_ROWS } from './host-companion-history-4-6-transition-data.mjs';
import {
  createHistoricalPredecessorClosure,
  hasExactHistoricalRowStructure,
  isExactPlainDataRecord,
} from './scalar-history-transition-structure.mjs';

const CLAIM = 'kern.compiler.host-companion-history-4-6.r0';
const PREDECESSOR_COMMIT = '8a453a4447572194a314df57e717396169b9accf';
const SUCCESSOR_COMMIT = '91f794dc31ebe11a9d29a8b25479f03900141950';
const MANIFEST_DIGEST = '05053fd4d10925c0c8b14873f59a32cca799ce612d0d0b2c17a79bc899600bca';
const ROWS_DIGEST = '690dc37665a6ab09a2c11c5c9e254936665a318dccf6a08b2ee9436ead72d983';
const PREDECESSOR_ENDPOINT = 'ab865fe01a7c6349e7b9bb9152baf1999e4f01b954b9e5f83b6e3814f5186e18';
const SUCCESSOR_ENDPOINT = 'bb5cecfb3674d15cd7ec632c5fc63a21fad4bd42b774e5ff5e01bc9d1b3aa590';
const PATHS = Object.freeze([
  'codegen-expression.js',
  'codegen/host-namespace-ir.js',
  'codegen/host-namespace.js',
  'index.js',
  'spec.js',
]);
const TRANSITION_KEYS = Object.freeze([
  'claim',
  'predecessorCommit',
  'successorCommit',
  'compiledManifest',
  'compiledEndpoints',
  'rowsDigest',
]);
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitBlob(bytes) {
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest('hex');
}

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

function endpointDigest(rows, field) {
  const hash = createHash('sha256');
  for (const row of rows) {
    const bytes = Buffer.from(row.replacements[0][field]);
    hash.update(`${row.path.length}:${row.path}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function exactRow(row) {
  if (
    !hasExactHistoricalRowStructure(row) ||
    row.claim !== CLAIM ||
    !/^[0-9a-f]{64}$/u.test(row.currentDigest) ||
    !/^[0-9a-f]{64}$/u.test(row.expectedDigest) ||
    !/^[0-9a-f]{40}$/u.test(row.currentBlob) ||
    !/^[0-9a-f]{40}$/u.test(row.expectedBlob) ||
    typeof row.replacements[0].current !== 'string' ||
    row.replacements[0].current.length === 0 ||
    typeof row.replacements[0].historical !== 'string'
  ) {
    return false;
  }
  const current = Buffer.from(row.replacements[0].current);
  const historical = Buffer.from(row.replacements[0].historical);
  return sha256(current) === row.currentDigest &&
    sha256(historical) === row.expectedDigest &&
    gitBlob(current) === row.currentBlob &&
    gitBlob(historical) === row.expectedBlob;
}

export const HOST_COMPANION_HISTORY_4_6_HISTORICAL_TRANSITION = Object.freeze({
  claim: CLAIM,
  predecessorCommit: PREDECESSOR_COMMIT,
  successorCommit: SUCCESSOR_COMMIT,
  compiledManifest: Object.freeze({ count: 5, digest: MANIFEST_DIGEST }),
  compiledEndpoints: Object.freeze({
    predecessor: PREDECESSOR_ENDPOINT,
    successor: SUCCESSOR_ENDPOINT,
  }),
  rowsDigest: ROWS_DIGEST,
});

export const POST_HOST_COMPANION_HISTORY_4_6_COMPILED_RECONSTRUCTIONS = Object.freeze(
  HOST_COMPANION_HISTORY_4_6_ROWS.map((row) => Object.freeze({ ...row, claim: CLAIM })),
);

export function validateHostCompanionHistory4_6HistoricalTransition({
  transition = HOST_COMPANION_HISTORY_4_6_HISTORICAL_TRANSITION,
  reconstructions = POST_HOST_COMPANION_HISTORY_4_6_COMPILED_RECONSTRUCTIONS,
} = {}) {
  const exactTransition = isExactPlainDataRecord(transition, TRANSITION_KEYS) &&
    transition.claim === CLAIM &&
    transition.predecessorCommit === PREDECESSOR_COMMIT &&
    transition.successorCommit === SUCCESSOR_COMMIT &&
    isExactPlainDataRecord(transition.compiledManifest, ['count', 'digest']) &&
    transition.compiledManifest.count === 5 &&
    transition.compiledManifest.digest === MANIFEST_DIGEST &&
    isExactPlainDataRecord(transition.compiledEndpoints, ['predecessor', 'successor']) &&
    transition.compiledEndpoints.predecessor === PREDECESSOR_ENDPOINT &&
    transition.compiledEndpoints.successor === SUCCESSOR_ENDPOINT &&
    transition.rowsDigest === ROWS_DIGEST;
  const exactRows = Array.isArray(reconstructions) && reconstructions.every(exactRow);
  const paths = exactRows ? reconstructions.map((row) => row.path) : [];
  if (
    !exactTransition ||
    !exactRows ||
    JSON.stringify(paths) !== JSON.stringify(PATHS) ||
    pathDigest(paths) !== MANIFEST_DIGEST ||
    rowsDigest(reconstructions) !== ROWS_DIGEST ||
    endpointDigest(reconstructions, 'historical') !== PREDECESSOR_ENDPOINT ||
    endpointDigest(reconstructions, 'current') !== SUCCESSOR_ENDPOINT
  ) {
    throw new TypeError('host companion history 4.6 transition immutable identity changed');
  }
  return true;
}

export function createValidatedHostCompanionHistory4_6CompiledPredecessor() {
  validateHostCompanionHistory4_6HistoricalTransition();
  return createHistoricalPredecessorClosure(
    POST_HOST_COMPANION_HISTORY_4_6_COMPILED_RECONSTRUCTIONS,
    'host companion history 4.6 predecessor compiled',
  );
}

export function atHostCompanionHistory4_6CompiledPredecessor(path, currentSource) {
  const predecessor = createValidatedHostCompanionHistory4_6CompiledPredecessor();
  return predecessor(path, currentSource);
}
