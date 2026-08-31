import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  AMBIGUOUS_OWNER_CODE,
  MISSING_OWNER,
  MISSING_OWNER_CODE,
  OWNER_SUBPATH,
  assertExactlyOnePythonOwner,
  assertOwnerManifest,
  discoverPythonOwners,
  sourceFacadeExists,
} from './owner.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('C-PY-1 keeps the missing-owner failure exact after the owner lands', () => {
  assert.throws(
    () => assertExactlyOnePythonOwner([]),
    (error) => error instanceof Error && error.code === MISSING_OWNER_CODE && error.message === MISSING_OWNER,
  );
});

test('C-PY-1 exposes the package-owned Python KIR compiler without requiring a build', () => {
  const { manifest, target } = assertOwnerManifest(ROOT);
  assert.deepEqual(target, {
    types: './dist/compiler-kir-python.d.ts',
    default: './dist/compiler-kir-python.js',
  });
  const aliases = Object.entries(manifest.exports).filter(
    ([_key, value]) => value?.types === target.types || value?.default === target.default,
  );
  assert.deepEqual(aliases.map(([key]) => key), [OWNER_SUBPATH]);
  assert.equal(sourceFacadeExists(ROOT), true);
});

test('C-PY-1 has exactly one built package owner and stable ambiguity errors', async () => {
  const owner = assertExactlyOnePythonOwner(await discoverPythonOwners(ROOT));
  assert.equal(owner.packageName, '@kernlang/core');
  assert.equal(owner.subpath, OWNER_SUBPATH);
  assert.equal(existsSync(owner.sourcePath), true);
  assert.equal(existsSync(owner.builtPath), true);
  assert.throws(() => assertExactlyOnePythonOwner([owner, owner]), { code: AMBIGUOUS_OWNER_CODE });
});
