import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { REPO_ROOT } from './support.mjs';

const CONTRACT_DIR = 'scripts/runtime-contract-v1';
const AMENDMENTS_DIR = join(REPO_ROOT, CONTRACT_DIR, 'amendments');
const AMEND_SCRIPT = join(REPO_ROOT, CONTRACT_DIR, 'amend.mjs');
const AUTHORITY_SCRIPT = join(REPO_ROOT, CONTRACT_DIR, 'validate-runtime-contract-v1-authority.mjs');
const AUTHORITY_PATH = `${CONTRACT_DIR}/authority.json`;
const SLICE = 'kern-5-runtime-envelope-max-iterations';
const SYNTHETIC_PROMOTION = 'b'.repeat(40);
const SYNTHETIC_CURRENT = 'f'.repeat(40);

const PINNED = Object.freeze({
  constitutionSha256: 'constitution.json',
  declarationSchemaSha256: 'public-declaration-schema.json',
  goldensSha256: 'goldens.json',
  proofInventorySha256: 'proof-inventory.json',
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const text = (name) => readFileSync(join(REPO_ROOT, CONTRACT_DIR, name), 'utf8');
const lineage = () => JSON.parse(text('lineage.json'));
const amendmentFiles = () => readdirSync(AMENDMENTS_DIR)
  .filter((name) => name.endsWith('.json') && name !== 'chain-anchor.json').sort();
const records = () => amendmentFiles()
  .map((name) => ({ name, record: JSON.parse(readFileSync(join(AMENDMENTS_DIR, name), 'utf8')) }));

const authorityRecord = () => JSON.parse(readFileSync(join(REPO_ROOT, AUTHORITY_PATH), 'utf8'));

function runGit(argv) {
  if (['cat-file', 'ls-tree', 'merge-base'].includes(argv[0])) return { status: 0, stderr: '', stdout: '' };
  if (argv[0] === 'log') return { status: 0, stderr: '', stdout: `${SYNTHETIC_PROMOTION}\n` };
  if (argv[0] === 'show') {
    if (argv[1] === '-s') return { status: 0, stderr: '', stdout: `${authorityRecord().introductionCommit}\n` };
    if (argv[1].startsWith(`${SYNTHETIC_PROMOTION}:`)) {
      return {
        status: 0,
        stderr: '',
        stdout: readFileSync(join(REPO_ROOT, argv[1].slice(SYNTHETIC_PROMOTION.length + 1)), 'utf8'),
      };
    }
    return { status: 0, stderr: '', stdout: execFileSync('git', argv, { cwd: REPO_ROOT, encoding: 'utf8' }) };
  }
  throw new Error(`unexpected git command ${argv.join(' ')}`);
}

function authorityOptions(overrides = {}) {
  return {
    currentCommit: SYNTHETIC_CURRENT,
    readText: (path) => readFileSync(join(REPO_ROOT, path), 'utf8'),
    runGit,
    ...overrides,
  };
}

function withRecordText(mutate) {
  return authorityOptions({
    readText(path) {
      const value = readFileSync(join(REPO_ROOT, path), 'utf8');
      if (!path.startsWith(`${CONTRACT_DIR}/amendments/`)) return value;
      const mutated = mutate(path, JSON.parse(value));
      return mutated === null ? value : `${JSON.stringify(mutated, null, 2)}\n`;
    },
  });
}

const scratchRoots = [];

test.after(() => { for (const root of scratchRoots) rmSync(root, { force: true, recursive: true }); });

function scratchContract() {
  const root = mkdtempSync(resolve(tmpdir(), 'kern-5-envelope-amendment-'));
  scratchRoots.push(root);
  cpSync(join(REPO_ROOT, CONTRACT_DIR), resolve(root, CONTRACT_DIR), { recursive: true });
  return root;
}

function runAmend(root, ...args) {
  try {
    return { ok: true, output: execFileSync('node', [AMEND_SCRIPT, '--root', root, ...args], { encoding: 'utf8' }) };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

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

test('L7: the terminal chain result equals the live artefacts and the live pin', () => {
  const [version] = lineage().versions;
  const terminal = records().find(({ record }) =>
    Object.keys(PINNED).every((key) => record.resultDigests?.[key] === version[key]));
  assert.ok(terminal, 'exactly one amendment result must equal the live pin');
  for (const [key, name] of Object.entries(PINNED)) {
    assert.equal(sha256(text(name)), terminal.record.resultDigests[key], `${name} must match the chain terminal`);
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

test('L7: the authority validator names no amendment and authorizes the composed chain', async () => {
  const { validateRuntimeContractV1Authority } = await import(AUTHORITY_SCRIPT);
  const source = readFileSync(AUTHORITY_SCRIPT, 'utf8');
  for (const { record } of records()) {
    assert.ok(!source.includes(record.slice), `the validator must not name ${record.slice}`);
  }
  const evidence = validateRuntimeContractV1Authority(authorityOptions());
  assert.deepEqual([...evidence.amendments].sort(), records().map(({ record }) => record.slice).sort());
  assert.equal(evidence.amendments[0], SLICE, 'the genesis edge must compose first');
  assert.equal(evidence.amendments.length, records().length);
  assert.deepEqual(evidence.amendedRows, ['limits.maxIterations']);
  assert.equal(evidence.runtimeAbiFrozen, true);
});

test('L7: the authority validator refuses a record whose rows disagree with the artefact delta', async () => {
  const { validateRuntimeContractV1Authority } = await import(AUTHORITY_SCRIPT);
  assert.throws(
    () => validateRuntimeContractV1Authority(withRecordText((path, record) =>
      (record.slice === SLICE ? { ...record, rowsChanged: ['limits.unrelated'] } : null))),
    /limits\.unrelated is declared but no artifact change explains it/u,
  );
});

test('L7: the authority validator refuses a chain that does not anchor to the ratified artefacts', async () => {
  const { validateRuntimeContractV1Authority } = await import(AUTHORITY_SCRIPT);
  assert.throws(
    () => validateRuntimeContractV1Authority(withRecordText((path, record) =>
      (record.slice === SLICE
        ? { ...record, parentDigests: { ...record.parentDigests, goldensSha256: 'a'.repeat(64) } }
        : null))),
    /amendment chain is not genesis-anchored/u,
  );
  assert.throws(
    () => validateRuntimeContractV1Authority(withRecordText((path, record) =>
      (path.endsWith('chain-anchor.json') ? { ...record, goldensSha256: 'a'.repeat(64) } : null))),
    /chain anchor does not pin the introduction commit artifacts/u,
  );
});

test('L7: a third amendment composes on top of the settled chain in a scratch copy', () => {
  const root = scratchContract();
  const [version] = JSON.parse(readFileSync(resolve(root, CONTRACT_DIR, 'lineage.json'), 'utf8')).versions;
  const successor = {
    format: 'kern.runtime.contract.amendment.v1',
    slice: 'kern-5-synthetic-successor',
    disposition: 'additive',
    parentDigests: Object.fromEntries(Object.keys(PINNED).map((key) => [key, version[key]])),
    rowsChanged: ['limits.synthetic'],
  };
  const successorPath = resolve(root, CONTRACT_DIR, 'amendments/kern-5-synthetic-successor.json');
  writeFileSync(successorPath, `${JSON.stringify(successor, null, 2)}\n`);
  const constitution = resolve(root, CONTRACT_DIR, 'constitution.json');
  writeFileSync(constitution, `${readFileSync(constitution, 'utf8')}\n`);
  assert.match(runAmend(root).output, /chain verified, 1 pending/u);
  assert.equal(runAmend(root, '--write').ok, true);
  assert.match(runAmend(root).output, /chain verified, 0 pending/u);
  const written = JSON.parse(readFileSync(successorPath, 'utf8'));
  const [repinned] = JSON.parse(readFileSync(resolve(root, CONTRACT_DIR, 'lineage.json'), 'utf8')).versions;
  assert.deepEqual(written.parentDigests, successor.parentDigests);
  for (const key of Object.keys(PINNED)) assert.equal(written.resultDigests[key], repinned[key]);
});
