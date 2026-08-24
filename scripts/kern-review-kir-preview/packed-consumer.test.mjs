import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { discoverPublicPackageGraph } from '../release/package-graph.mjs';
import { KIR_REVIEW_FIXTURES } from './fixtures/fixtures.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const CORE_DIR = path.join(ROOT, 'packages/core');
const CORE_SUBPATH = '@kernlang/core/frontend-projection';
const FEATURE_MODULE_URL = new URL('../../packages/core/dist/frontend-projection.js', import.meta.url);
const FORBIDDEN_LEGACY_REACHABILITY = /\b(?:parseWithDiagnostics|reviewKernSource|inferFromSource|ts-morph)\b/u;
const FORBIDDEN_BOUNDARY_RECONSTRUCTION = /\b(?:parseWithDiagnostics|reviewKernSource|inferFromSource|ts-morph|parseDocumentStrict|encodeModuleKir|projectStructuralNode|deriveModuleGraph|parseExpression)\b/u;

async function projectionApi() {
  try {
    const api = await import(FEATURE_MODULE_URL.href);
    assert.equal(typeof api.projectKernModules, 'function', 'public packed projection call');
    assert.equal(typeof api.verifyKernProjection, 'function', 'public packed verification call');
    return api;
  } catch (error) {
    throw new Error(
      `KRI-A11/A12 contract missing: ${FEATURE_MODULE_URL.pathname} must implement ${CORE_SUBPATH} (${error.code ?? error.name}: ${error.message})`,
      { cause: error },
    );
  }
}

async function packCore(destination) {
  const { stdout } = await execFileAsync('pnpm', [
    '--dir', CORE_DIR, 'pack', '--pack-destination', destination, '--json',
  ], { cwd: ROOT, maxBuffer: 4 * 1024 * 1024, timeout: 60_000 });
  const packed = JSON.parse(stdout);
  assert.equal(packed.name, '@kernlang/core', 'packed core package identity');
  return packed.filename;
}

async function unpack(tarball, destination) {
  await execFileAsync('tar', ['-xzf', tarball, '-C', destination], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
  });
  return path.join(destination, 'package');
}

async function staticImportClosure(entry, packageRoot) {
  const pending = [entry];
  const visited = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, FORBIDDEN_LEGACY_REACHABILITY,
      `${file} must not reach legacy parser or ts-morph symbols`);
    assert.doesNotMatch(source, /\bimport\s*\(/u,
      `${file} must not hide workspace reachability behind a dynamic import`);
    const specifiers = [...source.matchAll(/\b(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/gu)]
      .map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.doesNotMatch(specifier, FORBIDDEN_LEGACY_REACHABILITY,
        `${file} must not import legacy parser or ts-morph symbols`);
      if (!specifier.startsWith('.')) continue;
      const candidate = path.resolve(path.dirname(file), specifier);
      const paths = path.extname(candidate)
        ? [candidate]
        : [`${candidate}.js`, `${candidate}.mjs`, path.join(candidate, 'index.js')];
      let imported;
      for (const value of paths) {
        const relative = path.relative(packageRoot, value);
        if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
        try {
          await access(value);
          imported = value;
          break;
        } catch {
          // Try the next normal JavaScript resolution candidate.
        }
      }
      assert.ok(imported, `${file} relative import must stay inside packed core`);
      pending.push(imported);
    }
  }
  return visited;
}

async function projectionBoundaryFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await projectionBoundaryFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function assertAmbientFreeProjectionBoundary(packedRoot, projectionTarget) {
  const assetRoot = path.join(packedRoot, 'dist', 'frontend-projection-assets');
  const files = [path.join(packedRoot, projectionTarget), ...await projectionBoundaryFiles(assetRoot)];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /\bprocess\.env\b|\bglobalThis\b/u,
      `${file} must not take wrapper or packed asset configuration from ambient process/global state`);
    assert.doesNotMatch(source, FORBIDDEN_BOUNDARY_RECONSTRUCTION,
      `${file} must not reconstruct F5 KIR through legacy, parser, or bootstrap helpers`);
  }
}

async function poisonedConsumerEnvironment(temporary) {
  const home = path.join(temporary, 'isolated-home');
  const xdgConfig = path.join(temporary, 'isolated-xdg-config');
  const xdgCache = path.join(temporary, 'isolated-xdg-cache');
  const xdgData = path.join(temporary, 'isolated-xdg-data');
  const isolatedTemp = path.join(temporary, 'isolated-temp');
  await Promise.all([home, xdgConfig, xdgCache, xdgData, isolatedTemp]
    .map((directory) => mkdir(directory, { recursive: true })));
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('KERN_')));
  return {
    ...environment,
    HOME: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
    XDG_DATA_HOME: xdgData,
    TMPDIR: isolatedTemp,
    TMP: isolatedTemp,
    TEMP: isolatedTemp,
    KERN_REPO_ROOT: path.join(temporary, 'poisoned-kern-repo-root'),
    KERN_FRONTEND_PROJECTION_ASSETS: path.join(temporary, 'poisoned-kern-assets'),
    KERN_FRONTEND_F5_POLICY: path.join(temporary, 'poisoned-kern-policy'),
    KERN_CONFIG: path.join(temporary, 'poisoned-kern-config'),
  };
}

test('KRI-A11/A12 packed core exposes only the supported projection API and carries its runtime asset closure', async () => {
  await projectionApi();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'kern-kir-preview-packed-'));
  try {
    const tarball = await packCore(temporary);
    const packedRoot = await unpack(tarball, temporary);
    const packedPackage = JSON.parse(await readFile(path.join(packedRoot, 'package.json'), 'utf8'));
    const exported = packedPackage.exports?.['./frontend-projection'];
    assert.ok(exported, 'tarball exports @kernlang/core/frontend-projection');
    assert.ok(await readdir(path.join(packedRoot, 'dist', 'frontend-projection-assets')),
      'tarball includes packaged frontend-projection assets');

    const rootEntries = await readdir(packedRoot);
    assert.equal(rootEntries.includes('scripts'), false, 'tarball has no repository scripts reachability');
    assert.equal(rootEntries.includes('examples'), false, 'tarball has no repository examples reachability');
    assert.equal(rootEntries.includes('packages'), false, 'tarball has no workspace package reachability');

    const projectionTarget = typeof exported === 'string' ? exported : exported.default;
    assert.equal(typeof projectionTarget, 'string', 'projection export has a JavaScript default target');
    const projectionSource = await readFile(path.join(packedRoot, projectionTarget), 'utf8');
    assert.doesNotMatch(projectionSource,
      /(?:parseWithDiagnostics|reviewKernSource|inferFromSource|ts-morph|\.\.\/\.\.\/scripts|\.\.\/\.\.\/examples)/u,
      'packed projection must not reach legacy Review or workspace parser internals');
    const closure = await staticImportClosure(path.join(packedRoot, projectionTarget), packedRoot);
    assert.ok(closure.size > 0, 'packed projection import closure is inspectable');
    await assertAmbientFreeProjectionBoundary(packedRoot, projectionTarget);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('KRI-A11 clean packed consumer projects real KERN without repository-relative imports', async () => {
  await projectionApi();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'kern-kir-preview-consumer-'));
  try {
    const tarball = await packCore(temporary);
    const consumer = path.join(temporary, 'consumer');
    await mkdir(consumer);
    await execFileAsync('pnpm', [
      'init', '--init-package-manager=pnpm@10.32.1', '--yes',
    ], { cwd: consumer, maxBuffer: 4 * 1024 * 1024, timeout: 30_000 });
    await execFileAsync('pnpm', [
      'add', '--offline', `file:${tarball}`,
    ], { cwd: consumer, maxBuffer: 4 * 1024 * 1024, timeout: 60_000 });
    const source = [
      "import { projectKernModules, verifyKernProjection } from '@kernlang/core/frontend-projection';",
      `const request = { modules: [{ moduleId: 'consumer.kern', source: ${JSON.stringify(KIR_REVIEW_FIXTURES.cli.source)} }] };`,
      'const result = await projectKernModules(request);',
      "if (result.status !== 'projected') throw new Error('projection did not succeed');",
      'const verified = await verifyKernProjection(request, result);',
      "if (!verified || typeof verified !== 'object') throw new Error('projection did not verify');",
    ].join('\n');
    const environment = await poisonedConsumerEnvironment(temporary);
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: consumer,
      env: environment,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    });
    assert.equal(`${stdout}${stderr}`, '', 'clean consumer projection has no repository fallback output');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('KRI-A12 keeps the 22-package release surface while exposing projection declarations only through core', async () => {
  const packages = await discoverPublicPackageGraph({ rootDir: ROOT, packageRoots: ['packages'] });
  assert.equal(packages.length, 22, 'release package count remains fixed');
  const core = JSON.parse(await readFile(path.join(CORE_DIR, 'package.json'), 'utf8'));
  const projection = core.exports?.['./frontend-projection'];
  assert.deepEqual(projection, {
    types: './dist/frontend-projection.d.ts',
    default: './dist/frontend-projection.js',
  }, 'only the accepted core subpath declares the packaged projection API');
});
