import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MISSING_OWNER = 'KIR_PYTHON_OWNER_MISSING: @kernlang/core does not export ./compiler/kir-python';

function corePythonOwnerExport(manifest) {
  const target = manifest.exports?.['./compiler/kir-python'];
  if (target === undefined) throw new Error(MISSING_OWNER);
  return target;
}

test('C-PY-1 keeps the missing-owner failure exact after the owner lands', () => {
  assert.throws(
    () => corePythonOwnerExport({ exports: {} }),
    (error) => error instanceof Error && error.message === MISSING_OWNER,
  );
});

test('C-PY-1 exposes the package-owned Python KIR compiler without requiring a build', () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'packages/core/package.json'), 'utf8'));
  const target = corePythonOwnerExport(manifest);
  assert.deepEqual(target, {
    types: './dist/compiler-kir-python.d.ts',
    default: './dist/compiler-kir-python.js',
  });
  const aliases = Object.entries(manifest.exports).filter(
    ([_key, value]) => value?.types === target.types || value?.default === target.default,
  );
  assert.deepEqual(aliases.map(([key]) => key), ['./compiler/kir-python']);
  assert.equal(existsSync(resolve(ROOT, 'packages/core/src/compiler-kir-python.ts')), true);
});
