import { createHash } from 'node:crypto';

import { SCALAR_HELPER_HISTORY_4_6_ROWS } from './scalar-helper-history-4-6-transition-data.mjs';
import {
  createHistoricalPredecessorClosure,
  hasExactHistoricalRowStructure,
  isExactPlainDataRecord,
} from './scalar-history-transition-structure.mjs';

const CLAIM = 'kern.runtime.scalar-helper-history-4-6.r0';
const PREDECESSOR_COMMIT = '8a453a4447572194a314df57e717396169b9accf';
const SUCCESSOR_COMMIT = '91f794dc31ebe11a9d29a8b25479f03900141950';
const MANIFEST_DIGEST = 'c6c7f22ef7796f24ef20a80ac1a1dd63acc45727aff1eb4d1b4a7b815288a87b';
const ROWS_DIGEST = '4ff1b3eb73ccb1450ad3fda804275bb26cf319759a5de818675a55e78466eeb3';
const PREDECESSOR_ENDPOINT = '584a3757c6fdc7e3d60023c303e57252633ba55f4acb7237a4859bbeecc26601';
const SUCCESSOR_ENDPOINT = '4a5b58c0dbd0354a3427acae6dcfee89e4d1a1e690e871365ca80ecb7f94f7ce';
const PATHS = Object.freeze([
  'codegen/kern-stdlib.js',
  'codegen/stdlib-preamble.js',
  'codegen/text-contract.js',
  'ir/semantics/portable-machine-shape.js',
  'ir/semantics/portable-string.js',
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

export const SCALAR_HELPER_HISTORY_4_6_HISTORICAL_TRANSITION = Object.freeze({
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

export const POST_SCALAR_HELPER_HISTORY_4_6_COMPILED_RECONSTRUCTIONS = Object.freeze(
  SCALAR_HELPER_HISTORY_4_6_ROWS.map((row) => Object.freeze({ ...row, claim: CLAIM })),
);

export function validateScalarHelperHistory4_6HistoricalTransition({
  transition = SCALAR_HELPER_HISTORY_4_6_HISTORICAL_TRANSITION,
  reconstructions = POST_SCALAR_HELPER_HISTORY_4_6_COMPILED_RECONSTRUCTIONS,
} = {}) {
  const exactRows = Array.isArray(reconstructions) && reconstructions.every(exactRow);
  const paths = exactRows ? reconstructions.map((row) => row.path) : [];
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
  if (
    !exactTransition ||
    !exactRows ||
    JSON.stringify(paths) !== JSON.stringify(PATHS) ||
    pathDigest(paths) !== MANIFEST_DIGEST ||
    rowsDigest(reconstructions) !== ROWS_DIGEST ||
    endpointDigest(reconstructions, 'historical') !== PREDECESSOR_ENDPOINT ||
    endpointDigest(reconstructions, 'current') !== SUCCESSOR_ENDPOINT
  ) {
    throw new TypeError('scalar helper history 4.6 transition immutable identity changed');
  }
  return true;
}

export function createValidatedScalarHelperHistory4_6CompiledPredecessor() {
  validateScalarHelperHistory4_6HistoricalTransition();
  return createHistoricalPredecessorClosure(
    POST_SCALAR_HELPER_HISTORY_4_6_COMPILED_RECONSTRUCTIONS,
    'scalar helper history 4.6 predecessor compiled',
  );
}

export function atScalarHelperHistory4_6CompiledPredecessor(path, currentSource) {
  const predecessor = createValidatedScalarHelperHistory4_6CompiledPredecessor();
  return predecessor(path, currentSource);
}
