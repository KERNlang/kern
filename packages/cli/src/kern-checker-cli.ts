#!/usr/bin/env node

import { type KernCheckerAssets, loadKernCheckerAssets } from './kern-checker-assets.js';
import { KERN_CHECKER_RESULT_FORMAT } from './kern-checker-contract.js';
import { type KernCheckerResult, kernCheckerExitCode, runKernCheckerFacts } from './kern-checker-runtime.js';

function failure(assets: KernCheckerAssets | null, error: unknown): KernCheckerResult {
  return {
    checker: assets?.checker ?? null,
    diagnostics: [
      {
        code: 'checker-contract-failure',
        message: error instanceof Error ? error.message : String(error),
      },
    ],
    format: KERN_CHECKER_RESULT_FORMAT,
    outcome: 'failure',
    path: null,
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
    if (bytes > limit) throw new TypeError('KERN checker transport rejection: stdin exceeds maxInputBytes');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

export async function runKernCheckerStdin(): Promise<0 | 1 | 2> {
  let assets: KernCheckerAssets | null = null;
  let result: KernCheckerResult;
  try {
    assets = loadKernCheckerAssets();
    const bytes = await readBoundedStdin(assets.policy.profileLimits.maxInputBytes);
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    result = runKernCheckerFacts(input, { assets });
  } catch (error) {
    result = failure(assets, error);
  }
  process.stdout.write(`${stringifyNdjson(result)}\n`);
  return kernCheckerExitCode(result);
}

process.exitCode = await runKernCheckerStdin();
