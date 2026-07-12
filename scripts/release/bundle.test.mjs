import assert from 'node:assert/strict';
import { readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createReleaseBundle, validateReleaseBundle } from './bundle.mjs';
import { createTestEnv, plan, policy } from './registry-test-fixtures.mjs';

test('bundle rejects plan mismatch, tarball corruption, extras, and symlinks', async (t) => {
  await t.test('plan mismatch', async () => {
    const env = await createTestEnv();
    try {
      await createReleaseBundle({ plan, manifest: env.manifest, tarballDir: env.tarballDir, bundleDir: env.bundleDir, policy });
      await assert.rejects(
        validateReleaseBundle({ bundleDir: env.bundleDir, plan: { ...plan, sha: '1'.repeat(40) }, policy }),
        /SHA mismatch/i,
      );
    } finally { await rm(env.root, { recursive: true, force: true }); }
  });
  await t.test('one-byte corruption', async () => {
    const env = await createTestEnv();
    try {
      await createReleaseBundle({ plan, manifest: env.manifest, tarballDir: env.tarballDir, bundleDir: env.bundleDir, policy });
      const file = path.join(env.bundleDir, 'artifacts', env.manifest.packages[0].tarball);
      const bytes = await readFile(file);
      bytes[0] ^= 1;
      await writeFile(file, bytes);
      await assert.rejects(validateReleaseBundle({ bundleDir: env.bundleDir, plan, policy }), /Digest mismatch/i);
    } finally { await rm(env.root, { recursive: true, force: true }); }
  });
  await t.test('unexpected file', async () => {
    const env = await createTestEnv();
    try {
      await createReleaseBundle({ plan, manifest: env.manifest, tarballDir: env.tarballDir, bundleDir: env.bundleDir, policy });
      await writeFile(path.join(env.bundleDir, 'extra'), 'x');
      await assert.rejects(validateReleaseBundle({ bundleDir: env.bundleDir, plan, policy }), /unexpected file/i);
    } finally { await rm(env.root, { recursive: true, force: true }); }
  });
  await t.test('symlinked tarball', async () => {
    const env = await createTestEnv();
    try {
      await createReleaseBundle({ plan, manifest: env.manifest, tarballDir: env.tarballDir, bundleDir: env.bundleDir, policy });
      const file = path.join(env.bundleDir, 'artifacts', env.manifest.packages[0].tarball);
      const target = path.join(env.root, 'tarball-target');
      await writeFile(target, await readFile(file));
      await rm(file);
      await symlink(target, file);
      await assert.rejects(validateReleaseBundle({ bundleDir: env.bundleDir, plan, policy }), /regular file/i);
    } finally { await rm(env.root, { recursive: true, force: true }); }
  });
});
