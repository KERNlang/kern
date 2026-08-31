import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { constructManifest } from './artifact-manifest.mjs';
import { packArtifacts } from './pack-artifacts.mjs';
import { readPackageJsonFromTarball } from './tar-entry.mjs';

const version = '5.0.0-canary.9.g01234567';
const plan = {
  planVersion: 1,
  sha: '0123456789abcdef0123456789abcdef01234567',
  channel: 'canary',
  version,
  distTag: 'canary',
  packages: [
    { name: '@kernlang/core', path: 'packages/core', dependencies: [] },
    {
      name: 'kern-lang',
      path: 'packages/compat',
      dependencies: ['@kernlang/core'],
    },
  ],
};

function packed(name, pkgJson, overrides = {}) {
  return {
    name,
    version,
    tarball: `${name.replace('@', '').replace('/', '-')}-${version}.tgz`,
    size: 1,
    sha512: '00'.repeat(64),
    integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
    pkgJson,
    ...overrides,
  };
}

function manifestInput(compatJson = {}) {
  return [
    packed('@kernlang/core', { name: '@kernlang/core', version }),
    packed('kern-lang', {
      name: 'kern-lang',
      version,
      dependencies: { '@kernlang/core': version },
      ...compatJson,
    }),
  ];
}

test('manifest rejects packed metadata whose package name differs from the plan', () => {
  const input = manifestInput();
  input[1].pkgJson.name = 'lookalike';
  assert.throws(() => constructManifest({ plan, packedInfo: input }), /name mismatch/i);
});

test('manifest rejects a planned internal runtime dependency missing from packed metadata', () => {
  const input = manifestInput({ dependencies: {} });
  assert.throws(() => constructManifest({ plan, packedInfo: input }), /dependency set/i);
});

test('manifest rejects duplicate tarball filenames and inconsistent digest encodings', () => {
  const duplicate = manifestInput();
  duplicate[1].tarball = duplicate[0].tarball;
  assert.throws(() => constructManifest({ plan, packedInfo: duplicate }), /duplicate tarball/i);

  const badIntegrity = manifestInput();
  badIntegrity[0].integrity = 'sha512-not-the-hex-digest';
  assert.throws(() => constructManifest({ plan, packedInfo: badIntegrity }), /integrity/i);
});

function tarHeader(name, size, type = '0') {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write(size.toString(8).padStart(11, '0'), 124, 'ascii');
  header[135] = 0;
  header.write(type, 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  return header;
}

function tarEntry(name, contents, type = '0') {
  const body = Buffer.from(contents);
  const padding = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length);
  return Buffer.concat([tarHeader(name, body.length, type), body, padding]);
}

const tarLimits = {
  maxUnpackedBytes: 1024 * 1024,
  maxPackageJsonBytes: 64 * 1024,
  maxCommandOutputBytes: 2 * 1024 * 1024,
};

test('tar reader rejects non-regular package metadata and malformed trailing entries', () => {
  const json = JSON.stringify({ name: 'kern-lang', version });
  const symlink = zlib.gzipSync(
    Buffer.concat([tarEntry('package/package.json', json, '2'), Buffer.alloc(1024)]),
  );
  assert.throws(
    () => readPackageJsonFromTarball(symlink, tarLimits),
    /regular file/i,
  );

  const malformedTail = zlib.gzipSync(
    Buffer.concat([
      tarEntry('package/package.json', json),
      tarHeader('package/broken.bin', 4096),
      Buffer.alloc(10),
    ]),
  );
  assert.throws(
    () => readPackageJsonFromTarball(malformedTail, tarLimits),
    /truncated/i,
  );
});

test('packer passes argv without shell interpolation and rejects output extras', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'kern-pack-hardening-'));
  try {
    for (const pkg of plan.packages) {
      const dir = path.join(rootDir, pkg.path);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: pkg.name, version }),
      );
    }

    const outDir = path.join(rootDir, 'artifacts');
    const invocations = [];
    const runCommand = async (file, args, options) => {
      invocations.push({ file, args, options });
      const packagePath = args[1];
      const pkg = plan.packages.find((candidate) => candidate.path === packagePath);
      const tarball = `${pkg.name.replace('@', '').replace('/', '-')}-${version}.tgz`;
      const packageJson = {
        name: pkg.name,
        version,
        dependencies: pkg.dependencies.length > 0 ? { '@kernlang/core': version } : {},
      };
      const bytes = zlib.gzipSync(
        Buffer.concat([
          tarEntry('package/package.json', JSON.stringify(packageJson)),
          Buffer.alloc(1024),
        ]),
      );
      await writeFile(path.join(outDir, tarball), bytes);
      return JSON.stringify({ name: pkg.name, version, filename: path.join(outDir, tarball) });
    };

    await packArtifacts({
      plan,
      outDir: 'artifacts',
      rootDir,
      runCommandFn: runCommand,
      limits: { ...tarLimits, maxTarballBytes: 1024 * 1024, commandTimeoutMs: 10_000 },
    });

    assert.equal(invocations.length, 2);
    assert.equal(
      invocations.every(
        ({ options }) => options.maxBuffer === tarLimits.maxCommandOutputBytes,
      ),
      true,
    );
    assert.deepEqual(
      invocations.map(({ file, args }) => [file, args[0], args[1]]),
      [
        ['pnpm', '--dir', 'packages/core'],
        ['pnpm', '--dir', 'packages/compat'],
      ],
    );

    const extraRoot = await mkdtemp(path.join(os.tmpdir(), 'kern-pack-extra-'));
    try {
      for (const pkg of plan.packages) {
        const dir = path.join(extraRoot, pkg.path);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: pkg.name, version }));
      }
      const extraOut = path.join(extraRoot, 'artifacts');
      const extraRunner = async (file, args) => {
        const packagePath = args[1];
        const pkg = plan.packages.find((candidate) => candidate.path === packagePath);
        const tarball = `${pkg.name.replace('@', '').replace('/', '-')}-${version}.tgz`;
        const packageJson = {
          name: pkg.name,
          version,
          dependencies: pkg.dependencies.length ? { '@kernlang/core': version } : {},
        };
        const bytes = zlib.gzipSync(
          Buffer.concat([
            tarEntry('package/package.json', JSON.stringify(packageJson)),
            Buffer.alloc(1024),
          ]),
        );
        await writeFile(path.join(extraOut, tarball), bytes);
        if (pkg.name === 'kern-lang') {
          await writeFile(path.join(extraOut, 'unexpected.txt'), 'not an artifact');
        }
        return JSON.stringify({ name: pkg.name, version, filename: path.join(extraOut, tarball) });
      };
      await assert.rejects(
        () =>
          packArtifacts({
            plan,
            outDir: 'artifacts',
            rootDir: extraRoot,
            runCommandFn: extraRunner,
            limits: { ...tarLimits, maxTarballBytes: 1024 * 1024, commandTimeoutMs: 10_000 },
          }),
        /exactly one|unexpected|count mismatch/i,
      );
    } finally {
      await rm(extraRoot, { recursive: true, force: true });
    }

    assert.equal((await readFile(path.join(rootDir, 'packages/core/package.json'), 'utf8')).length > 0, true);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
