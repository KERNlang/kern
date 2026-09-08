import assert from 'node:assert/strict';
import test from 'node:test';

import { TARGET_KERNEL_SHA256 as JAVASCRIPT_KERNEL } from '../../packages/core/dist/compiler/kir-js-esm/emitter.js';
import { TARGET_KERNEL_SHA256 as PYTHON_KERNEL } from '../../packages/core/dist/compiler/kir-python/emitter.js';
import {
  ENTRY,
  LIMITS,
  jumpArtifact,
  jumpTwoLegBytes,
  linkVerifiedKernKirProgram,
  project,
  runtimeRequest,
  sha256Hex,
} from '../kern-5-rt12-linked-jumps/k0-support.mjs';
import { D0_BASE_DIGESTS, D0_FIXTURES, D0_FIXTURE_NAMES } from './fixtures.mjs';
import {
  BASE_EXPRESSION_KINDS,
  BASE_STATEMENT_KINDS,
  JAVASCRIPT_KERNEL_SHA256,
  PYTHON_KERNEL_SHA256,
} from './pins.mjs';
import { LINKED_DIR, between, readRepositoryText } from './support.mjs';

function unionKinds(declaration) {
  const region = between(
    readRepositoryText(`${LINKED_DIR}/contracts.ts`),
    declaration,
    '\nexport ',
    `d0/${declaration}`,
  );
  const kinds = [...region.matchAll(/readonly kind: '([a-z-]+)'/gu)].map((match) => match[1]);
  return [...new Set(kinds)].sort();
}

test('the fixture set is the pinned fifteen programs', () => {
  assert.deepEqual(D0_FIXTURE_NAMES, Object.keys(D0_BASE_DIGESTS).sort());
  assert.equal(D0_FIXTURE_NAMES.length, 15);
});

test('both kernels are byte-identical to the rt12 pins', () => {
  assert.equal(JAVASCRIPT_KERNEL, JAVASCRIPT_KERNEL_SHA256, 'D0_KERNEL_TOUCH: the JavaScript kernel moved');
  assert.equal(PYTHON_KERNEL, PYTHON_KERNEL_SHA256, 'D0_KERNEL_TOUCH: the Python kernel moved');
});

// Moved by slice D, which admits `throw` and `try`. D.0 itself moved neither union; what the row
// holds now is that the statement union is D.0's ten kinds plus exactly those two, and that the
// expression union is still untouched -- the payload rides the `record` kind that already existed.
test('the linked statement union gains only the try family, and the expression union gains nothing', () => {
  assert.deepEqual(
    unionKinds('export type LinkedKernKirStatement ='),
    [...BASE_STATEMENT_KINDS, 'throw', 'try'].sort(),
    'D0_UNION_DRIFT: the linked statement union moved beyond slice D two kinds',
  );
  assert.deepEqual(
    unionKinds('export type LinkedKernKirExpression ='),
    [...BASE_EXPRESSION_KINDS],
    'D0_UNION_DRIFT: the linked expression union moved',
  );
});

test('every fixture links to a byte-identical linked program', async () => {
  for (const name of D0_FIXTURE_NAMES) {
    const verified = await project(D0_FIXTURES[name]());
    assert.ok(verified !== undefined, `D0_PROJECTION_LOST: ${name} no longer projects`);
    const linked = linkVerifiedKernKirProgram(verified, ENTRY, LIMITS);
    assert.equal(linked.outcome, 'success', `D0_LINK_REFUSED: ${name} no longer links`);
    assert.equal(
      sha256Hex(JSON.stringify(linked)),
      D0_BASE_DIGESTS[name].linked,
      `D0_LINK_DRIFT: ${name} produced a different linked program`,
    );
  }
});

test('every fixture emits a byte-identical JavaScript artifact', async () => {
  for (const name of D0_FIXTURE_NAMES) {
    const artifact = await jumpArtifact(D0_FIXTURES[name]());
    assert.equal(
      sha256Hex(artifact),
      D0_BASE_DIGESTS[name].artifact,
      `D0_EMISSION_DRIFT: ${name} produced a different JavaScript artifact`,
    );
  }
});

test('every fixture runs to a byte-identical envelope on RT-1 and the JavaScript leg', async () => {
  for (const name of D0_FIXTURE_NAMES) {
    const { bytes } = await jumpTwoLegBytes(D0_FIXTURES[name](), runtimeRequest(`d0-${name}`, {}));
    assert.equal(
      sha256Hex(Buffer.from(bytes)),
      D0_BASE_DIGESTS[name].envelope,
      `D0_EXECUTION_DRIFT: ${name} produced a different envelope`,
    );
  }
});
