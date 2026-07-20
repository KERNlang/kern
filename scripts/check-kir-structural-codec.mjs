#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { moduleSpecifiers } from './check-canonical-value.mjs';

const sourceRoot = 'packages/core/src';
const ownRoot = path.join(sourceRoot, 'kir-structural');
const evidenceConsumerRoot = path.join(sourceRoot, 'kir-evidence');
const graphEntry = path.join(ownRoot, 'canonical.ts');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

function resolveSource(sourcePath, specifier) {
  const base = path.normalize(path.join(path.dirname(sourcePath), specifier.replace(/\.js$/u, '.ts')));
  if (existsSync(base)) return base;
  const index = path.join(base.replace(/\.ts$/u, ''), 'index.ts');
  if (existsSync(index)) return index;
  throw new Error(`structural KIR browser graph has missing edge ${sourcePath} -> ${specifier}`);
}

export function structuralKirReferences(source, sourcePath) {
  return moduleSpecifiers(source, sourcePath).filter((specifier) => {
    if (!specifier.startsWith('.')) return false;
    const resolved = path.normalize(path.join(path.dirname(sourcePath), specifier.replace(/\.js$/u, '.ts')));
    return resolved.startsWith(`${ownRoot}${path.sep}`);
  });
}

export function runStructuralKirCodecCheck() {
  for (const sourcePath of sourceFiles(sourceRoot)) {
    if (sourcePath.startsWith(`${ownRoot}${path.sep}`)) continue;
    if (structuralKirReferences(readFileSync(sourcePath, 'utf8'), sourcePath).length > 0) {
      if (sourcePath.startsWith(`${evidenceConsumerRoot}${path.sep}`)) continue;
      throw new Error(`structural KIR codec must remain internal and unconsumed; found reference in ${sourcePath}`);
    }
  }

  const visited = new Set();
  function inspectBrowserGraph(sourcePath) {
    if (visited.has(sourcePath)) return;
    visited.add(sourcePath);
    for (const specifier of moduleSpecifiers(readFileSync(sourcePath, 'utf8'), sourcePath)) {
      if (!specifier.startsWith('.')) {
        throw new Error(`structural KIR browser graph cannot import bare or Node dependency ${specifier} from ${sourcePath}`);
      }
      const resolved = resolveSource(sourcePath, specifier);
      if (!resolved.startsWith(`${sourceRoot}${path.sep}`)) {
        throw new Error(`structural KIR browser graph escapes core source: ${sourcePath} -> ${resolved}`);
      }
      inspectBrowserGraph(resolved);
    }
  }
  inspectBrowserGraph(graphEntry);

  const packageJson = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
  if (JSON.stringify(packageJson.exports ?? {}).includes('kir-structural')) {
    throw new Error('structural KIR codec must not be publicly exported');
  }
  const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
  if (Object.hasOwn(rootPackage.scripts, 'test:kern-ir')) {
    throw new Error('structural KIR codec cannot promote the KIR v1 gate');
  }

  process.stdout.write(
    `Structural KIR codec: PASS (INTERNAL; ${visited.size} browser-safe modules; evidence-only consumer; handler type catalog; ALPHA-NO-GO).\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runStructuralKirCodecCheck();
