import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { runRegistrySmoke, runRestoredEntrySmoke } from './registry-smoke.mjs';
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

test('restored entry smoke installs the prior channel version and checks exact internal pins', async () => {
  const env = await createTestEnv();
  try {
    const registry = new FakeRegistryClient(env.manifest);
    const priorVersion = '4.5.0';
    registry.tags.set('kern-lang', { [plan.distTag]: priorVersion });
    registry.versions.set(`kern-lang@${priorVersion}`, {
      name: 'kern-lang',
      version: priorVersion,
      dependencies: { '@kernlang/core': priorVersion },
    });
    const commands = [];
    const result = await runRestoredEntrySmoke({
      rootDir: env.root,
      plan,
      snapshot: { priorTags: { 'kern-lang': priorVersion } },
      policy,
      registryClient: registry,
      runCommandFn: async (file, argv, options) => {
        commands.push({ file, argv });
        if (file !== policy.registry.clientCommand) return { stdout: '', stderr: '' };
        const packageDir = path.join(options.cwd, 'node_modules', 'kern-lang');
        await mkdir(packageDir, { recursive: true });
        await writeFile(
          path.join(packageDir, 'package.json'),
          JSON.stringify({
            name: 'kern-lang',
            version: priorVersion,
            dependencies: { '@kernlang/core': priorVersion },
          }),
        );
        return { stdout: '', stderr: '' };
      },
    });
    assert.deepEqual(result, [{
      packageName: 'kern-lang',
      version: priorVersion,
      verified: 'clean-install',
    }]);
    assert.equal(commands[0].file, policy.registry.clientCommand);

    registry.versions.get(`kern-lang@${priorVersion}`).dependencies['@kernlang/core'] = '^4.5.0';
    await assert.rejects(
      runRestoredEntrySmoke({
        rootDir: env.root,
        plan,
        snapshot: { priorTags: { 'kern-lang': priorVersion } },
        policy,
        registryClient: registry,
        runCommandFn: async () => ({ stdout: '', stderr: '' }),
      }),
      /does not exactly pin/i,
    );
  } finally { await rm(env.root, { recursive: true, force: true }); }
});

test('restored entry smoke rejects a snapshot missing a configured entry', async () => {
  const env = await createTestEnv();
  try {
    let commands = 0;
    await assert.rejects(
      runRestoredEntrySmoke({
        rootDir: env.root,
        plan,
        snapshot: { priorTags: {} },
        policy,
        registryClient: new FakeRegistryClient(env.manifest),
        runCommandFn: async () => { commands += 1; },
      }),
      /missing recovery entry/i,
    );
    assert.equal(commands, 0);
  } finally { await rm(env.root, { recursive: true, force: true }); }
});
