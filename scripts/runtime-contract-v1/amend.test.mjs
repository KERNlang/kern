import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const AMEND = resolve(ROOT, 'scripts/runtime-contract-v1/amend.mjs');
const CONTRACT = 'scripts/runtime-contract-v1';
const RECORD = `${CONTRACT}/amendments/kern-5-runtime-envelope-max-iterations.json`;
const roots = [];

function scratch() {
  const root = mkdtempSync(resolve(tmpdir(), 'kern-runtime-contract-amend-'));
  roots.push(root);
  cpSync(resolve(ROOT, CONTRACT), resolve(root, CONTRACT), { recursive: true });
  return root;
}

test.after(() => { for (const root of roots) rmSync(root, { force: true, recursive: true }); });

function run(root, ...args) {
  try {
    return { ok: true, output: execFileSync('node', [AMEND, '--root', root, ...args], { encoding: 'utf8' }) };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

const text = (root, path) => readFileSync(resolve(root, path), 'utf8');
const json = (root, path) => JSON.parse(text(root, path));
const write = (root, path, value) => writeFileSync(resolve(root, path), value);
const putRecord = (root, value, path = RECORD) => write(root, path, `${JSON.stringify(value, null, 2)}\n`);

test('the settled amendment chain verifies and writing it is idempotent', () => {
  const root = scratch();
  assert.match(run(root).output, /chain verified, 0 pending/u);
  const before = text(root, `${CONTRACT}/lineage.json`);
  assert.equal(run(root, '--write').ok, true);
  assert.equal(text(root, `${CONTRACT}/lineage.json`), before);
});

test('a consumed amendment cannot authorize later artifact drift', () => {
  const root = scratch();
  const path = `${CONTRACT}/constitution.json`;
  write(root, path, `${text(root, path)}\n`);
  const before = text(root, `${CONTRACT}/lineage.json`);
  const result = run(root, '--write');
  assert.equal(result.ok, false);
  assert.match(result.output, /artifact drifted with no pending amendment/u);
  assert.equal(text(root, `${CONTRACT}/lineage.json`), before);
});

test('a deleted or corrupted consumed amendment breaks the chain', () => {
  const deleted = scratch();
  rmSync(resolve(deleted, RECORD));
  assert.match(run(deleted).output, /does not reach the current pin/u);

  const corrupted = scratch();
  const value = json(corrupted, RECORD);
  value.resultDigests.constitutionSha256 = 'a'.repeat(64);
  putRecord(corrupted, value);
  assert.match(run(corrupted).output, /does not reach the current pin/u);
});

test('a successor edge is accepted only from the consumed result', () => {
  const root = scratch();
  const value = json(root, RECORD);
  const successor = {
    ...value,
    slice: 'successor',
    parentDigests: value.resultDigests,
    rowsChanged: ['limits.future'],
  };
  delete successor.resultDigests;
  putRecord(root, successor, `${CONTRACT}/amendments/successor.json`);
  write(root, `${CONTRACT}/constitution.json`, `${text(root, `${CONTRACT}/constitution.json`)}\n`);
  assert.match(run(root).output, /chain verified, 1 pending/u);
  assert.equal(run(root, '--write').ok, true);
  assert.match(run(root).output, /chain verified, 0 pending/u);
});

test('a pending amendment must name the current pin as its parent', () => {
  const root = scratch();
  const value = json(root, RECORD);
  const successor = { ...value, slice: 'successor', parentDigests: value.resultDigests, rowsChanged: ['limits.future'] };
  delete successor.resultDigests;
  putRecord(root, successor, `${CONTRACT}/amendments/successor.json`);
  write(root, `${CONTRACT}/constitution.json`, `${text(root, `${CONTRACT}/constitution.json`)}\n`);
  const lineagePath = `${CONTRACT}/lineage.json`;
  const drifted = json(root, lineagePath);
  drifted.versions[0].goldensSha256 = 'c'.repeat(64);
  write(root, lineagePath, `${JSON.stringify(drifted, null, 2)}\n`);
  const before = text(root, lineagePath);
  assert.match(run(root).output, /pending amendment parents do not match the current pin/u);
  assert.equal(run(root, '--write').ok, false);
  assert.equal(text(root, lineagePath), before);
});

test('forked, orphaned, and non-additive records are refused', () => {
  for (const [mutate, pattern] of [
    [(value) => { value.slice = 'fork'; }, /exactly one genesis/u],
    [(value) => { value.slice = 'orphan'; value.parentDigests.constitutionSha256 = 'b'.repeat(64); }, /exactly one genesis/u],
    [(value) => { value.slice = 'replacement'; value.disposition = 'replacing'; }, /not an additive amendment/u],
  ]) {
    const root = scratch();
    const value = json(root, RECORD);
    mutate(value);
    putRecord(root, value, `${CONTRACT}/amendments/extra.json`);
    assert.match(run(root).output, pattern);
  }
});
