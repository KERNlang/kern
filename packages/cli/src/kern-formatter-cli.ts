#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type KernFormatterAssets, loadKernFormatterAssets } from './kern-formatter-assets.js';
import { KERN_FORMATTER_RESULT_FORMAT, safeKernFormatterErrorMessage } from './kern-formatter-contract.js';
import { type KernFormatterResult, kernFormatterExitCode, runKernFormatter } from './kern-formatter-runtime.js';

function failure(assets: KernFormatterAssets | null, error: unknown): KernFormatterResult {
  return {
    diagnostics: [{ code: 'formatter-contract-failure', message: safeKernFormatterErrorMessage(error) }],
    edits: null,
    format: KERN_FORMATTER_RESULT_FORMAT,
    formatter: assets?.formatter ?? null,
    outcome: 'failure',
    source: null,
    sourceSha256: null,
  };
}

function stringifyNdjson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

async function readBoundedStdin(limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.length;
    if (bytes > limit) throw new TypeError('KERN formatter transport rejection: stdin exceeds maxInputBytes');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

export async function runKernFormatterStdin(): Promise<0 | 2> {
  let assets: KernFormatterAssets | null = null;
  let result: KernFormatterResult;
  try {
    assets = loadKernFormatterAssets();
    const bytes = await readBoundedStdin(assets.policy.profileLimits.maxInputBytes);
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    result = runKernFormatter(input, { assets });
  } catch (error) {
    result = failure(assets, error);
  }
  process.stdout.write(`${stringifyNdjson(result)}\n`);
  return kernFormatterExitCode(result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runKernFormatterStdin();
}
