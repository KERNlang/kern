#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyKernCheckerComposition } from './kern-checker/composition.mjs';
import { verifyKernCheckerNativeWorkPolicy } from './kern-checker/native-work-policy.mjs';
import { kernCheckerPolicySource, loadKernCheckerPolicy } from './kern-checker/policy.mjs';

const OUTPUT = fileURLToPath(new URL('../packages/cli/dist/kern-checker/', import.meta.url));

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function buildKernCheckerCliAssets(output = OUTPUT) {
  const composition = verifyKernCheckerComposition();
  const policy = loadKernCheckerPolicy();
  verifyKernCheckerNativeWorkPolicy(policy);
  const policyBytes = kernCheckerPolicySource();
  const compositionBytes = Buffer.from(`${JSON.stringify(composition.record, null, 2)}\n`);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(dirname(resolve(output, 'checker.composed.kern')), { recursive: true });
  writeFileSync(resolve(output, 'checker.composed.kern'), composition.compositeBytes);
  writeFileSync(resolve(output, 'composition.json'), compositionBytes);
  writeFileSync(resolve(output, 'policy.json'), policyBytes);
  writeFileSync(
    resolve(output, 'assets.json'),
    `${JSON.stringify({
      composite: { bytes: composition.compositeBytes.length, sha256: digest(composition.compositeBytes) },
      composition: { bytes: compositionBytes.length, sha256: digest(compositionBytes) },
      format: 'kern.cli.checker.assets.1',
      policy: { bytes: policyBytes.length, sha256: digest(policyBytes) },
    })}\n`,
  );
  return { bytes: composition.compositeBytes.length, output, sha256: composition.record.composite.sha256 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = buildKernCheckerCliAssets();
  process.stdout.write(`KERN checker CLI assets: ${built.bytes} bytes, SHA-256 ${built.sha256}\n`);
}
