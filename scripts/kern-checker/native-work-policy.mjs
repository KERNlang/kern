#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KERN_CHECKER_NATIVE_WORK_FORMULA,
  estimateKernCheckerNativeWork,
} from '../../packages/cli/dist/kern-checker-contract.js';
import { flattenKernSource } from '../capstone-checker-subset/flatten-kern.mjs';
import { FIXTURES } from '../capstone-checker-subset/fixtures.mjs';
import { checkerFactsFromFlatModule } from './contract.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function measureKernCheckerNativeWorkCorpus() {
  const records = FIXTURES.map((fixture) => {
    const facts = checkerFactsFromFlatModule(flattenKernSource(fixture.path, fixture.source()));
    const encoded = JSON.stringify(facts);
    return {
      id: fixture.id,
      sha256: digest(encoded),
      work: estimateKernCheckerNativeWork(facts),
    };
  });
  const maximum = records.reduce((current, candidate) => (candidate.work > current.work ? candidate : current));
  return {
    corpus: {
      count: records.length,
      sha256: digest(JSON.stringify({ formula: KERN_CHECKER_NATIVE_WORK_FORMULA, records })),
    },
    formula: KERN_CHECKER_NATIVE_WORK_FORMULA,
    maximumEnvelope: { ...maximum },
    maxNativeWork: Math.ceil((5 * maximum.work) / 4),
  };
}

export function verifyKernCheckerNativeWorkPolicy(policy) {
  const measured = measureKernCheckerNativeWorkCorpus();
  if (JSON.stringify(policy.nativeWork) !== JSON.stringify(measured)) {
    throw new TypeError('KERN checker native-work policy does not match the authenticated corpus');
  }
  return measured;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(measureKernCheckerNativeWorkCorpus(), null, 2)}\n`);
}
