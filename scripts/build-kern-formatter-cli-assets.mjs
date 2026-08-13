#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyKernFormatterComposition } from './kern-formatter/composition.mjs';
import { kernFormatterPolicySource, loadKernFormatterPolicy } from './kern-formatter/policy.mjs';

const OUTPUT = fileURLToPath(new URL('../packages/cli/dist/kern-formatter/', import.meta.url));

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function buildKernFormatterCliAssets(output = OUTPUT) {
  const composition = verifyKernFormatterComposition();
  loadKernFormatterPolicy();
  const policyBytes = kernFormatterPolicySource();
  const compositionBytes = Buffer.from(`${JSON.stringify(composition.record, null, 2)}\n`);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(dirname(resolve(output, 'formatter.composed.kern')), { recursive: true });
  writeFileSync(resolve(output, 'formatter.composed.kern'), composition.compositeBytes);
  writeFileSync(resolve(output, 'composition.json'), compositionBytes);
  writeFileSync(resolve(output, 'policy.json'), policyBytes);
  writeFileSync(
    resolve(output, 'assets.json'),
    `${JSON.stringify({
      composition: { bytes: compositionBytes.length, sha256: digest(compositionBytes) },
      format: 'kern.cli.formatter.assets.1',
      policy: { bytes: policyBytes.length, sha256: digest(policyBytes) },
      source: { bytes: composition.compositeBytes.length, sha256: digest(composition.compositeBytes) },
    })}\n`,
  );
  return { bytes: composition.compositeBytes.length, output, sha256: composition.record.composite.sha256 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = buildKernFormatterCliAssets();
  process.stdout.write(`KERN formatter CLI assets: ${built.bytes} bytes, SHA-256 ${built.sha256}\n`);
}
