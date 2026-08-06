#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateKirV1AcceptancePolicy } from './kir-v1/acceptance-manifest.mjs';
import { moduleSpecifiers } from './check-canonical-value.mjs';

const sourceRoot = 'packages/core/src';
const ownRoot = path.join(sourceRoot, 'kir-v1');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

export function runKirV1ProfileCheck(options = {}) {
  const corePackage = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
  if (JSON.stringify(corePackage.exports ?? {}).includes('kir-v1')) {
    throw new Error('KIR v1 must remain absent from @kernlang/core package exports');
  }
  if (readFileSync('packages/core/src/index.ts', 'utf8').includes('/kir-v1/')) {
    throw new Error('KIR v1 must remain absent from the @kernlang/core root barrel');
  }
  const consumers = [];
  for (const sourcePath of sourceFiles(sourceRoot)) {
    if (sourcePath.startsWith(`${ownRoot}${path.sep}`)) continue;
    if (
      moduleSpecifiers(readFileSync(sourcePath, 'utf8'), sourcePath).some((specifier) =>
        specifier.split('/').includes('kir-v1'),
      )
    ) {
      consumers.push(sourcePath);
    }
  }
  if (consumers.length > 0) throw new Error(`KIR v1 has unauthorized production consumers: ${consumers.join(', ')}`);
  validateKirV1AcceptancePolicy(
    options.policy ?? JSON.parse(readFileSync('scripts/kir-v1/acceptance-policy.json', 'utf8')),
  );
  const probe = options.importProbe ?? spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', "await import('@kernlang/core/kir-v1')"],
    { cwd: path.join(process.cwd(), 'packages/cli'), encoding: 'utf8', shell: false },
  );
  if (probe.status === 0 || !String(probe.stderr).includes('ERR_PACKAGE_PATH_NOT_EXPORTED')) {
    throw new Error('public @kernlang/core/kir-v1 import must fail with ERR_PACKAGE_PATH_NOT_EXPORTED');
  }
  const acceptanceRoot = 'scripts/kir-v1/acceptance';
  if (existsSync(acceptanceRoot)) {
    const invalid = readdirSync(acceptanceRoot).filter((name) => !/^[0-9a-f]{40}\.json$/u.test(name));
    if (invalid.length > 0) throw new Error(`acceptance directory contains invalid entries: ${invalid.join(', ')}`);
  }
  process.stdout.write('KIR v1 profile: PASS (INTERNAL; canonical envelope; public export/cutover/self-hosting false).\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runKirV1ProfileCheck();
