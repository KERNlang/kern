import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { runRegistrySmoke } from './registry-smoke.mjs';
import { createTestEnv, FakeRegistryClient, plan, policy } from './registry-test-fixtures.mjs';

function seedRegistry(registry, manifest) {
  for (const pkg of manifest.packages) {
    registry.versions.set(`${pkg.name}@${plan.version}`, {
      name: pkg.name,
      version: pkg.version,
      dist: { integrity: pkg.integrity },
      dependencies: Object.fromEntries(pkg.internalRuntimeDependencies.map((dep) => [dep.name, dep.version])),
    });
    registry.tags.set(pkg.name, { [plan.distTag]: plan.version });
  }
}

test('registry smoke performs separate clean exact-version and channel installs', async () => {
  const env = await createTestEnv();
  try {
    const registry = new FakeRegistryClient(env.manifest);
    seedRegistry(registry, env.manifest);
    const installs = [];
    const runCommandFn = async (file, argv, options) => {
      if (file !== policy.registry.clientCommand) return { stdout: '', stderr: '' };
      installs.push({ file, argv, cwd: options.cwd });
      const consumer = JSON.parse(await readFile(path.join(options.cwd, 'package.json'), 'utf8'));
      for (const [name, requested] of Object.entries(consumer.dependencies)) {
        const packageDir = path.join(options.cwd, 'node_modules', ...name.split('/'));
        await mkdir(packageDir, { recursive: true });
        await writeFile(
          path.join(packageDir, 'package.json'),
          JSON.stringify({ name, version: requested === plan.distTag ? plan.version : requested }),
        );
      }
      return { stdout: '', stderr: '' };
    };
    await runRegistrySmoke({
      rootDir: env.root,
      plan,
      manifest: env.manifest,
      policy,
      registryClient: registry,
      runCommandFn,
    });
    assert.equal(installs.length, 2);
    assert.notEqual(installs[0].cwd, installs[1].cwd);
    assert.equal(installs[0].file, policy.registry.clientCommand);
    assert.match(installs[0].argv.join(' '), /--ignore-scripts/);
  } finally { await rm(env.root, { recursive: true, force: true }); }
});

test('registry smoke fails before install when any public tag is stale', async () => {
  const env = await createTestEnv();
  try {
    const registry = new FakeRegistryClient(env.manifest);
    seedRegistry(registry, env.manifest);
    registry.tags.set('@kernlang/core', { [plan.distTag]: '4.5.0' });
    let commands = 0;
    await assert.rejects(
      runRegistrySmoke({
        rootDir: env.root,
        plan,
        manifest: env.manifest,
        policy,
        registryClient: registry,
        runCommandFn: async () => { commands += 1; },
      }),
      /stale latest tag/i,
    );
    assert.equal(commands, 0);
  } finally { await rm(env.root, { recursive: true, force: true }); }
});
