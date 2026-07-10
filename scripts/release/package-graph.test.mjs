import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { discoverPublicPackageGraph } from './package-graph.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function withFixtureRepo(manifests, callback) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'kern-release-graph-'));
  try {
    for (const [directory, manifest] of Object.entries(manifests)) {
      const packageDir = path.join(rootDir, 'packages', directory);
      await mkdir(packageDir, { recursive: true });
      await writeFile(path.join(packageDir, 'package.json'), `${JSON.stringify(manifest)}\n`);
    }
    await callback(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test('current workspace resolves exactly 22 public packages dependency-first', async () => {
  const packages = await discoverPublicPackageGraph({
    rootDir: repoRoot,
    packageRoots: ['packages'],
  });
  const names = packages.map((pkg) => pkg.name);

  assert.equal(packages.length, 22);
  assert.equal(names.includes('@kernlang/playground'), false);
  assert.equal(names.includes('kern-monorepo'), false);
  assert.equal(names.includes('kern-lang'), true);
  assert.ok(names.indexOf('@kernlang/core') < names.indexOf('@kernlang/express'));
  assert.ok(names.indexOf('@kernlang/core') < names.indexOf('@kernlang/cli'));
  assert.ok(names.indexOf('@kernlang/cli') < names.indexOf('kern-lang'));
});

test('runtime dependencies order packages while devDependencies are ignored', async () => {
  await withFixtureRepo(
    {
      app: {
        name: '@fixture/app',
        version: '1.0.0',
        dependencies: { '@fixture/core': 'workspace:*' },
      },
      core: {
        name: '@fixture/core',
        version: '1.0.0',
        devDependencies: { '@fixture/app': 'workspace:*' },
      },
      private: {
        name: '@fixture/private',
        version: '1.0.0',
        private: true,
      },
    },
    async (rootDir) => {
      const packages = await discoverPublicPackageGraph({
        rootDir,
        packageRoots: ['packages'],
      });
      assert.deepEqual(
        packages.map(({ name, dependencies }) => ({ name, dependencies })),
        [
          { name: '@fixture/core', dependencies: [] },
          { name: '@fixture/app', dependencies: ['@fixture/core'] },
        ],
      );
    },
  );
});

test('optional workspace dependencies participate in ordering', async () => {
  await withFixtureRepo(
    {
      adapter: {
        name: '@fixture/adapter',
        version: '1.0.0',
        optionalDependencies: { '@fixture/core': 'workspace:*' },
      },
      core: { name: '@fixture/core', version: '1.0.0' },
    },
    async (rootDir) => {
      const packages = await discoverPublicPackageGraph({
        rootDir,
        packageRoots: ['packages'],
      });
      assert.deepEqual(packages.map((pkg) => pkg.name), [
        '@fixture/core',
        '@fixture/adapter',
      ]);
    },
  );
});

test('independent packages are ordered by package name, not filesystem order', async () => {
  await withFixtureRepo(
    {
      'a-directory': { name: '@fixture/zeta', version: '1.0.0' },
      'z-directory': { name: '@fixture/alpha', version: '1.0.0' },
    },
    async (rootDir) => {
      const packages = await discoverPublicPackageGraph({
        rootDir,
        packageRoots: ['packages'],
      });
      assert.deepEqual(packages.map((pkg) => pkg.name), [
        '@fixture/alpha',
        '@fixture/zeta',
      ]);
    },
  );
});

test('package names must be safe canonical npm names', async () => {
  await withFixtureRepo(
    {
      injected: { name: '@fixture/core\nhacked=true', version: '1.0.0' },
    },
    async (rootDir) => {
      await assert.rejects(
        discoverPublicPackageGraph({ rootDir, packageRoots: ['packages'] }),
        /invalid package name/i,
      );
    },
  );
});

test('missing internal workspace dependency fails closed', async () => {
  await withFixtureRepo(
    {
      app: {
        name: '@fixture/app',
        version: '1.0.0',
        dependencies: { '@fixture/missing': 'workspace:*' },
      },
    },
    async (rootDir) => {
      await assert.rejects(
        discoverPublicPackageGraph({ rootDir, packageRoots: ['packages'] }),
        /missing workspace dependency/i,
      );
    },
  );
});

test('duplicate package names fail closed', async () => {
  await withFixtureRepo(
    {
      first: { name: '@fixture/duplicate', version: '1.0.0' },
      second: { name: '@fixture/duplicate', version: '1.0.0' },
    },
    async (rootDir) => {
      await assert.rejects(
        discoverPublicPackageGraph({ rootDir, packageRoots: ['packages'] }),
        /duplicate package name/i,
      );
    },
  );
});

test('runtime dependency cycles fail closed with package names', async () => {
  await withFixtureRepo(
    {
      first: {
        name: '@fixture/first',
        version: '1.0.0',
        dependencies: { '@fixture/second': 'workspace:*' },
      },
      second: {
        name: '@fixture/second',
        version: '1.0.0',
        dependencies: { '@fixture/first': 'workspace:*' },
      },
    },
    async (rootDir) => {
      await assert.rejects(
        discoverPublicPackageGraph({ rootDir, packageRoots: ['packages'] }),
        /dependency cycle.*@fixture\/first.*@fixture\/second/i,
      );
    },
  );
});

test('nested multi-hop runtime cycle cannot hide behind an acyclic entry package', async () => {
  await withFixtureRepo(
    {
      root: {
        name: '@fixture/root',
        version: '1.0.0',
        dependencies: { '@fixture/b': 'workspace:*' },
      },
      b: {
        name: '@fixture/b',
        version: '1.0.0',
        dependencies: { '@fixture/c': 'workspace:*' },
      },
      c: {
        name: '@fixture/c',
        version: '1.0.0',
        dependencies: { '@fixture/d': 'workspace:*' },
      },
      d: {
        name: '@fixture/d',
        version: '1.0.0',
        dependencies: { '@fixture/b': 'workspace:*' },
      },
    },
    async (rootDir) => {
      await assert.rejects(
        discoverPublicPackageGraph({ rootDir, packageRoots: ['packages'] }),
        /dependency cycle.*@fixture\/b.*@fixture\/c.*@fixture\/d/i,
      );
    },
  );
});
