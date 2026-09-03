import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const AMEND = resolve(ROOT, 'scripts/kern-frontend-closure/amend.mjs');
const LEDGER = 'scripts/kern-frontend-closure/closure-ledger.json';
const AMENDMENTS = 'scripts/kern-frontend-closure/amendments';
const POLICY = 'scripts/kern-frontend-f5-projection/policy.json';
const KERN = 'examples/kern-frontend/f5-property-projection.kern';
const RECORD = `${AMENDMENTS}/rt8-integer-signatures.json`;
const GENESIS = '2db601683ecb9a09756f0a3bbd14ad1cae81ade17d75638d3b67ed2ba9724a0c';

const roots = [];

function scratch() {
  const root = mkdtempSync(resolve(tmpdir(), 'kern-amend-'));
  roots.push(root);
  const composition = JSON.parse(readFileSync(resolve(ROOT, POLICY), 'utf8')).composition.map(({ path }) => path);
  for (const path of [LEDGER, POLICY, ...composition]) {
    mkdirSync(resolve(root, dirname(path)), { recursive: true });
    cpSync(resolve(ROOT, path), resolve(root, path));
  }
  cpSync(resolve(ROOT, AMENDMENTS), resolve(root, AMENDMENTS), { recursive: true });
  return root;
}

test.after(() => { for (const root of roots) rmSync(root, { force: true, recursive: true }); });

function run(root, ...args) {
  try {
    return { ok: true, out: execFileSync('node', [AMEND, '--root', root, ...args], { encoding: 'utf8' }) };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

const text = (root, path) => readFileSync(resolve(root, path), 'utf8');
const json = (root, path) => JSON.parse(text(root, path));
const write = (root, path, value) => writeFileSync(resolve(root, path), value);
const record = (root) => json(root, RECORD);
const putRecord = (root, value) => write(root, RECORD, `${JSON.stringify(value, null, 2)}\n`);
const pinOf = (root) => json(root, POLICY).composition.find(({ path }) => path === KERN).sha256;
const setPin = (root, value) => write(root, POLICY, text(root, POLICY).replace(`"${pinOf(root)}"`, `"${value}"`));
const drift = (root) => write(root, KERN, `${text(root, KERN)}\n`);

function pending(root) {
  const value = record(root);
  delete value.repin[0].resultDigest;
  putRecord(root, value);
  setPin(root, GENESIS);
  return root;
}

test('the settled chain verifies and re-pinning is idempotent', () => {
  const root = scratch();
  assert.match(run(root).out, /chain verified, 0 pending/u);
  const before = text(root, POLICY);
  assert.equal(run(root, '--write').ok, true);
  assert.equal(text(root, POLICY), before, 'a settled chain must not rewrite the pin');
  assert.deepEqual(record(root), json(scratch(), RECORD), 'a settled chain must not rewrite the record');
});

test('a pending amendment re-pins exactly its entry, records the result digest, and settles', () => {
  const root = pending(scratch());
  assert.match(run(root).out, /chain verified, 1 pending/u);
  const before = json(root, POLICY);
  assert.equal(run(root, '--write').ok, true);
  const after = json(root, POLICY);
  const moved = after.composition.filter((entry, index) => entry.sha256 !== before.composition[index].sha256);
  assert.deepEqual(moved.map(({ path }) => path), [KERN]);
  assert.deepEqual({ ...after, composition: null }, { ...before, composition: null }, 'no other policy field may move');
  assert.equal(record(root).repin[0].resultDigest, pinOf(root), 'the consumed edge must record its result');
  assert.match(run(root).out, /chain verified, 0 pending/u);
  const settled = text(root, POLICY);
  assert.equal(run(root, '--write').ok, true);
  assert.equal(text(root, POLICY), settled, 'the second write must be a no-op');
});

test('a consumed amendment cannot re-bless a later edit', () => {
  const root = scratch();
  drift(root);
  const settled = text(root, POLICY);
  const result = run(root, '--write');
  assert.equal(result.ok, false);
  assert.match(result.out, /drifted with no amendment naming it/u);
  assert.equal(text(root, POLICY), settled, 'a refused run must not write');
});

test('a second amendment chaining from the consumed result digest is accepted and re-pins', () => {
  const root = scratch();
  const next = { ...record(root), id: 'rt9-successor' };
  next.repin = [{ ...next.repin[0], parentDigest: record(root).repin[0].resultDigest }];
  delete next.repin[0].resultDigest;
  write(root, `${AMENDMENTS}/rt9-successor.json`, `${JSON.stringify(next, null, 2)}\n`);
  assert.match(run(root).out, /chain verified, 0 pending/u);
  drift(root);
  assert.equal(run(root, '--write').ok, true);
  assert.equal(pinOf(root), json(root, `${AMENDMENTS}/rt9-successor.json`).repin[0].resultDigest);
  assert.match(run(root).out, /chain verified, 0 pending/u);
});

test('a deleted consumed record breaks the chain', () => {
  const root = scratch();
  rmSync(resolve(root, RECORD));
  const result = run(root);
  assert.equal(result.ok, false);
  assert.match(result.out, /chain does not reach the current pin/u);
});

test('a consumed record with a corrupted parent digest is orphaned', () => {
  const root = scratch();
  const value = record(root);
  value.repin[0].parentDigest = 'a'.repeat(64);
  putRecord(root, value);
  assert.match(run(root).out, /orphaned amendment edge/u);
});

test('a consumed record with a corrupted result digest breaks the chain', () => {
  const root = scratch();
  const value = record(root);
  value.repin[0].resultDigest = 'b'.repeat(64);
  putRecord(root, value);
  assert.match(run(root).out, /chain does not reach the current pin/u);
});

test('two edges leaving the same digest fork the chain', () => {
  const root = scratch();
  cpSync(resolve(root, RECORD), resolve(root, `${AMENDMENTS}/rt9-fork.json`));
  const fork = record(root);
  fork.id = 'rt9-fork';
  write(root, `${AMENDMENTS}/rt9-fork.json`, `${JSON.stringify(fork, null, 2)}\n`);
  assert.match(run(root).out, /chain forks at/u);
});

test('an amendment naming an unanchored composition file is refused', () => {
  const root = scratch();
  const other = 'examples/kern-frontend/f5-tree-projection.kern';
  const value = { ...record(root), id: 'rt9-unanchored' };
  value.repin = [{
    ...value.repin[0],
    parentDigest: json(root, POLICY).composition.find(({ path }) => path === other).sha256,
    path: other,
  }];
  delete value.repin[0].resultDigest;
  write(root, `${AMENDMENTS}/rt9-unanchored.json`, `${JSON.stringify(value, null, 2)}\n`);
  assert.match(run(root).out, /unanchored amendment edge/u);
});

test('drift in an unamended composition file is refused', () => {
  const root = scratch();
  const other = 'examples/kern-frontend/f5-tree-projection.kern';
  write(root, other, `${text(root, other)}\n`);
  assert.match(run(root).out, /drifted with no amendment naming it/u);
});

test('structural defects are refused for every record, consumed or pending', () => {
  for (const [mutate, pattern] of [
    [(value) => { value.change = 'replacing'; }, /is not an additive amendment/u],
    [(value) => { value.format = 'wrong'; }, /format/u],
    [(value) => { value.id = ''; }, /carries no id/u],
    [(value) => { value.rows = []; }, /declares no rows/u],
    [(value) => value.rows.push({ disposition: 'invented', stableKey: 'fn.name' }), /row fn.name/u],
    [(value) => value.rows.push({ ...value.rows[0] }), /duplicate row/u],
    [(value) => { value.addedSpellings = []; }, /adds no spelling/u],
    [(value) => { value.addedSpellings[0].kirKind = 7; }, /spelling shape/u],
    [(value) => { value.repin[0].pin = 'scripts/other.json'; }, /unsupported pin/u],
    [(value) => { value.repin[0].parentDigest = 'short'; }, /parent digest shape/u],
    [(value) => { value.repin[0].resultDigest = 'short'; }, /result digest shape/u],
  ]) {
    const root = scratch();
    const value = record(root);
    mutate(value);
    putRecord(root, value);
    assert.match(run(root).out, pattern);
  }
});

test('a duplicate amendment id is refused', () => {
  const root = scratch();
  cpSync(resolve(root, RECORD), resolve(root, `${AMENDMENTS}/rt8-copy.json`));
  assert.match(run(root).out, /duplicate amendment id/u);
});

test('ledger digest and counts are enforced on a pending record and ignored on a consumed one', () => {
  for (const [mutate, pattern] of [
    [(value) => { value.parentClosureLedgerSha256 = 'c'.repeat(64); }, /parent ledger digest/u],
    [(value) => { value.counts.nodes = 303; }, /node count changed/u],
    [(value) => { value.counts.properties = 1150; }, /property count changed/u],
    [(value) => value.rows.push({ disposition: 'lowered-type', stableKey: 'fn.extra' }), /claims unknown lowered-type rows/u],
  ]) {
    const consumed = scratch();
    const settledValue = record(consumed);
    mutate(settledValue);
    putRecord(consumed, settledValue);
    assert.match(run(consumed).out, /chain verified/u, 'a consumed record is not re-checked against the live ledger');

    const root = pending(scratch());
    const value = record(root);
    mutate(value);
    putRecord(root, value);
    drift(root);
    const result = run(root, '--write');
    assert.equal(result.ok, false);
    assert.match(result.out, pattern);
  }
});

test('a live ledger change does not block a consumed record or its successor', () => {
  const root = scratch();
  write(root, LEDGER, `${text(root, LEDGER)}\n`);
  assert.match(run(root).out, /chain verified, 0 pending/u);
});

test('the amendment record stays load-bearing after it is consumed', () => {
  const value = JSON.parse(readFileSync(resolve(ROOT, RECORD), 'utf8'));
  assert.equal(value.id, 'rt8-integer-signatures');
  assert.equal(value.change, 'additive');
  assert.deepEqual(value.counts, { nodes: 302, properties: 1149 });
  assert.deepEqual(value.rows.map(({ stableKey }) => stableKey).sort(), ['fn.returns', 'param.type']);
  assert.ok(value.rows.every(({ disposition }) => disposition === 'lowered-type'));
  assert.deepEqual(value.addedSpellings.map(({ source }) => source), ['integer', 'integer[]']);
  assert.equal(value.repin[0].path, KERN);
  assert.equal(value.repin[0].parentDigest, GENESIS);
});
