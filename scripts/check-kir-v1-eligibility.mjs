#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { validateKirV1Eligibility } from './kir-v1/validate-eligibility.mjs';
import { verifyFixtureWitness } from './kir-v1/verify-fixture-witness.mjs';

const policy = JSON.parse(readFileSync('scripts/kir-v1/eligibility.json', 'utf8'));
const result = validateKirV1Eligibility(policy);
verifyFixtureWitness(policy);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (Object.hasOwn(packageJson.scripts, 'test:kern-ir')) {
  throw new Error('KIR v1 eligibility: test:kern-ir must remain absent until the KIR v1 freeze');
}

process.stdout.write(
  `KIR v1 eligibility: PASS (${result.proofLabel}; runtime ABI frozen; ${result.coveredSourceNodeCount}/${result.sourceNodeCount} source nodes ledger-covered; ${result.deferredRunnerContractCount}/${result.runnerContractCount} runner contracts remain deferred).\n`,
);
