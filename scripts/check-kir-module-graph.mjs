#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { moduleSpecifiers } from './check-canonical-value.mjs';

const sourceRoot = path.normalize('packages/core/src');
const graphEntry = path.join(sourceRoot, 'kir-structural', 'module-canonical.ts');

function resolveSource(sourcePath, specifier) {
  const base = path.normalize(path.join(path.dirname(sourcePath), specifier.replace(/\.js$/u, '.ts')));
  if (existsSync(base)) return base;
  const index = path.join(base.replace(/\.ts$/u, ''), 'index.ts');
  if (existsSync(index)) return index;
  throw new Error(`structural KIR module graph has missing edge ${sourcePath} -> ${specifier}`);
}

export function runKirModuleGraphCheck() {
  const visited = new Set();
  function inspect(sourcePath) {
    if (visited.has(sourcePath)) return;
    visited.add(sourcePath);
    for (const specifier of moduleSpecifiers(readFileSync(sourcePath, 'utf8'), sourcePath)) {
      if (!specifier.startsWith('.')) {
        throw new Error(`structural KIR module graph cannot import bare or Node dependency ${specifier}`);
      }
      const resolved = resolveSource(sourcePath, specifier);
      if (!resolved.startsWith(`${sourceRoot}${path.sep}`)) {
        throw new Error(`structural KIR module graph escapes core source: ${sourcePath} -> ${resolved}`);
      }
      inspect(resolved);
    }
  }
  inspect(graphEntry);

  const packageJson = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
  if (JSON.stringify(packageJson.exports ?? {}).includes('kir-structural')) {
    throw new Error('structural KIR module graph must not be publicly exported');
  }
  for (const barrel of ['packages/core/src/index.ts', 'packages/core/src/runner.ts', 'packages/core/src/runner-browser.ts']) {
    if (readFileSync(barrel, 'utf8').includes('module-canonical')) {
      throw new Error(`structural KIR module graph must not enter runtime barrel ${barrel}`);
    }
  }
  process.stdout.write(
    `Structural KIR module graph: PASS (INTERNAL; ${visited.size} browser-safe modules; class,fn catalog; ALPHA-NO-GO).\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runKirModuleGraphCheck();
