import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { REPO_ROOT } from './support.mjs';

const CONTRACT_DIR = 'scripts/runtime-contract-v1';
const AMENDMENTS_DIR = join(REPO_ROOT, CONTRACT_DIR, 'amendments');
const AMEND_SCRIPT = join(REPO_ROOT, CONTRACT_DIR, 'amend.mjs');
const SLICE = 'kern-5-runtime-envelope-max-iterations';

const PINNED = Object.freeze({
  constitutionSha256: 'constitution.json',
  declarationSchemaSha256: 'public-declaration-schema.json',
  goldensSha256: 'goldens.json',
  proofInventorySha256: 'proof-inventory.json',
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const text = (name) => readFileSync(join(REPO_ROOT, CONTRACT_DIR, name), 'utf8');
const lineage = () => JSON.parse(text('lineage.json'));

test('L7: the amendment writer exists and is not itself inside the pinned artefact set', () => {
  assert.ok(existsSync(AMEND_SCRIPT), `${CONTRACT_DIR}/amend.mjs must exist`);
  const authority = JSON.parse(text('authority.json'));
  for (const artifact of authority.artifacts) {
    assert.ok(artifact.endsWith('.json'), `authority must pin data, not code: ${artifact}`);
  }
  assert.ok(
    !authority.artifacts.some((artifact) => artifact.endsWith('amend.mjs')),
    'the writer must sit outside its own pin',
  );
});

test('L7: an amendment record for this slice exists and declares the rows it changes', () => {
  assert.ok(existsSync(AMENDMENTS_DIR), `${CONTRACT_DIR}/amendments/ must exist`);
  const record = JSON.parse(readFileSync(join(AMENDMENTS_DIR, `${SLICE}.json`), 'utf8'));
  assert.equal(record.format, 'kern.runtime.contract.amendment.v1');
  assert.equal(record.slice, SLICE);
  assert.equal(record.disposition, 'additive');
  assert.deepEqual([...record.rowsChanged].sort(), ['limits.maxIterations']);
  for (const key of Object.keys(PINNED)) {
    assert.match(record.parentDigests[key], /^[0-9a-f]{64}$/u, `parentDigests.${key}`);
    assert.match(record.resultDigests[key], /^[0-9a-f]{64}$/u, `resultDigests.${key}`);
    assert.notEqual(record.parentDigests[key], record.resultDigests[key], `${key} must actually move`);
  }
});

test('L7: the amendment parents are the digests the base commit pinned', () => {
  const record = JSON.parse(readFileSync(join(AMENDMENTS_DIR, `${SLICE}.json`), 'utf8'));
  assert.deepEqual(record.parentDigests, {
    constitutionSha256: 'f626dfe8c55bec728d2d84b88dee9e07f53b82ea54ffc8083c2f7eaffdb4ad20',
    declarationSchemaSha256: 'f611dbdd9d7cb688cf6c990203faf97188302dfa7e3d5cc78bdebc0844f855c3',
    goldensSha256: '1ab12a799ff03725d810b677bb8597df19045488e0eca524af3f370c3b9e79da',
    proofInventorySha256: '993f490d13840d972ee7998c87f52afea5c0b044849585bf32d7e4a263cf4f86',
  });
});

test('L7: the amendment result digests equal the live artefacts and the live pin', () => {
  const record = JSON.parse(readFileSync(join(AMENDMENTS_DIR, `${SLICE}.json`), 'utf8'));
  const [version] = lineage().versions;
  for (const [key, name] of Object.entries(PINNED)) {
    assert.equal(sha256(text(name)), record.resultDigests[key], `${name} must match the amendment result`);
    assert.equal(version[key], record.resultDigests[key], `lineage.${key} must match the amendment result`);
  }
});

test('L7: the lineage still holds exactly one version — the record is a sidecar', () => {
  const value = lineage();
  assert.equal(value.format, 'kern.runtime.contract.lineage.v1');
  assert.equal(value.versions.length, 1);
  assert.deepEqual(Object.keys(value).sort(), ['format', 'versions']);
});

test('L7: the writer verifies the chain and refuses an unlicensed re-pin', async () => {
  const { verifyRuntimeContractAmendmentChain } = await import(AMEND_SCRIPT);
  assert.equal(typeof verifyRuntimeContractAmendmentChain, 'function');
  const verified = verifyRuntimeContractAmendmentChain();
  assert.equal(verified.pendingRepins.length, 0, 'no re-pin may be pending once the chain is settled');
  assert.ok(verified.consumed.includes(SLICE), 'this slice must appear as a consumed edge');
});
