import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFERRAL_LABEL,
  LEDGER,
  LEDGER_FORMAT,
  LEDGER_KEYS,
  LEDGER_RAW,
  LEDGER_SHA256,
  LEDGER_URL,
  ROW_KEYS,
  SURFACES,
  ledgerRows,
  sha256,
  validateLedger,
} from './ledger-support.mjs';

const ROW = Object.freeze({
  blockedBy: [],
  label: DEFERRAL_LABEL,
  nodeKind: 'while',
  since: 'kern-5-parity-ledger',
  spec: '.Codex/specs/kern-5-parity-ledger/spec.md',
  surface: 'statement',
});

function document(rows) {
  return { format: LEDGER_FORMAT, label: DEFERRAL_LABEL, rows: structuredClone(rows) };
}

test('the parity ledger declares the pinned format and label', () => {
  assert.deepEqual(Object.keys(LEDGER).sort(), [...LEDGER_KEYS].sort());
  assert.equal(LEDGER.format, LEDGER_FORMAT);
  assert.equal(LEDGER.label, DEFERRAL_LABEL);
  assert.ok(Array.isArray(LEDGER.rows));
});

test('the parity ledger carries its own independent digest', () => {
  assert.match(LEDGER_SHA256, /^[0-9a-f]{64}$/u);
  assert.equal(
    sha256(LEDGER_RAW),
    LEDGER_SHA256,
    'PARITY_LEDGER_DIGEST_DRIFT: the ledger moved without its pin being re-stated',
  );
});

test('the parity ledger lives outside the compiled core', () => {
  const path = LEDGER_URL.pathname;
  assert.ok(path.endsWith('/scripts/kern-5-parity-ledger/parity-ledger.json'), path);
  assert.equal(path.includes('/packages/core/'), false, 'PARITY_LEDGER_PLACEMENT: the ledger must not enter the core');
});

test('the mechanism slice ships an empty ledger', () => {
  assert.deepEqual(ledgerRows(), [], 'the first deferred row belongs to the slice that freezes a node kind');
});

test('a well-formed row set validates, in any admitted surface', () => {
  for (const surface of SURFACES) {
    assert.deepEqual(validateLedger(document([{ ...ROW, surface }])).rows.length, 1);
  }
  const ordered = [{ ...ROW, nodeKind: 'each' }, { ...ROW, blockedBy: ['each'] }];
  assert.equal(validateLedger(document(ordered)).rows.length, 2);
});

test('the row schema rejects every drift the catch-up procedure could introduce', () => {
  const mutations = [
    ['unknown ledger key', () => ({ ...document([]), extra: true })],
    ['missing ledger key', () => ({ label: DEFERRAL_LABEL, rows: [] })],
    ['foreign format', () => ({ ...document([]), format: 'kern.compiler.kir-python.parity-ledger.v2' })],
    ['foreign ledger label', () => ({ ...document([]), label: 'KIR_PYTHON_DEFERRED' })],
    ['rows not an array', () => ({ ...document([]), rows: {} })],
    ['unknown row key', () => document([{ ...ROW, ttl: 3 }])],
    ['missing row key', () => document([{ ...ROW, since: undefined }])],
    ['a blame digest resurrected as provenance', () => document([{ ...ROW, jsLoweringBlameDigest: 'a'.repeat(64) }])],
    ['row label disagreeing with the ledger', () => document([{ ...ROW, label: 'KIR_PYTHON_TODO' }])],
    ['unknown surface', () => document([{ ...ROW, surface: 'kernel' }])],
    ['free-text since', () => document([{ ...ROW, since: 'later' }])],
    ['free-text spec', () => document([{ ...ROW, spec: 'see the while slice' }])],
    ['spec outside the slice spec tree', () => document([{ ...ROW, spec: '.Codex/specs/ci-pnpm-cache/spec.md' }])],
    ['spec naming a slice with no spec on disk', () => document([{ ...ROW, spec: '.Codex/specs/kern-5-rt99-nope/spec.md' }])],
    ['node kind that is not a kind', () => document([{ ...ROW, nodeKind: 'While' }])],
    ['duplicate node kind', () => document([ROW, { ...ROW }])],
    ['unsorted rows', () => document([{ ...ROW }, { ...ROW, nodeKind: 'each' }])],
    ['blockedBy naming an absent row', () => document([{ ...ROW, blockedBy: ['each'] }])],
    ['blockedBy naming itself', () => document([{ ...ROW, blockedBy: [ROW.nodeKind] }])],
    ['blockedBy that is not an array', () => document([{ ...ROW, blockedBy: 'each' }])],
  ];
  for (const [label, mutate] of mutations) {
    assert.throws(() => validateLedger(mutate()), /parity ledger rejection/u, `the schema admitted ${label}`);
  }
});

test('the ledger the repository ships passes its own schema', () => {
  assert.equal(validateLedger(structuredClone(LEDGER)).format, LEDGER_FORMAT);
});
