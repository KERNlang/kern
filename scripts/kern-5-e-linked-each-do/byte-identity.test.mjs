import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeKernKir,
  project,
  provider,
  runtimeRequest,
} from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import { CORPUS, CORPUS_NAMES, SPLICED, SPLICED_NAMES } from './corpus.mjs';
import { CORPUS_ARGUMENTS, emitSpliced, linkCorpusProgram } from './emit-support.mjs';
import { EMITTED_DIGESTS_FORMAT, JAVASCRIPT_KERNEL_SHA256, PYTHON_KERNEL_SHA256 } from './pins.mjs';

const PINNED = JSON.parse(readFileSync(new URL('./emitted-digests.json', import.meta.url), 'utf8'));

function sha256(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

// Projection is the expensive step and every row below reads the same four artifacts off it, so the
// whole corpus is driven exactly once and each test asserts against the shared observation.
let pending;

function observations() {
  pending ??= (async () => {
    const observed = new Map();
    for (const name of CORPUS_NAMES) {
      const source = CORPUS[name]();
      const verified = await project(source);
      assert.ok(verified !== undefined, `E0_PROJECTION_LOST: ${name} must still project`);
      const javascript = compileJavaScript(verified);
      assert.equal(javascript.outcome, 'success', `E0_LINK_REFUSED: ${name} must still compile (${javascript.code})`);
      const python = compilePython(verified);
      const direct = await executeKernKir(verified, runtimeRequest(`e0-${name}`, CORPUS_ARGUMENTS(source)), provider([]));
      observed.set(name, {
        javascriptArtifact: sha256(javascript.artifact.bytes),
        manifest: JSON.parse(Buffer.from(javascript.manifest.bytes).toString('utf8')),
        manifestArtifact: sha256(javascript.manifest.bytes),
        python: python.outcome === 'success' ? sha256(python.artifact.bytes) : `refused:${python.code}`,
        rt1Envelope: sha256(envelopeBytes(direct)),
        rt1Outcome: direct.outcome,
      });
    }
    return observed;
  })();
  return pending;
}

function pinnedRow(name) {
  const row = PINNED.rows.find((candidate) => candidate.name === name);
  assert.ok(row !== undefined, `E0_DIGEST_MISSING: ${name} has no pinned base digest`);
  return row;
}

test('the pinned digest table is the slice-E format and covers the whole corpus', () => {
  assert.equal(PINNED.format, EMITTED_DIGESTS_FORMAT, 'E0_DIGEST_FORMAT: the digest table format drifted');
  assert.deepEqual(
    PINNED.rows.map((row) => row.name).sort(),
    [...CORPUS_NAMES],
    'E0_DIGEST_COVERAGE: the pinned rows are not exactly the corpus programs',
  );
  assert.deepEqual(
    PINNED.spliced.map((row) => row.name).sort(),
    [...SPLICED_NAMES],
    'E0_DIGEST_COVERAGE: the pinned spliced rows are not exactly the spliced programs',
  );
  assert.ok(PINNED.rows.length >= 40, `E0_DIGEST_COVERAGE: ${PINNED.rows.length} rows is a thinner corpus than base`);
});

test('every corpus program emits the base JavaScript artifact and manifest byte for byte', async () => {
  const observed = await observations();
  for (const name of CORPUS_NAMES) {
    const row = pinnedRow(name);
    assert.equal(
      observed.get(name).javascriptArtifact,
      row.javascriptArtifact,
      `E0_ARTIFACT_DRIFT: ${name} no longer emits the base JavaScript artifact`,
    );
    assert.equal(
      observed.get(name).manifestArtifact,
      row.manifestArtifact,
      `E0_MANIFEST_DRIFT: ${name} no longer emits the base manifest`,
    );
  }
});

test('every corpus program keeps its base linked-program digest and kernel pin', async () => {
  const observed = await observations();
  for (const name of CORPUS_NAMES) {
    const row = pinnedRow(name);
    assert.equal(
      observed.get(name).manifest.linkedProgramSha256,
      row.linkedProgram,
      `E0_LINKED_DRIFT: ${name} links to a different program than base`,
    );
    assert.equal(
      observed.get(name).manifest.kernelSha256,
      JAVASCRIPT_KERNEL_SHA256,
      `E0_KERNEL_PIN: ${name} reports a kernel digest other than the frozen JavaScript kernel`,
    );
  }
});

test('every corpus program keeps its base Python compile decision byte for byte', async () => {
  const observed = await observations();
  for (const name of CORPUS_NAMES) {
    assert.equal(
      observed.get(name).python,
      pinnedRow(name).python,
      `E0_PYTHON_DRIFT: ${name} no longer emits the base Python decision`,
    );
  }
});

test('every corpus program keeps its base RT-1 envelope byte for byte', async () => {
  const observed = await observations();
  for (const name of CORPUS_NAMES) {
    const row = pinnedRow(name);
    assert.equal(observed.get(name).rt1Outcome, row.rt1Outcome, `E0_RT1_OUTCOME: ${name} changed RT-1 outcome`);
    assert.equal(
      observed.get(name).rt1Envelope,
      row.rt1Envelope,
      `E0_RT1_DRIFT: ${name} no longer produces the base RT-1 envelope`,
    );
  }
});

test('the two spliced programs emit their base artifacts byte for byte', async () => {
  for (const name of SPLICED_NAMES) {
    const entry = SPLICED[name];
    const program = entry.splice(await linkCorpusProgram(CORPUS[entry.base]()));
    const row = PINNED.spliced.find((candidate) => candidate.name === name);
    assert.ok(row !== undefined, `E0_DIGEST_MISSING: ${name} has no pinned spliced digest`);
    assert.equal(
      sha256(await emitSpliced(program)),
      row.javascriptArtifact,
      `E0_ARTIFACT_DRIFT: the spliced ${name} artifact moved off its base bytes`,
    );
  }
});

test('both kernel digests are the frozen pins the emitters recompute at load', async () => {
  const javascript = await import('../../packages/core/dist/compiler/kir-js-esm/emitter.js');
  const python = await import('../../packages/core/dist/compiler/kir-python/emitter.js');
  assert.equal(
    javascript.TARGET_KERNEL_SHA256,
    JAVASCRIPT_KERNEL_SHA256,
    'E0_KERNEL_PIN: the JavaScript kernel source changed',
  );
  assert.equal(
    python.TARGET_KERNEL_SHA256,
    PYTHON_KERNEL_SHA256,
    'E0_KERNEL_PIN: the Python kernel source changed',
  );
});
