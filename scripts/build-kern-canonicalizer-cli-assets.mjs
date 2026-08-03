#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalCompositionRecordBytes,
  verifyCanonicalizerComposition,
} from './kern-canonicalizer/composition.mjs';
import {
  canonicalizerPolicySource,
  loadCanonicalizerPolicy,
} from './kern-canonicalizer/policy.mjs';
import { runtimeModuleSpecifiers } from './runtime-envelope-import-closure.mjs';

const OUTPUT = fileURLToPath(
  new URL('../packages/cli/dist/kern-canonicalizer/', import.meta.url),
);
const CORE_DIST = fileURLToPath(new URL('../packages/core/dist/', import.meta.url));
const CORE_ENTRY = resolve(CORE_DIST, 'kir-structural/module-canonical.js');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function coreRuntimeClosure(entry = CORE_ENTRY) {
  const visited = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    if (!existsSync(path)) throw new Error(`KERN canonicalizer CLI codec module is missing: ${path}`);
    visited.add(path);
    const source = readFileSync(path, 'utf8');
    for (const specifier of runtimeModuleSpecifiers(source, path)) {
      if (!specifier.startsWith('.')) {
        throw new Error(`KERN canonicalizer CLI codec closure has a bare import: ${specifier}`);
      }
      const target = resolve(dirname(path), specifier);
      const targetRelative = relative(CORE_DIST, target);
      if (isAbsolute(targetRelative) || targetRelative === '..' || targetRelative.startsWith('../')) {
        throw new Error(`KERN canonicalizer CLI codec import escapes core dist: ${specifier}`);
      }
      if (!target.endsWith('.js')) {
        throw new Error(`KERN canonicalizer CLI codec import is not emitted JavaScript: ${specifier}`);
      }
      pending.push(target);
    }
  }
  return [...visited].sort();
}

function copyCoreRuntimeClosure(output) {
  const modules = coreRuntimeClosure();
  return modules.map((source) => {
    const modulePath = `core/${relative(CORE_DIST, source).split(sep).join('/')}`;
    const destination = resolve(output, modulePath);
    const bytes = readFileSync(source);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    return { bytes: bytes.length, path: modulePath, sha256: sha256(bytes) };
  });
}

export function buildKernCanonicalizerCliAssets(output = OUTPUT) {
  const composition = verifyCanonicalizerComposition();
  loadCanonicalizerPolicy();
  const policyBytes = canonicalizerPolicySource();

  rmSync(output, { force: true, recursive: true });
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'canonicalizer.composed.kern'), composition.compositeBytes);
  writeFileSync(resolve(output, 'composition.json'), canonicalCompositionRecordBytes(composition.record));
  writeFileSync(resolve(output, 'policy.json'), policyBytes);
  const coreModules = copyCoreRuntimeClosure(output);
  writeFileSync(
    resolve(output, 'assets.json'),
    `${JSON.stringify({
      codec: coreModules,
      composite: {
        bytes: composition.record.composite.bytes,
        sha256: composition.record.composite.sha256,
      },
      format: 'kern.cli.canonicalizer.assets.2',
      policy: { bytes: policyBytes.length, sha256: sha256(policyBytes) },
    })}\n`,
  );

  return {
    bytes: composition.record.composite.bytes,
    coreModules: coreModules.length,
    output,
    sha256: composition.record.composite.sha256,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = buildKernCanonicalizerCliAssets();
  process.stdout.write(
    `KERN canonicalizer CLI assets: ${built.bytes} bytes, SHA-256 ${built.sha256}, ${built.coreModules} private codec modules.\n`,
  );
}
