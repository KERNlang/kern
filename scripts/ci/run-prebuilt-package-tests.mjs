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
    .map((entry) => ({
      ...JSON.parse(readFileSync(path.join(packagesDir, entry.name, 'package.json'), 'utf8')),
      workspaceDirectory: entry.name,
    }));
}

function buildSegments(script) {
  return script.split(' && ').map((segment) => segment.trim());
}

function normalizeBuildSegment(segment, workingDirectory = '.') {
  if (segment === 'tsc -b') return segment;
  const match = segment.match(/^node ([^\s]+)(.*)$/u);
  if (!match) return segment;
  const absoluteScript = path.resolve(repoRoot, workingDirectory, match[1]);
  const relativeScript = path.relative(repoRoot, absoluteScript).split(path.sep).join('/');
  if (relativeScript.startsWith('../')) throw new Error(`package build command escapes the repository: ${segment}`);
  return `node ${relativeScript}${match[2]}`;
}

export function assertSelectedBuildCoverage(manifests, packageNames, rootBuildScript, projectReferences) {
  const rootCoverage = new Set(buildSegments(rootBuildScript).map((segment) => normalizeBuildSegment(segment)));
  const references = new Set(projectReferences.map((reference) => path.normalize(reference.path)));
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const uncovered = [];
  for (const packageName of packageNames) {
    const manifest = byName.get(packageName);
    if (!manifest) throw new Error(`unknown selected package ${packageName}`);
    if (!manifest.workspaceDirectory) throw new Error(`${packageName} has no workspace directory metadata`);
    for (const segment of buildSegments(manifest.scripts?.build ?? '')) {
      if (!segment) continue;
      if (segment === 'tsc -b') {
        const reference = path.normalize(`packages/${manifest.workspaceDirectory}`);
        if (!rootCoverage.has('tsc -b') || !references.has(reference)) uncovered.push(`${packageName}: ${segment}`);
        continue;
      }
      const normalized = normalizeBuildSegment(segment, `packages/${manifest.workspaceDirectory}`);
      if (!rootCoverage.has(normalized)) uncovered.push(`${packageName}: ${normalized}`);
    }
  }
  if (uncovered.length > 0) throw new Error(`build:packages does not cover selected package builds: ${uncovered.join(', ')}`);
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
    const manifests = loadPackageManifests();
    const packageNames = selectTestPackages(manifests, options);
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const tsconfig = JSON.parse(readFileSync(path.join(repoRoot, 'tsconfig.json'), 'utf8'));
    assertSelectedBuildCoverage(manifests, packageNames, packageJson.scripts['build:packages'], tsconfig.references);
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
