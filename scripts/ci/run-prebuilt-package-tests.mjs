#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const standardTestScript = 'pnpm run build && node ../../scripts/run-node-tests.mjs "tests/**/*.test.ts"';

export function loadPackageManifests(root = repoRoot) {
  const packagesDir = path.join(root, 'packages');
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(path.join(packagesDir, entry.name, 'package.json')))
    .map((entry) => JSON.parse(readFileSync(path.join(packagesDir, entry.name, 'package.json'), 'utf8')));
}

export function selectTestPackages(manifests, options = {}) {
  const only = new Set(options.only ?? []);
  const exclude = new Set(options.exclude ?? []);
  const names = new Set(manifests.map((manifest) => manifest.name));
  for (const requested of [...only, ...exclude]) {
    if (!names.has(requested)) throw new Error(`unknown workspace package ${requested}`);
  }

  const selected = manifests
    .filter((manifest) => typeof manifest.scripts?.test === 'string')
    .filter((manifest) => only.size === 0 || only.has(manifest.name))
    .filter((manifest) => !exclude.has(manifest.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (selected.length === 0) throw new Error('prebuilt package test selection is empty');
  for (const manifest of selected) {
    if (manifest.scripts.test !== standardTestScript) {
      throw new Error(`${manifest.name} test script is not the supported build-then-standard-test shape`);
    }
  }
  return selected.map((manifest) => manifest.name);
}

export function pnpmTestArgs(packageNames, testArgs = []) {
  return [
    '-r',
    ...packageNames.flatMap((packageName) => ['--filter', packageName]),
    'exec',
    process.execPath,
    '../../scripts/run-node-tests.mjs',
    'tests/**/*.test.ts',
    ...testArgs,
  ];
}

function parseArgs(args) {
  const only = [];
  const exclude = [];
  let index = 0;
  for (; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') break;
    if (arg !== '--only' && arg !== '--exclude') throw new Error(`unknown option ${arg}`);
    const packageName = args[index + 1];
    if (!packageName) throw new Error(`${arg} requires a package name`);
    (arg === '--only' ? only : exclude).push(packageName);
    index += 1;
  }
  return { only, exclude, testArgs: index < args.length ? args.slice(index + 1) : [] };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const packageNames = selectTestPackages(loadPackageManifests(), options);
    console.log(`Running prebuilt tests for ${packageNames.join(', ')}`);
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const result = spawnSync(command, pnpmTestArgs(packageNames, options.testArgs), {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main();
}
