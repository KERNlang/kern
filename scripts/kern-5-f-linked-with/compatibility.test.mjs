import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CORPUS, CORPUS_NAMES } from '../kern-5-e-linked-each-do/corpus.mjs';
import { CORPUS_ARGUMENTS } from '../kern-5-e-linked-each-do/emit-support.mjs';
import {
  between,
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeKernKir,
  numstatAgainstBase,
  occurrencesOf,
  project,
  provider,
  repositoryLineCount,
  repositoryText,
  runtimeRequest,
  specCriteria,
  trackedFilesAt,
  trackedFilesNow,
} from './k0-support.mjs';
import {
  BASE_COMMIT,
  BYTE_IDENTICAL_MODULES,
  FILE_LINE_CEILING,
  FROZEN_F5_PATHS,
  JAVASCRIPT_KERNEL_SHA256,
  LINE_BUDGETS,
  PYTHON_KERNEL_SHA256,
  SPEC_PATH,
  STATEMENT_KINDS_AFTER_F,
  STILL_OUTSIDE_AFTER_F,
} from './pins.mjs';

const CORE = 'packages/core/src';

const STILL_OUTSIDE_FILES = Object.freeze([
  'scripts/kern-5-rt10-for/compatibility.test.mjs',
  'scripts/kern-5-rt11-linked-while/compatibility.test.mjs',
  'scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs',
]);

const E_DIGESTS = JSON.parse(
  readFileSync(new URL('../kern-5-e-linked-each-do/emitted-digests.json', import.meta.url), 'utf8'),
);

function sha256(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

test('both kernel digests are the frozen pins, recomputed at module load', async () => {
  const javascript = await import('../../packages/core/dist/compiler/kir-js-esm/emitter.js');
  const python = await import('../../packages/core/dist/compiler/kir-python/emitter.js');
  assert.equal(javascript.TARGET_KERNEL_SHA256, JAVASCRIPT_KERNEL_SHA256, 'F_KERNEL_TOUCH: the JavaScript kernel moved');
  assert.equal(python.TARGET_KERNEL_SHA256, PYTHON_KERNEL_SHA256, 'F_KERNEL_TOUCH: the Python kernel moved');
});

// The expansion's budget, enforced: `with` is a linker rewrite, so no target file and no lowering
// table may move a byte. A diff here is the slice reaching a leg it promised not to touch.
test('every leg module is byte-identical to base', () => {
  for (const path of BYTE_IDENTICAL_MODULES) {
    assert.equal(
      numstatAgainstBase(BASE_COMMIT, path),
      '',
      `F_LEG_TOUCHED: ${path} differs from ${BASE_COMMIT}, and an expanded with must not reach it`,
    );
  }
});

test('F5 is byte-identical to base: no schema, catalog or structural edit is bought', () => {
  for (const path of FROZEN_F5_PATHS) {
    assert.equal(
      numstatAgainstBase(BASE_COMMIT, path),
      '',
      `F_F5_TOUCH: ${path} differs from ${BASE_COMMIT}; every property F reads already projects`,
    );
  }
});

test('every budgeted file is at or under its budget and under the ceiling', () => {
  for (const [path, budget] of Object.entries(LINE_BUDGETS)) {
    const lines = repositoryLineCount(path);
    assert.ok(lines <= budget, `F_LINE_BUDGET: ${path} is ${lines} lines against a budget of ${budget}`);
    assert.ok(
      budget < FILE_LINE_CEILING,
      `F_LINE_BUDGET: the budget for ${path} is ${budget}, at or past the ${FILE_LINE_CEILING} ceiling`,
    );
    assert.ok(lines < FILE_LINE_CEILING, `F_LINE_BUDGET: ${path} is ${lines} lines, past the ${FILE_LINE_CEILING} ceiling`);
  }
});

// QF-3: a new dist module costs a canonicalizer chain stage, so the module inventory must be exactly
// the base inventory -- untracked files included, since an unstaged module is still a module.
test('no new module appears under packages/core/src against base', () => {
  assert.deepEqual(
    trackedFilesNow(CORE),
    trackedFilesAt(BASE_COMMIT, CORE),
    'F_NEW_MODULE: slice F must add no packages/core/src module',
  );
});

test('the linked statement union still excludes exactly the kinds the prior slices left outside', () => {
  const union = between(
    repositoryText('packages/core/src/kir-runtime/linked-kir-program/contracts.ts'),
    'export type LinkedKernKirStatement',
    'export ',
    'the linked union',
  );
  for (const kind of STILL_OUTSIDE_AFTER_F) {
    assert.equal(union.includes(`kind: '${kind}'`), false, `F_SCOPE_CREEP: ${kind} must stay outside the union`);
  }
  assert.equal(
    union.includes("kind: 'with'"),
    false,
    'F_SCOPE_CREEP: an expanded with must not appear in the union either',
  );
});

// The prior slices' STILL_OUTSIDE lists must keep `set` and must not have been emptied to make room:
// F admits no new kind, so all three lists stay exactly as slice E left them.
test('the prior-slice STILL_OUTSIDE lists are unchanged and still name set', () => {
  for (const path of STILL_OUTSIDE_FILES) {
    const region = between(repositoryText(path), 'STILL_OUTSIDE', ']', `${path} STILL_OUTSIDE`);
    const kinds = [...region.matchAll(/'([a-z-]+)'/gu)].map((match) => match[1]).sort();
    assert.deepEqual(kinds, [...STILL_OUTSIDE_AFTER_F], `F_STILL_OUTSIDE: ${path} moved off the pinned list`);
  }
});

test('the parity-ledger exhaustiveness table still names exactly fourteen statement kinds', () => {
  const region = between(
    repositoryText('scripts/kern-5-parity-ledger/exhaustiveness.test.mjs'),
    'const STATEMENT_KINDS = Object.freeze([',
    ']',
    'the exhaustiveness table',
  );
  const kinds = [...region.matchAll(/'([a-z-]+)'/gu)].map((match) => match[1]).sort();
  assert.deepEqual(kinds, [...STATEMENT_KINDS_AFTER_F], 'F_EXHAUSTIVENESS: the pinned statement kind set moved');
});

// Slice E's byte-identity corpus is the regression net for the linker itself: `with` must be new
// syntax admitted, never a rewrite that touches what already links.
test("every program in slice E's corpus still emits its base artifacts byte for byte", async () => {
  for (const name of CORPUS_NAMES) {
    const row = E_DIGESTS.rows.find((candidate) => candidate.name === name);
    assert.ok(row !== undefined, `F_CORPUS_UNPINNED: ${name} has no slice-E digest`);
    const source = CORPUS[name]();
    const verified = await project(source);
    assert.ok(verified !== undefined, `F_CORPUS_PROJECTION_LOST: ${name} must still project`);
    const javascript = compileJavaScript(verified);
    assert.equal(javascript.outcome, 'success', `F_CORPUS_LINK_REFUSED: ${name} must still compile`);
    assert.equal(
      sha256(javascript.artifact.bytes),
      row.javascriptArtifact,
      `F_CORPUS_ARTIFACT_DRIFT: ${name} no longer emits the slice-E JavaScript artifact`,
    );
    assert.equal(
      sha256(javascript.manifest.bytes),
      row.manifestArtifact,
      `F_CORPUS_MANIFEST_DRIFT: ${name} no longer emits the slice-E manifest`,
    );
    const python = compilePython(verified);
    assert.equal(
      python.outcome === 'success' ? sha256(python.artifact.bytes) : `refused:${python.code}`,
      row.python,
      `F_CORPUS_PYTHON_DRIFT: ${name} changed its Python decision`,
    );
    // The envelope carries its own requestId, so the digest only reproduces under slice E's own id.
    const direct = await executeKernKir(verified, runtimeRequest(`e0-${name}`, CORPUS_ARGUMENTS(source)), provider([]));
    assert.equal(direct.outcome, row.rt1Outcome, `F_CORPUS_RT1_OUTCOME: ${name} changed RT-1 outcome`);
    assert.equal(
      sha256(envelopeBytes(direct)),
      row.rt1Envelope,
      `F_CORPUS_RT1_DRIFT: ${name} no longer produces the slice-E RT-1 envelope`,
    );
  }
});

test('the spec exists, carries every acceptance group, and is loadable in one session', () => {
  const spec = repositoryText(SPEC_PATH);
  const lines = spec.split('\n').length - 1;
  assert.ok(lines < 900, `F_SPEC_SIZE: the spec is ${lines} lines and must load in one session`);
  const { criteria, groups } = specCriteria();
  assert.ok(criteria.length >= 15, `F_SPEC_THIN: ${criteria.length} acceptance criteria is thinner than the row set`);
  assert.ok(groups.length >= 2, 'F_SPEC_SHAPE: the acceptance criteria must be grouped by commit');
  for (const section of ['## Deploy Order', '## Blast Radius', '## Confidence', '## Out of Scope']) {
    assert.ok(spec.includes(section), `F_SPEC_SHAPE: the spec must carry ${section}`);
  }
  assert.equal(
    occurrencesOf(spec, BASE_COMMIT) >= 1,
    true,
    `F_SPEC_SHAPE: the spec must name its base commit ${BASE_COMMIT}`,
  );
});
