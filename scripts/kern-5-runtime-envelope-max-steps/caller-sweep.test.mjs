import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { ENVELOPE_LIMIT_KEYS, envelopeShapedFiles, REPO_ROOT } from './support.mjs';

const shaped = envelopeShapedFiles();

function text(path) {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

test('L5: the sweep finds the envelope-shaped records it is meant to fence', () => {
  const paths = shaped.map((row) => row.path);
  for (const expected of [
    'examples/kern-5-preview-app/runtime-handler-config.json',
    'examples/kern-5-preview-app/server.mjs',
    'packages/cli/src/kern-checker-assets.ts',
    'packages/cli/src/kern-formatter-assets.ts',
    'packages/core/src/runtime-envelope/types.ts',
    'packages/core/src/runtime-envelope/value.ts',
    'packages/core/src/runtime-handler.ts',
    'scripts/kern-5-r0-contracts/schema/runtime-request.json',
    'scripts/kern-checker/policy.json',
    'scripts/kern-formatter/policy.json',
    'scripts/kern-frontend-f1-scan/policy.json',
    'scripts/kern-frontend-f2-batch/policy.json',
    'scripts/kern-frontend-f3-line-tree/policy.json',
    'scripts/kern-frontend-f4-declarations/policy.json',
    'scripts/kern-frontend-f5-projection/policy.json',
    'scripts/kern-frontend-stitcher/policy.json',
    'scripts/kern-frontend-tokenizer/policy.json',
    'scripts/runtime-contract-v1/constitution.json',
    'scripts/runtime-contract-v1/goldens.json',
    'scripts/runtime-contract-v1/proof-inventory.json',
    'scripts/runtime-contract-v1/public-declaration-schema.json',
  ]) {
    assert.ok(paths.includes(expected), `sweep must cover ${expected}`);
  }
  assert.ok(shaped.length >= 84, `sweep found only ${shaped.length} envelope-shaped files`);
});

test('L5: every envelope-shaped limits record carries maxIterations', () => {
  const missing = shaped.filter((row) => !row.hasMaxSteps).map((row) => row.path);
  assert.deepEqual(missing, [], `${missing.length} file(s) still lack maxIterations:\n${missing.join('\n')}`);
});

test('L5: the runtime constitution records the widened public limits key set', () => {
  const constitution = JSON.parse(text('scripts/runtime-contract-v1/constitution.json'));
  assert.deepEqual([...constitution.limits].sort(), [...ENVELOPE_LIMIT_KEYS]);
  assert.equal(constitution.internalFormat, 'kern.runtime.internal.r0');
  assert.equal(constitution.abi, 'kern.runtime.handler.v1');
});

test('L5: the frozen public declaration text carries maxIterations', () => {
  const schema = JSON.parse(text('scripts/runtime-contract-v1/public-declaration-schema.json'));
  const declaration = schema.declarations.find((entry) => entry.includes('interface KernRuntimeHandlerLimits'));
  assert.ok(declaration, 'KernRuntimeHandlerLimits declaration must be present');
  assert.match(declaration, /readonly maxIterations: number;/u);
});

test('L5: the runtime contract goldens and proof inventory both carry a maxIterations boundary', () => {
  const goldens = JSON.parse(text('scripts/runtime-contract-v1/goldens.json'));
  const inventory = JSON.parse(text('scripts/runtime-contract-v1/proof-inventory.json'));
  assert.deepEqual(Object.keys(goldens.limits).sort(), [...ENVELOPE_LIMIT_KEYS]);
  const ids = (value) => JSON.stringify(value).match(/"id":"maxIterations"/gu) ?? [];
  assert.ok(ids(goldens).length > 0, 'goldens must enumerate a maxIterations boundary');
  assert.ok(ids(inventory).length > 0, 'proof inventory must enumerate a maxIterations boundary');
});

test('L5: the lineage digests match the artefacts they pin', async () => {
  const { createHash } = await import('node:crypto');
  const sha256 = (value) => createHash('sha256').update(value).digest('hex');
  const lineage = JSON.parse(text('scripts/runtime-contract-v1/lineage.json'));
  const [version] = lineage.versions;
  assert.equal(version.constitutionSha256, sha256(text('scripts/runtime-contract-v1/constitution.json')));
  assert.equal(version.proofInventorySha256, sha256(text('scripts/runtime-contract-v1/proof-inventory.json')));
  assert.equal(
    version.declarationSchemaSha256,
    sha256(text('scripts/runtime-contract-v1/public-declaration-schema.json')),
  );
  assert.equal(version.goldensSha256, sha256(text('scripts/runtime-contract-v1/goldens.json')));
});
